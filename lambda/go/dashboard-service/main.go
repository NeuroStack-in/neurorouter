package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	lambdasvc "github.com/aws/aws-sdk-go-v2/service/lambda"
)

// Ported from: app/routers/dashboard_routes.py

var (
	ddbClient          *dynamodb.Client
	cogClient          *cognitoidentityprovider.Client
	lambdaClient       *lambdasvc.Client
	usersTable         string
	usageMonthlyTable  string
	apiKeysTable       string
	activityTable      string
	invoicesTable      string
	analyticsExportFn  string
)

func initClients(ctx context.Context) error {
	if ddbClient != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	ddbClient = dynamodb.NewFromConfig(cfg)
	cogClient = cognitoidentityprovider.NewFromConfig(cfg)
	lambdaClient = lambdasvc.NewFromConfig(cfg)

	usersTable = envOr("TABLE_USERS", "neurorouter-users-dev")
	usageMonthlyTable = envOr("TABLE_USAGE_MONTHLY", "neurorouter-usage-monthly-dev")
	apiKeysTable = envOr("TABLE_API_KEYS", "neurorouter-api-keys-dev")
	activityTable = envOr("TABLE_ACTIVITY_LOG", "neurorouter-activity-log-dev")
	invoicesTable = envOr("TABLE_INVOICES", "neurorouter-invoices-dev")
	analyticsExportFn = envOr("ANALYTICS_EXPORT_FUNCTION", "neurorouter-analytics-export-service-dev")
	return nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// --- Models ---

type UsageMonthlyRow struct {
	UserID       string `dynamodbav:"userId"`
	SK           string `dynamodbav:"sk"` // "YYYY-MM#MODEL#{model}#KEY#{keyId}"
	InputTokens  int64  `dynamodbav:"input_tokens"`
	OutputTokens int64  `dynamodbav:"output_tokens"`
	TotalTokens  int64  `dynamodbav:"total_tokens"`
	RequestCount int64  `dynamodbav:"request_count"`
}

type ActivityItem struct {
	ID       int    `json:"id"`
	Type     string `json:"type"`
	Message  string `json:"message"`
	Time     string `json:"time"`
	IconType string `json:"icon_type"`
	Bg       string `json:"bg"`
	Color    string `json:"color"`
}

type GraceBanner struct {
	Show           bool   `json:"show"`
	DaysRemaining  int    `json:"daysRemaining"`
	BillingMessage string `json:"billingMessage"`
}

type DashboardOverview struct {
	UserName       string         `json:"user_name"`
	TotalTokens    int64          `json:"total_tokens"`
	TotalRequests  int64          `json:"total_requests"`
	ActiveKeys     int            `json:"active_keys"`
	AccountStatus  string         `json:"account_status"`
	RecentActivity []ActivityItem `json:"recent_activity"`
	GraceBanner    GraceBanner    `json:"graceBanner"`
}

type UsageChartPoint struct {
	Date   string `json:"date"`
	Tokens int64  `json:"tokens"`
}

type UsageStats struct {
	TotalInputTokens  int64             `json:"total_input_tokens"`
	TotalOutputTokens int64             `json:"total_output_tokens"`
	TotalRequests     int64             `json:"total_requests"`
	TotalWebSearches  int64             `json:"total_web_searches"`
	ChartData         []UsageChartPoint `json:"chart_data"`
}

type ExportResponse struct {
	ExportID string `json:"exportId"`
	Status   string `json:"status"`
}

type ErrorResponse struct {
	Detail string `json:"detail"`
}

// --- Handler ---

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	if err := initClients(ctx); err != nil {
		return serverError("init: " + err.Error())
	}

	path := strings.TrimSuffix(req.Path, "/")
	method := req.HTTPMethod
	log.Printf("%s %s", method, path)

	if method == "OPTIONS" {
		return corsResp(200, ""), nil
	}

	userID := extractCognitoSub(req)
	if userID == "" {
		userID = extractUserFromToken(ctx, req)
	}
	if userID == "" {
		return jsonResp(http.StatusUnauthorized, ErrorResponse{Detail: "Not authenticated"})
	}

	switch {
	case method == "GET" && path == "/dashboard/overview":
		return handleOverview(ctx, userID)
	case method == "GET" && path == "/dashboard/usage":
		return handleUsage(ctx, userID, req.QueryStringParameters)
	case method == "POST" && path == "/dashboard/usage/export":
		return handleExport(ctx, userID, req)
	default:
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Not found"})
	}
}

// GET /dashboard/overview — Ported from dashboard_routes.py:13-70
func handleOverview(ctx context.Context, userID string) (events.APIGatewayProxyResponse, error) {
	// 1. Get user
	user, err := getUser(ctx, userID)
	if err != nil || user == nil {
		return serverError("get user: " + fmt.Sprint(err))
	}

	// 2. Query all usage for this user
	usageRows, err := queryAllUsage(ctx, userID)
	if err != nil {
		return serverError("query usage: " + err.Error())
	}

	var totalTokens, totalRequests int64
	for _, r := range usageRows {
		totalTokens += r.TotalTokens
		totalRequests += r.RequestCount
	}

	// 3. Count active keys
	activeKeys, err := countActiveKeys(ctx, userID)
	if err != nil {
		log.Printf("WARN: count keys: %v", err)
	}

	// 4. Recent activity from activity_log table
	activities, err := getRecentActivity(ctx, userID, 10)
	if err != nil {
		log.Printf("WARN: get activity: %v", err)
	}

	// 5. Grace banner
	banner := GraceBanner{Show: false}
	if user.AccountStatus == "GRACE" {
		banner.Show = true
		banner.BillingMessage = "Your account is in grace period. Please pay your outstanding invoice."
		// Compute days remaining from invoices
		banner.DaysRemaining = computeGraceDays(ctx, userID)
	}

	userName := user.FullName
	if userName == "" {
		parts := strings.SplitN(user.Email, "@", 2)
		userName = parts[0]
	}

	return jsonResp(http.StatusOK, DashboardOverview{
		UserName:       userName,
		TotalTokens:    totalTokens,
		TotalRequests:  totalRequests,
		ActiveKeys:     activeKeys,
		AccountStatus:  user.AccountStatus,
		RecentActivity: activities,
		GraceBanner:    banner,
	})
}

// GET /dashboard/usage — Ported from dashboard_routes.py:72-118
func handleUsage(ctx context.Context, userID string, params map[string]string) (events.APIGatewayProxyResponse, error) {
	usageRows, err := queryAllUsage(ctx, userID)
	if err != nil {
		return serverError("query usage: " + err.Error())
	}

	modelFilter := params["model"]
	keyFilter := params["api_key_id"]

	var totalInput, totalOutput, totalReqs int64
	chartMap := make(map[string]int64) // "YYYY-MM" -> tokens

	for _, r := range usageRows {
		// Parse SK: "YYYY-MM#MODEL#{model}#KEY#{keyId}"
		parts := strings.Split(r.SK, "#")
		ym := ""
		model := ""
		keyID := ""
		if len(parts) >= 1 {
			ym = parts[0]
		}
		if len(parts) >= 3 {
			model = parts[2]
		}
		if len(parts) >= 5 {
			keyID = parts[4]
		}

		if modelFilter != "" && model != modelFilter {
			continue
		}
		if keyFilter != "" && keyID != keyFilter {
			continue
		}

		totalInput += r.InputTokens
		totalOutput += r.OutputTokens
		totalReqs += r.RequestCount
		chartMap[ym] += r.TotalTokens
	}

	// Sort chart points
	var chartData []UsageChartPoint
	for k, v := range chartMap {
		chartData = append(chartData, UsageChartPoint{Date: k, Tokens: v})
	}
	sort.Slice(chartData, func(i, j int) bool { return chartData[i].Date < chartData[j].Date })

	return jsonResp(http.StatusOK, UsageStats{
		TotalInputTokens:  totalInput,
		TotalOutputTokens: totalOutput,
		TotalRequests:     totalReqs,
		TotalWebSearches:  0,
		ChartData:         chartData,
	})
}

// POST /dashboard/usage/export — NEW (invokes analytics-export-service async)
func handleExport(ctx context.Context, userID string, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body struct {
		YearMonth string `json:"yearMonth"`
	}
	if req.Body != "" {
		json.Unmarshal([]byte(req.Body), &body)
	}

	exportID := fmt.Sprintf("exp_%d", time.Now().UnixNano())
	payload, _ := json.Marshal(map[string]string{
		"userId":    userID,
		"exportId":  exportID,
		"yearMonth": body.YearMonth,
	})

	// Invoke async (Event invocation type)
	_, err := lambdaClient.Invoke(ctx, &lambdasvc.InvokeInput{
		FunctionName:   &analyticsExportFn,
		InvocationType: "Event", // async
		Payload:        payload,
	})
	if err != nil {
		log.Printf("WARN: invoke export lambda: %v", err)
		// Don't fail — return queued status
	}

	return jsonResp(http.StatusOK, ExportResponse{
		ExportID: exportID,
		Status:   "QUEUED",
	})
}

// --- DynamoDB helpers ---

type UserRecord struct {
	ID            string `dynamodbav:"id"`
	Email         string `dynamodbav:"email"`
	FullName      string `dynamodbav:"full_name"`
	AccountStatus string `dynamodbav:"account_status"`
	PlanID        string `dynamodbav:"plan_id"`
}

func getUser(ctx context.Context, userID string) (*UserRecord, error) {
	out, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &usersTable,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: userID}},
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var u UserRecord
	attributevalue.UnmarshalMap(out.Item, &u)
	return &u, nil
}

func queryAllUsage(ctx context.Context, userID string) ([]UsageMonthlyRow, error) {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &usageMonthlyTable,
		KeyConditionExpression: aws.String("userId = :uid"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
		},
	})
	if err != nil {
		return nil, err
	}
	var rows []UsageMonthlyRow
	attributevalue.UnmarshalListOfMaps(out.Items, &rows)
	return rows, nil
}

func countActiveKeys(ctx context.Context, userID string) (int, error) {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &apiKeysTable,
		IndexName:              aws.String("user_id-index"),
		KeyConditionExpression: aws.String("user_id = :uid"),
		FilterExpression:       aws.String("is_active = :t"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
			":t":   &dbtypes.AttributeValueMemberBOOL{Value: true},
		},
		Select: "COUNT",
	})
	if err != nil {
		return 0, err
	}
	return int(out.Count), nil
}

type ActivityRow struct {
	UserID    string `dynamodbav:"userId"`
	Timestamp string `dynamodbav:"timestamp"`
	Type      string `dynamodbav:"type"`
	Message   string `dynamodbav:"message"`
	IconType  string `dynamodbav:"icon_type"`
}

func getRecentActivity(ctx context.Context, userID string, limit int) ([]ActivityItem, error) {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &activityTable,
		KeyConditionExpression: aws.String("userId = :uid"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
		},
		ScanIndexForward: aws.Bool(false), // newest first
		Limit:            aws.Int32(int32(limit)),
	})
	if err != nil {
		return nil, err
	}
	var rows []ActivityRow
	attributevalue.UnmarshalListOfMaps(out.Items, &rows)

	var items []ActivityItem
	for i, r := range rows {
		ts, _ := time.Parse(time.RFC3339, r.Timestamp)
		timeStr := formatTimeDiff(time.Since(ts))
		iconType := r.IconType
		if iconType == "" {
			iconType = r.Type
		}
		items = append(items, ActivityItem{
			ID:       i,
			Type:     r.Type,
			Message:  r.Message,
			Time:     timeStr + " ago",
			IconType: iconType,
			Bg:       "bg-green-50",
			Color:    "text-green-500",
		})
	}
	return items, nil
}

func computeGraceDays(ctx context.Context, userID string) int {
	out, _ := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &invoicesTable,
		IndexName:              aws.String("userId-yearMonth-index"),
		KeyConditionExpression: aws.String("user_id = :uid"),
		FilterExpression:       aws.String("#st = :pending"),
		ExpressionAttributeNames: map[string]string{"#st": "status"},
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid":     &dbtypes.AttributeValueMemberS{Value: userID},
			":pending": &dbtypes.AttributeValueMemberS{Value: "PENDING"},
		},
	})
	if out == nil || len(out.Items) == 0 {
		return 0
	}
	type inv struct {
		GracePeriodEnd string `dynamodbav:"grace_period_end"`
	}
	var invoices []inv
	attributevalue.UnmarshalListOfMaps(out.Items, &invoices)

	minDays := 999
	now := time.Now().UTC()
	for _, i := range invoices {
		end, _ := time.Parse(time.RFC3339, i.GracePeriodEnd)
		days := int(math.Ceil(end.Sub(now).Hours() / 24))
		if days < 0 {
			days = 0
		}
		if days < minDays {
			minDays = days
		}
	}
	if minDays == 999 {
		return 0
	}
	return minDays
}

// Ported from dashboard_routes.py:121-130
func formatTimeDiff(d time.Duration) string {
	s := d.Seconds()
	switch {
	case s < 60:
		return "now"
	case s < 3600:
		return fmt.Sprintf("%d mins", int(s/60))
	case s < 86400:
		return fmt.Sprintf("%d hours", int(s/3600))
	default:
		return fmt.Sprintf("%d days", int(s/86400))
	}
}

// --- Auth helpers ---

func extractCognitoSub(req events.APIGatewayProxyRequest) string {
	if req.RequestContext.Authorizer == nil {
		return ""
	}
	claims, ok := req.RequestContext.Authorizer["claims"]
	if !ok {
		return ""
	}
	m, ok := claims.(map[string]interface{})
	if !ok {
		return ""
	}
	sub, _ := m["sub"].(string)
	return sub
}

func extractUserFromToken(ctx context.Context, req events.APIGatewayProxyRequest) string {
	auth := req.Headers["Authorization"]
	if auth == "" {
		auth = req.Headers["authorization"]
	}
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return ""
	}
	out, err := cogClient.GetUser(ctx, &cognitoidentityprovider.GetUserInput{
		AccessToken: &parts[1],
	})
	if err != nil {
		return ""
	}
	for _, attr := range out.UserAttributes {
		if aws.ToString(attr.Name) == "sub" {
			return aws.ToString(attr.Value)
		}
	}
	return ""
}

// --- Response helpers ---

func jsonResp(code int, body interface{}) (events.APIGatewayProxyResponse, error) {
	b, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{
		StatusCode: code,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
		},
		Body: string(b),
	}, nil
}

func corsResp(code int, body string) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{
		StatusCode: code,
		Headers: map[string]string{
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
		},
		Body: body,
	}
}

func serverError(msg string) (events.APIGatewayProxyResponse, error) {
	log.Printf("ERROR: %s", msg)
	return jsonResp(http.StatusInternalServerError, ErrorResponse{Detail: "Internal server error"})
}

func main() {
	lambda.Start(handler)
}

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
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
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Ported from: app/routers/billing.py (user endpoints only — admin is Day 7)
//
// Endpoints:
//   GET  /billing/me                         — billing dashboard (port from billing.py:134-200)
//   GET  /billing/invoices/{invoiceId}        — NEW: single invoice detail
//   POST /billing/invoices/{invoiceId}/download — NEW: presigned S3 URL for PDF

// --- Fixed billing rates (from billing_utils.py) ---
const (
	FixedFeeINR       = 1599.00
	RateInputPerMil   = 2.00  // USD per 1M input tokens
	RateOutputPerMil  = 8.00  // USD per 1M output tokens
	FreeInputTokens   = 1_000_000
	FreeOutputTokens  = 1_000_000
)

var (
	ddbClient      *dynamodb.Client
	cogClient      *cognitoidentityprovider.Client
	lambdaClient   *lambdasvc.Client
	s3Client       *s3.Client
	usersTable     string
	invoicesTable  string
	usageTable     string
	planCatalog    string
	pdfBucket      string
	pdfLambdaFn    string
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
	s3Client = s3.NewFromConfig(cfg)

	usersTable = envOr("TABLE_USERS", "neurorouter-users-dev")
	invoicesTable = envOr("TABLE_INVOICES", "neurorouter-invoices-dev")
	usageTable = envOr("TABLE_USAGE_MONTHLY", "neurorouter-usage-monthly-dev")
	planCatalog = envOr("TABLE_PLAN_CATALOG", "neurorouter-plan-catalog-dev")
	pdfBucket = envOr("PDF_BUCKET", "neurorouter-invoice-pdfs-dev")
	pdfLambdaFn = envOr("PDF_LAMBDA_FUNCTION", "neurorouter-invoice-pdf-service-dev")
	return nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// --- DynamoDB Models ---

type User struct {
	ID            string `dynamodbav:"id"`
	Email         string `dynamodbav:"email"`
	FullName      string `dynamodbav:"full_name"`
	AccountStatus string `dynamodbav:"account_status"`
	PlanID        string `dynamodbav:"plan_id"`
	IsManualBlock bool   `dynamodbav:"is_manual_block"`
}

type Invoice struct {
	ID                string  `dynamodbav:"id"                  json:"id"`
	UserID            string  `dynamodbav:"user_id"             json:"user_id"`
	InvoiceNumber     string  `dynamodbav:"invoice_number"      json:"invoice_number"`
	YearMonth         string  `dynamodbav:"year_month"          json:"year_month"`
	Status            string  `dynamodbav:"status"              json:"status"`
	DueDate           string  `dynamodbav:"due_date"            json:"due_date"`
	GracePeriodEnd    string  `dynamodbav:"grace_period_end"    json:"grace_period_end"`
	TotalInputTokens  int64   `dynamodbav:"total_input_tokens"  json:"total_input_tokens"`
	TotalOutputTokens int64   `dynamodbav:"total_output_tokens" json:"total_output_tokens"`
	RateInputPerMil   float64 `dynamodbav:"rate_input_usd_per_1m"  json:"rate_input_usd_per_1m"`
	RateOutputPerMil  float64 `dynamodbav:"rate_output_usd_per_1m" json:"rate_output_usd_per_1m"`
	FixedFeeINR       float64 `dynamodbav:"fixed_fee_inr"       json:"fixed_fee_inr"`
	VariableCostUSD   float64 `dynamodbav:"variable_cost_usd"   json:"variable_cost_usd"`
	FixedCostINR      float64 `dynamodbav:"fixed_cost_inr"      json:"fixed_cost_inr"`
	TotalDueDisplay   string  `dynamodbav:"total_due_display"   json:"total_due_display"`
	PdfS3Key          string  `dynamodbav:"pdf_s3_key,omitempty" json:"pdf_s3_key,omitempty"`
	CreatedAt         string  `dynamodbav:"created_at"          json:"created_at"`
	UpdatedAt         string  `dynamodbav:"updated_at"          json:"updated_at"`
}

type UsageRow struct {
	UserID       string `dynamodbav:"userId"`
	SK           string `dynamodbav:"sk"`
	InputTokens  int64  `dynamodbav:"input_tokens"`
	OutputTokens int64  `dynamodbav:"output_tokens"`
}

type PlanRecord struct {
	PlanID     string  `dynamodbav:"planId"       json:"planId"`
	Name       string  `dynamodbav:"name"         json:"name"`
	MonthlyFee float64 `dynamodbav:"monthly_fee"  json:"monthlyFee"`
	Currency   string  `dynamodbav:"currency"     json:"currency"`
}

// --- Response shapes ---

type CurrentUsage struct {
	UserID              string  `json:"user_id"`
	YearMonth           string  `json:"year_month"`
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	EstimatedVariableUSD float64 `json:"estimated_variable_usd"`
	FixedFeeINR         float64 `json:"fixed_fee_inr"`
	TotalDisplay        string  `json:"total_display"`
}

type GraceBanner struct {
	Show           bool   `json:"show"`
	DaysRemaining  int    `json:"daysRemaining"`
	BillingMessage string `json:"billingMessage"`
}

type BillingDashboard struct {
	CurrentMonth  CurrentUsage  `json:"current_month"`
	CurrentPlan   *PlanRecord   `json:"current_plan,omitempty"`
	PastInvoices  []Invoice     `json:"past_invoices"`
	AccountStatus string        `json:"account_status"`
	GraceBanner   GraceBanner   `json:"graceBanner"`
}

type DownloadResponse struct {
	DownloadURL string `json:"download_url"`
	ExpiresIn   int    `json:"expires_in"`
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
	case method == "GET" && path == "/billing/me":
		return handleBillingMe(ctx, userID)

	case method == "GET" && strings.HasPrefix(path, "/billing/invoices/") && !strings.HasSuffix(path, "/download"):
		invoiceID := strings.TrimPrefix(path, "/billing/invoices/")
		return handleInvoiceDetail(ctx, userID, invoiceID)

	case method == "POST" && strings.HasSuffix(path, "/download"):
		// /billing/invoices/{id}/download
		parts := strings.Split(path, "/")
		if len(parts) >= 4 {
			invoiceID := parts[3] // /billing/invoices/{id}/download
			return handleInvoiceDownload(ctx, userID, invoiceID)
		}
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Not found"})

	default:
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Not found"})
	}
}

// GET /billing/me — Ported from billing.py:134-200
func handleBillingMe(ctx context.Context, userID string) (events.APIGatewayProxyResponse, error) {
	// 1. Get user
	user, err := getUser(ctx, userID)
	if err != nil || user == nil {
		return serverError("get user: " + fmt.Sprint(err))
	}

	currentMonth := time.Now().UTC().Format("2006-01")

	// 2. Get current month usage from usage_monthly table
	inputTokens, outputTokens := getCurrentMonthUsage(ctx, userID, currentMonth)
	variableCost := calculateVariableCost(inputTokens, outputTokens)

	currentUsage := CurrentUsage{
		UserID:               userID,
		YearMonth:            currentMonth,
		InputTokens:          inputTokens,
		OutputTokens:         outputTokens,
		EstimatedVariableUSD: variableCost,
		FixedFeeINR:          FixedFeeINR,
		TotalDisplay:         fmt.Sprintf("₹%.2f + $%.2f", FixedFeeINR, variableCost),
	}

	// 3. Get current plan
	var plan *PlanRecord
	if user.PlanID != "" {
		plan = getPlan(ctx, user.PlanID)
	}

	// 4. Get past invoices
	invoices := getInvoicesForUser(ctx, userID)

	// 5. Grace banner
	banner := GraceBanner{Show: false}
	if user.AccountStatus == "GRACE" {
		banner.Show = true
		banner.BillingMessage = "Your account is in grace period. Please pay your outstanding invoice."
		banner.DaysRemaining = computeGraceDays(ctx, userID)
	}

	return jsonResp(http.StatusOK, BillingDashboard{
		CurrentMonth:  currentUsage,
		CurrentPlan:   plan,
		PastInvoices:  invoices,
		AccountStatus: user.AccountStatus,
		GraceBanner:   banner,
	})
}

// GET /billing/invoices/{invoiceId} — NEW endpoint
func handleInvoiceDetail(ctx context.Context, userID, invoiceID string) (events.APIGatewayProxyResponse, error) {
	if invoiceID == "" {
		return jsonResp(http.StatusBadRequest, ErrorResponse{Detail: "Invoice ID required"})
	}

	invoice, err := getInvoiceByID(ctx, invoiceID)
	if err != nil {
		return serverError("get invoice: " + err.Error())
	}
	if invoice == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Invoice not found"})
	}

	// Verify ownership
	if invoice.UserID != userID {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Invoice not found"})
	}

	return jsonResp(http.StatusOK, invoice)
}

// POST /billing/invoices/{invoiceId}/download — NEW endpoint
func handleInvoiceDownload(ctx context.Context, userID, invoiceID string) (events.APIGatewayProxyResponse, error) {
	if invoiceID == "" {
		return jsonResp(http.StatusBadRequest, ErrorResponse{Detail: "Invoice ID required"})
	}

	invoice, err := getInvoiceByID(ctx, invoiceID)
	if err != nil {
		return serverError("get invoice: " + err.Error())
	}
	if invoice == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Invoice not found"})
	}
	if invoice.UserID != userID {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Invoice not found"})
	}

	// Check if PDF already exists
	s3Key := invoice.PdfS3Key
	if s3Key == "" {
		// Invoke invoice-pdf-service Lambda synchronously to generate it
		payload, _ := json.Marshal(map[string]string{
			"invoiceId": invoiceID,
			"userId":    userID,
		})
		out, err := lambdaClient.Invoke(ctx, &lambdasvc.InvokeInput{
			FunctionName:   &pdfLambdaFn,
			InvocationType: "RequestResponse", // synchronous
			Payload:        payload,
		})
		if err != nil {
			log.Printf("WARN: invoke pdf lambda: %v", err)
			return serverError("PDF generation failed")
		}

		// Parse response for s3Key
		var pdfResp struct {
			S3Key string `json:"s3Key"`
		}
		json.Unmarshal(out.Payload, &pdfResp)
		if pdfResp.S3Key != "" {
			s3Key = pdfResp.S3Key
		} else {
			s3Key = fmt.Sprintf("invoices/%s.pdf", invoiceID)
		}
	}

	// Generate presigned URL (15 min expiry)
	presigner := s3.NewPresignClient(s3Client)
	presignReq, err := presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: &pdfBucket,
		Key:    &s3Key,
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		return serverError("presign url: " + err.Error())
	}

	return jsonResp(http.StatusOK, DownloadResponse{
		DownloadURL: presignReq.URL,
		ExpiresIn:   900, // 15 minutes in seconds
	})
}

// --- Billing calculation (ported from billing_utils.py:14-25) ---

func calculateVariableCost(inputTokens, outputTokens int64) float64 {
	chargeableInput := max64(0, inputTokens-FreeInputTokens)
	chargeableOutput := max64(0, outputTokens-FreeOutputTokens)
	inputCost := (float64(chargeableInput) / 1_000_000) * RateInputPerMil
	outputCost := (float64(chargeableOutput) / 1_000_000) * RateOutputPerMil
	return inputCost + outputCost
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

// --- DynamoDB helpers ---

func getUser(ctx context.Context, userID string) (*User, error) {
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
	var u User
	attributevalue.UnmarshalMap(out.Item, &u)
	return &u, nil
}

func getCurrentMonthUsage(ctx context.Context, userID, yearMonth string) (int64, int64) {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &usageTable,
		KeyConditionExpression: aws.String("userId = :uid AND begins_with(sk, :ym)"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
			":ym":  &dbtypes.AttributeValueMemberS{Value: yearMonth},
		},
	})
	if err != nil {
		log.Printf("WARN: query usage: %v", err)
		return 0, 0
	}
	var rows []UsageRow
	attributevalue.UnmarshalListOfMaps(out.Items, &rows)

	var totalIn, totalOut int64
	for _, r := range rows {
		totalIn += r.InputTokens
		totalOut += r.OutputTokens
	}
	return totalIn, totalOut
}

func getPlan(ctx context.Context, planID string) *PlanRecord {
	out, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &planCatalog,
		Key:       map[string]dbtypes.AttributeValue{"planId": &dbtypes.AttributeValueMemberS{Value: planID}},
	})
	if err != nil || out.Item == nil {
		return nil
	}
	var p PlanRecord
	attributevalue.UnmarshalMap(out.Item, &p)
	return &p
}

func getInvoicesForUser(ctx context.Context, userID string) []Invoice {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              &invoicesTable,
		IndexName:              aws.String("userId-yearMonth-index"),
		KeyConditionExpression: aws.String("user_id = :uid"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
		},
		ScanIndexForward: aws.Bool(false),
	})
	if err != nil {
		log.Printf("WARN: query invoices: %v", err)
		return []Invoice{}
	}
	var invoices []Invoice
	attributevalue.UnmarshalListOfMaps(out.Items, &invoices)
	if invoices == nil {
		return []Invoice{}
	}
	return invoices
}

func getInvoiceByID(ctx context.Context, invoiceID string) (*Invoice, error) {
	out, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &invoicesTable,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: invoiceID}},
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var inv Invoice
	attributevalue.UnmarshalMap(out.Item, &inv)
	return &inv, nil
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

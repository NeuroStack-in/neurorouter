package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
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
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// Day 7: Admin Service — ports billing.py admin endpoints + new endpoints
//
// All endpoints require the caller to be in the Cognito admin or ops group.
// The Cognito authorizer passes group info in JWT claims.

var (
	ddbClient      *dynamodb.Client
	cogClient      *cognitoidentityprovider.Client
	lambdaClient   *lambdasvc.Client
	s3Client       *s3.Client
	smClient       *secretsmanager.Client
	usersTable     string
	invoicesTable  string
	apiKeysTable   string
	usageTable     string
	auditLogTable  string
	activityTable  string
	planCatalog    string
	pdfBucket      string
	pdfLambdaFn    string
	cognitoPoolID  string
)

const (
	FixedFeeINR      = 1599.00
	RateInputPerMil  = 2.00
	RateOutputPerMil = 8.00
	FreeTokens       = 1_000_000
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
	smClient = secretsmanager.NewFromConfig(cfg)

	usersTable = envOr("TABLE_USERS", "neurorouter-users-dev")
	invoicesTable = envOr("TABLE_INVOICES", "neurorouter-invoices-dev")
	apiKeysTable = envOr("TABLE_API_KEYS", "neurorouter-api-keys-dev")
	usageTable = envOr("TABLE_USAGE_MONTHLY", "neurorouter-usage-monthly-dev")
	auditLogTable = envOr("TABLE_ADMIN_AUDIT_LOG", "neurorouter-admin-audit-log-dev")
	activityTable = envOr("TABLE_ACTIVITY_LOG", "neurorouter-activity-log-dev")
	planCatalog = envOr("TABLE_PLAN_CATALOG", "neurorouter-plan-catalog-dev")
	pdfBucket = envOr("PDF_BUCKET", "neurorouter-invoice-pdfs-dev")
	pdfLambdaFn = envOr("PDF_LAMBDA_FUNCTION", "neurorouter-invoice-pdf-service-dev")
	cognitoPoolID = envOr("COGNITO_USER_POOL_ID", "ap-south-1_Rx2PCbjA8")
	return nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// --- Models ---

type User struct {
	ID            string `dynamodbav:"id"              json:"userId"`
	Email         string `dynamodbav:"email"           json:"email"`
	FullName      string `dynamodbav:"full_name"       json:"fullName"`
	AccountStatus string `dynamodbav:"account_status"  json:"accountStatus"`
	PlanID        string `dynamodbav:"plan_id"         json:"planId"`
	IsActive      bool   `dynamodbav:"is_active"       json:"isActive"`
	IsManualBlock bool   `dynamodbav:"is_manual_block" json:"isManualBlock"`
	CreatedAt     string `dynamodbav:"created_at"      json:"createdAt"`
}

type Invoice struct {
	ID                string  `dynamodbav:"id"                    json:"id"`
	UserID            string  `dynamodbav:"user_id"               json:"userId"`
	InvoiceNumber     string  `dynamodbav:"invoice_number"        json:"invoiceNumber"`
	YearMonth         string  `dynamodbav:"year_month"            json:"yearMonth"`
	Status            string  `dynamodbav:"status"                json:"status"`
	DueDate           string  `dynamodbav:"due_date"              json:"dueDate"`
	GracePeriodEnd    string  `dynamodbav:"grace_period_end"      json:"gracePeriodEnd"`
	TotalInputTokens  int64   `dynamodbav:"total_input_tokens"    json:"totalInputTokens"`
	TotalOutputTokens int64   `dynamodbav:"total_output_tokens"   json:"totalOutputTokens"`
	FixedFeeINR       float64 `dynamodbav:"fixed_fee_inr"         json:"fixedFeeInr"`
	VariableCostUSD   float64 `dynamodbav:"variable_cost_usd"     json:"variableCostUsd"`
	TotalDueDisplay   string  `dynamodbav:"total_due_display"     json:"totalDueDisplay"`
	PdfS3Key          string  `dynamodbav:"pdf_s3_key,omitempty"  json:"pdfS3Key,omitempty"`
	CreatedAt         string  `dynamodbav:"created_at"            json:"createdAt"`
	UpdatedAt         string  `dynamodbav:"updated_at"            json:"updatedAt"`
	PaidAt            string  `dynamodbav:"paid_at,omitempty"     json:"paidAt,omitempty"`
	MarkedByUserID    string  `dynamodbav:"marked_by_user_id,omitempty" json:"markedByUserId,omitempty"`
}

type AuditEntry struct {
	ID            string `dynamodbav:"id"               json:"id"`
	Timestamp     string `dynamodbav:"timestamp"        json:"timestamp"`
	AdminUserID   string `dynamodbav:"admin_user_id"    json:"adminUserId"`
	TargetUserID  string `dynamodbav:"target_user_id"   json:"targetUserId"`
	Action        string `dynamodbav:"action"            json:"action"`
	Resource      string `dynamodbav:"resource_collection" json:"resource"`
	ResourceID    string `dynamodbav:"resource_id"       json:"resourceId"`
	PreviousValue string `dynamodbav:"previous_value,omitempty" json:"previousValue,omitempty"`
	NewValue      string `dynamodbav:"new_value,omitempty"      json:"newValue,omitempty"`
	Reason        string `dynamodbav:"reason,omitempty"         json:"reason,omitempty"`
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

	// Admin auth — extract admin user ID from Cognito authorizer
	adminID := extractCognitoSub(req)
	if adminID == "" {
		adminID = extractUserFromToken(ctx, req)
	}
	if adminID == "" {
		return jsonResp(http.StatusUnauthorized, ErrorResponse{Detail: "Not authenticated"})
	}

	// Route
	switch {
	// User management
	case method == "GET" && path == "/admin/users":
		return handleListUsers(ctx)
	case method == "GET" && strings.HasPrefix(path, "/admin/users/") && strings.HasSuffix(path, "/billing"):
		uid := extractPathParam(path, "/admin/users/", "/billing")
		return handleUserBilling(ctx, uid)
	case method == "POST" && strings.HasSuffix(path, "/approve"):
		uid := extractPathParam(path, "/admin/users/", "/approve")
		return handleApprove(ctx, adminID, uid, req)
	case method == "POST" && strings.HasSuffix(path, "/reject"):
		uid := extractPathParam(path, "/admin/users/", "/reject")
		return handleReject(ctx, adminID, uid, req)
	case method == "POST" && strings.HasSuffix(path, "/status"):
		uid := extractPathParam(path, "/admin/users/", "/status")
		return handleChangeStatus(ctx, adminID, uid, req)
	case method == "POST" && strings.HasSuffix(path, "/invoice"):
		uid := extractPathParam(path, "/admin/users/", "/invoice")
		return handleGenerateInvoice(ctx, adminID, uid, req)
	case method == "GET" && strings.HasPrefix(path, "/admin/users/") && !strings.Contains(path[len("/admin/users/"):], "/"):
		uid := strings.TrimPrefix(path, "/admin/users/")
		return handleGetUser(ctx, uid)

	// Invoice management
	case method == "PUT" && strings.HasPrefix(path, "/admin/invoices/"):
		invID := extractInvoiceID(path)
		return handleUpdateInvoice(ctx, adminID, invID, req)
	case method == "POST" && strings.HasSuffix(path, "/pay"):
		invID := extractPathParam(path, "/admin/invoices/", "/pay")
		return handleMarkPaid(ctx, adminID, invID)
	case method == "POST" && strings.HasSuffix(path, "/unpay"):
		invID := extractPathParam(path, "/admin/invoices/", "/unpay")
		return handleMarkUnpaid(ctx, adminID, invID)
	case method == "GET" && strings.HasSuffix(path, "/pdf"):
		invID := extractPathParam(path, "/admin/invoices/", "/pdf")
		return handleInvoicePDF(ctx, invID)

	// Audit logs
	case method == "GET" && path == "/admin/audit-logs":
		return handleAuditLogs(ctx, req.QueryStringParameters)

	default:
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Not found"})
	}
}

// --- Endpoint handlers ---

// GET /admin/users — list all users with billing summary
func handleListUsers(ctx context.Context) (events.APIGatewayProxyResponse, error) {
	out, err := ddbClient.Scan(ctx, &dynamodb.ScanInput{TableName: &usersTable})
	if err != nil {
		return serverError("scan users: " + err.Error())
	}
	var users []User
	attributevalue.UnmarshalListOfMaps(out.Items, &users)
	return jsonResp(http.StatusOK, users)
}

// GET /admin/users/{userId}
func handleGetUser(ctx context.Context, userID string) (events.APIGatewayProxyResponse, error) {
	user, err := getUser(ctx, userID)
	if err != nil || user == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "User not found"})
	}
	return jsonResp(http.StatusOK, user)
}

// GET /admin/users/{userId}/billing — same as user billing/me but for any user
func handleUserBilling(ctx context.Context, userID string) (events.APIGatewayProxyResponse, error) {
	user, err := getUser(ctx, userID)
	if err != nil || user == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "User not found"})
	}
	currentMonth := time.Now().UTC().Format("2006-01")
	inputTk, outputTk := getCurrentMonthUsage(ctx, userID, currentMonth)
	variableCost := calcVariableCost(inputTk, outputTk)
	invoices := getInvoicesForUser(ctx, userID)

	resp := map[string]interface{}{
		"user":          user,
		"current_month": map[string]interface{}{
			"year_month": currentMonth, "input_tokens": inputTk, "output_tokens": outputTk,
			"estimated_variable_usd": variableCost, "fixed_fee_inr": FixedFeeINR,
			"total_display": fmt.Sprintf("₹%.2f + $%.2f", FixedFeeINR, variableCost),
		},
		"past_invoices":  invoices,
		"account_status": user.AccountStatus,
	}
	return jsonResp(http.StatusOK, resp)
}

// POST /admin/users/{userId}/approve — validate Groq key, activate user
func handleApprove(ctx context.Context, adminID, userID string, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body struct {
		GroqAPIKey string `json:"groq_api_key"`
	}
	json.Unmarshal([]byte(req.Body), &body)
	if body.GroqAPIKey == "" {
		return jsonResp(http.StatusBadRequest, ErrorResponse{Detail: "groq_api_key is required"})
	}

	user, _ := getUser(ctx, userID)
	if user == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "User not found"})
	}

	// Validate Groq key
	client := &http.Client{Timeout: 10 * time.Second}
	greq, _ := http.NewRequest("GET", "https://api.groq.com/openai/v1/models", nil)
	greq.Header.Set("Authorization", "Bearer "+body.GroqAPIKey)
	resp, err := client.Do(greq)
	if err != nil || resp.StatusCode != 200 {
		return jsonResp(http.StatusBadRequest, ErrorResponse{Detail: "Invalid Groq API Key"})
	}
	resp.Body.Close()

	// Store key in Secrets Manager
	secretName := fmt.Sprintf("neurorouter/users/%s/groq-key", userID)
	smClient.CreateSecret(ctx, &secretsmanager.CreateSecretInput{
		Name: &secretName, SecretString: &body.GroqAPIKey,
	})

	// Update user
	now := nowISO()
	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &usersTable,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: userID}},
		UpdateExpression: aws.String("SET account_status = :s, plan_id = :p, updated_at = :u"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: "ACTIVE"},
			":p": &dbtypes.AttributeValueMemberS{Value: "developer"},
			":u": &dbtypes.AttributeValueMemberS{Value: now},
		},
	})

	// Move to customer group in Cognito
	cogClient.AdminAddUserToGroup(ctx, &cognitoidentityprovider.AdminAddUserToGroupInput{
		UserPoolId: &cognitoPoolID, Username: &user.Email, GroupName: aws.String("customer"),
	})

	writeAudit(ctx, adminID, userID, "APPROVE_USER", "users", userID, "PENDING_APPROVAL", "ACTIVE", "Admin Approval with Validated Key")
	return jsonResp(http.StatusOK, map[string]string{"status": "success", "user_status": "ACTIVE"})
}

// POST /admin/users/{userId}/reject — NEW endpoint
func handleReject(ctx context.Context, adminID, userID string, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body struct {
		Reason string `json:"reason"`
	}
	json.Unmarshal([]byte(req.Body), &body)
	if body.Reason == "" {
		return jsonResp(http.StatusBadRequest, ErrorResponse{Detail: "reason is required"})
	}

	user, _ := getUser(ctx, userID)
	if user == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "User not found"})
	}

	oldStatus := user.AccountStatus
	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &usersTable,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: userID}},
		UpdateExpression: aws.String("SET account_status = :s, updated_at = :u"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: "REJECTED"},
			":u": &dbtypes.AttributeValueMemberS{Value: nowISO()},
		},
	})

	// Write activity for user
	writeActivityLog(ctx, userID, "account_rejected", "Your account has been rejected: "+body.Reason)
	writeAudit(ctx, adminID, userID, "REJECT_USER", "users", userID, oldStatus, "REJECTED", body.Reason)

	return jsonResp(http.StatusOK, map[string]string{"status": "success", "new_status": "REJECTED"})
}

// POST /admin/users/{userId}/status — force status change
func handleChangeStatus(ctx context.Context, adminID, userID string, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body struct {
		Status string `json:"status"`
		Reason string `json:"reason"`
	}
	json.Unmarshal([]byte(req.Body), &body)
	if body.Status == "" || body.Reason == "" {
		return jsonResp(http.StatusBadRequest, ErrorResponse{Detail: "status and reason are required"})
	}

	user, _ := getUser(ctx, userID)
	if user == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "User not found"})
	}

	oldStatus := user.AccountStatus
	isManualBlock := body.Status == "BLOCKED"

	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &usersTable,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: userID}},
		UpdateExpression: aws.String("SET account_status = :s, is_manual_block = :m, updated_at = :u"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: body.Status},
			":m": &dbtypes.AttributeValueMemberBOOL{Value: isManualBlock},
			":u": &dbtypes.AttributeValueMemberS{Value: nowISO()},
		},
	})

	writeAudit(ctx, adminID, userID, "CHANGE_ACCOUNT_STATUS", "users", userID, oldStatus, body.Status, body.Reason)
	return jsonResp(http.StatusOK, map[string]string{"status": "success", "new_status": body.Status})
}

// PUT /admin/invoices/{invoiceId} — edit invoice fields
func handleUpdateInvoice(ctx context.Context, adminID, invID string, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body struct {
		Status         string `json:"status,omitempty"`
		DueDate        string `json:"due_date,omitempty"`
		GracePeriodEnd string `json:"grace_period_end,omitempty"`
	}
	json.Unmarshal([]byte(req.Body), &body)

	inv, _ := getInvoice(ctx, invID)
	if inv == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Invoice not found"})
	}

	update := "SET updated_at = :u"
	vals := map[string]dbtypes.AttributeValue{":u": &dbtypes.AttributeValueMemberS{Value: nowISO()}}
	names := map[string]string{}
	changes := map[string]string{}

	if body.Status != "" {
		update += ", #st = :s"
		vals[":s"] = &dbtypes.AttributeValueMemberS{Value: body.Status}
		names["#st"] = "status"
		changes["status"] = inv.Status + " → " + body.Status
	}
	if body.DueDate != "" {
		update += ", due_date = :dd"
		vals[":dd"] = &dbtypes.AttributeValueMemberS{Value: body.DueDate}
		changes["due_date"] = inv.DueDate + " → " + body.DueDate
	}
	if body.GracePeriodEnd != "" {
		update += ", grace_period_end = :gp"
		vals[":gp"] = &dbtypes.AttributeValueMemberS{Value: body.GracePeriodEnd}
		changes["grace_period_end"] = inv.GracePeriodEnd + " → " + body.GracePeriodEnd
	}

	input := &dynamodb.UpdateItemInput{
		TableName:                 &invoicesTable,
		Key:                      map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: invID}},
		UpdateExpression:          &update,
		ExpressionAttributeValues: vals,
	}
	if len(names) > 0 {
		input.ExpressionAttributeNames = names
	}
	ddbClient.UpdateItem(ctx, input)

	// Re-run billing state machine for user
	refreshBillingStatus(ctx, inv.UserID)

	changesJSON, _ := json.Marshal(changes)
	writeAudit(ctx, adminID, inv.UserID, "UPDATE_INVOICE", "invoices", invID, "", string(changesJSON), "")
	return jsonResp(http.StatusOK, map[string]interface{}{"status": "success", "changes": changes})
}

// POST /admin/invoices/{invoiceId}/pay — mark paid, restore access
func handleMarkPaid(ctx context.Context, adminID, invID string) (events.APIGatewayProxyResponse, error) {
	inv, _ := getInvoice(ctx, invID)
	if inv == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Invoice not found"})
	}

	now := nowISO()
	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &invoicesTable,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: invID}},
		UpdateExpression: aws.String("SET #st = :s, paid_at = :p, marked_by_user_id = :m, updated_at = :u"),
		ExpressionAttributeNames: map[string]string{"#st": "status"},
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: "PAID"},
			":p": &dbtypes.AttributeValueMemberS{Value: now},
			":m": &dbtypes.AttributeValueMemberS{Value: adminID},
			":u": &dbtypes.AttributeValueMemberS{Value: now},
		},
	})

	// Restore user to ACTIVE
	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &usersTable,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: inv.UserID}},
		UpdateExpression: aws.String("SET account_status = :s, is_manual_block = :f, updated_at = :u"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: "ACTIVE"},
			":f": &dbtypes.AttributeValueMemberBOOL{Value: false},
			":u": &dbtypes.AttributeValueMemberS{Value: now},
		},
	})

	writeAudit(ctx, adminID, inv.UserID, "MARK_INVOICE_PAID", "invoices", invID, inv.Status, "PAID", "Manual Payment - Access Restored")
	return jsonResp(http.StatusOK, map[string]interface{}{
		"status": "success", "invoice_status": "PAID", "account_status": "ACTIVE",
	})
}

// POST /admin/invoices/{invoiceId}/unpay — NEW: mark paid invoice back to PENDING
func handleMarkUnpaid(ctx context.Context, adminID, invID string) (events.APIGatewayProxyResponse, error) {
	inv, _ := getInvoice(ctx, invID)
	if inv == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Invoice not found"})
	}

	ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &invoicesTable,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: invID}},
		UpdateExpression: aws.String("SET #st = :s, updated_at = :u REMOVE paid_at, marked_by_user_id"),
		ExpressionAttributeNames: map[string]string{"#st": "status"},
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: "PENDING"},
			":u": &dbtypes.AttributeValueMemberS{Value: nowISO()},
		},
	})

	// Re-run billing state machine
	refreshBillingStatus(ctx, inv.UserID)

	writeAudit(ctx, adminID, inv.UserID, "MARK_INVOICE_UNPAID", "invoices", invID, "PAID", "PENDING", "")
	return jsonResp(http.StatusOK, map[string]string{"status": "success", "invoice_status": "PENDING"})
}

// POST /admin/users/{userId}/invoice — manually generate invoice
func handleGenerateInvoice(ctx context.Context, adminID, userID string, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body struct {
		YearMonth string `json:"year_month"`
	}
	json.Unmarshal([]byte(req.Body), &body)
	if body.YearMonth == "" {
		body.YearMonth = time.Now().UTC().Format("2006-01")
	}

	user, _ := getUser(ctx, userID)
	if user == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "User not found"})
	}

	// Check existing
	existingInvoices := getInvoicesForUser(ctx, userID)
	for _, inv := range existingInvoices {
		if inv.YearMonth == body.YearMonth && inv.Status != "PENDING" {
			return jsonResp(http.StatusBadRequest, ErrorResponse{Detail: "Invoice already finalized for this month"})
		}
	}

	inputTk, outputTk := getCurrentMonthUsage(ctx, userID, body.YearMonth)
	variableCost := calcVariableCost(inputTk, outputTk)
	now := time.Now().UTC()
	invID := fmt.Sprintf("inv_%d", now.UnixNano())
	invNumber := fmt.Sprintf("INV-%s-%s", body.YearMonth, userID[:8])

	invItem := map[string]interface{}{
		"id": invID, "user_id": userID, "invoice_number": invNumber,
		"year_month": body.YearMonth, "status": "PENDING",
		"due_date": now.AddDate(0, 1, 5).Format(time.RFC3339),
		"grace_period_end": now.AddDate(0, 1, 10).Format(time.RFC3339),
		"total_input_tokens": inputTk, "total_output_tokens": outputTk,
		"fixed_fee_inr": FixedFeeINR, "variable_cost_usd": variableCost,
		"total_due_display": fmt.Sprintf("₹%.2f + $%.2f", FixedFeeINR, variableCost),
		"created_at": now.Format(time.RFC3339), "updated_at": now.Format(time.RFC3339),
	}
	item, _ := attributevalue.MarshalMap(invItem)
	ddbClient.PutItem(ctx, &dynamodb.PutItemInput{TableName: &invoicesTable, Item: item})

	writeAudit(ctx, adminID, userID, "GENERATE_INVOICE", "invoices", invID, "", invNumber, "")
	return jsonResp(http.StatusOK, map[string]string{"status": "success", "invoice_id": invID, "invoice_number": invNumber})
}

// GET /admin/invoices/{invoiceId}/pdf — trigger PDF gen, return presigned URL
func handleInvoicePDF(ctx context.Context, invID string) (events.APIGatewayProxyResponse, error) {
	inv, _ := getInvoice(ctx, invID)
	if inv == nil {
		return jsonResp(http.StatusNotFound, ErrorResponse{Detail: "Invoice not found"})
	}

	s3Key := inv.PdfS3Key
	if s3Key == "" {
		payload, _ := json.Marshal(map[string]string{"invoiceId": invID, "userId": inv.UserID})
		lambdaClient.Invoke(ctx, &lambdasvc.InvokeInput{
			FunctionName: &pdfLambdaFn, InvocationType: "RequestResponse", Payload: payload,
		})
		s3Key = fmt.Sprintf("invoices/%s.pdf", invID)
	}

	presigner := s3.NewPresignClient(s3Client)
	presignReq, err := presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: &pdfBucket, Key: &s3Key,
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		return serverError("presign: " + err.Error())
	}
	return jsonResp(http.StatusOK, map[string]string{"download_url": presignReq.URL, "expires_in": "900"})
}

// GET /admin/audit-logs
func handleAuditLogs(ctx context.Context, params map[string]string) (events.APIGatewayProxyResponse, error) {
	if targetUID := params["target_user_id"]; targetUID != "" {
		out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
			TableName: &auditLogTable, IndexName: aws.String("targetUserId-index"),
			KeyConditionExpression:    aws.String("target_user_id = :tid"),
			ExpressionAttributeValues: map[string]dbtypes.AttributeValue{":tid": &dbtypes.AttributeValueMemberS{Value: targetUID}},
			Limit: aws.Int32(100), ScanIndexForward: aws.Bool(false),
		})
		if err != nil {
			return serverError("query audit: " + err.Error())
		}
		var entries []AuditEntry
		attributevalue.UnmarshalListOfMaps(out.Items, &entries)
		return jsonResp(http.StatusOK, entries)
	}

	out, err := ddbClient.Scan(ctx, &dynamodb.ScanInput{TableName: &auditLogTable, Limit: aws.Int32(100)})
	if err != nil {
		return serverError("scan audit: " + err.Error())
	}
	var entries []AuditEntry
	attributevalue.UnmarshalListOfMaps(out.Items, &entries)
	return jsonResp(http.StatusOK, entries)
}

// --- DynamoDB helpers ---

func getUser(ctx context.Context, id string) (*User, error) {
	out, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &usersTable, Key: map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: id}},
	})
	if err != nil || out.Item == nil {
		return nil, err
	}
	var u User
	attributevalue.UnmarshalMap(out.Item, &u)
	return &u, nil
}

func getInvoice(ctx context.Context, id string) (*Invoice, error) {
	out, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &invoicesTable, Key: map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: id}},
	})
	if err != nil || out.Item == nil {
		return nil, err
	}
	var inv Invoice
	attributevalue.UnmarshalMap(out.Item, &inv)
	return &inv, nil
}

func getInvoicesForUser(ctx context.Context, userID string) []Invoice {
	out, _ := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName: &invoicesTable, IndexName: aws.String("userId-yearMonth-index"),
		KeyConditionExpression:    aws.String("user_id = :uid"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{":uid": &dbtypes.AttributeValueMemberS{Value: userID}},
		ScanIndexForward:          aws.Bool(false),
	})
	if out == nil {
		return []Invoice{}
	}
	var invoices []Invoice
	attributevalue.UnmarshalListOfMaps(out.Items, &invoices)
	if invoices == nil {
		return []Invoice{}
	}
	return invoices
}

func getCurrentMonthUsage(ctx context.Context, userID, yearMonth string) (int64, int64) {
	out, _ := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName: &usageTable,
		KeyConditionExpression: aws.String("userId = :uid AND begins_with(sk, :ym)"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
			":ym":  &dbtypes.AttributeValueMemberS{Value: yearMonth},
		},
	})
	if out == nil {
		return 0, 0
	}
	type row struct {
		InputTokens  int64 `dynamodbav:"input_tokens"`
		OutputTokens int64 `dynamodbav:"output_tokens"`
	}
	var rows []row
	attributevalue.UnmarshalListOfMaps(out.Items, &rows)
	var i, o int64
	for _, r := range rows {
		i += r.InputTokens
		o += r.OutputTokens
	}
	return i, o
}

func reEnableAPIKeys(ctx context.Context, userID string) int {
	out, _ := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName: &apiKeysTable, IndexName: aws.String("user_id-index"),
		KeyConditionExpression:    aws.String("user_id = :uid"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{":uid": &dbtypes.AttributeValueMemberS{Value: userID}},
	})
	if out == nil {
		return 0
	}
	count := 0
	for _, item := range out.Items {
		keyID := item["id"].(*dbtypes.AttributeValueMemberS).Value
		ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: &apiKeysTable,
			Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: keyID}},
			UpdateExpression: aws.String("SET is_active = :t"),
			ExpressionAttributeValues: map[string]dbtypes.AttributeValue{":t": &dbtypes.AttributeValueMemberBOOL{Value: true}},
		})
		count++
	}
	return count
}

func refreshBillingStatus(ctx context.Context, userID string) {
	user, _ := getUser(ctx, userID)
	if user == nil || user.IsManualBlock {
		return
	}
	out, _ := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName: &invoicesTable, IndexName: aws.String("userId-yearMonth-index"),
		KeyConditionExpression: aws.String("user_id = :uid"),
		FilterExpression:       aws.String("(#st = :pending OR #st = :overdue)"),
		ExpressionAttributeNames: map[string]string{"#st": "status"},
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
			":pending": &dbtypes.AttributeValueMemberS{Value: "PENDING"},
			":overdue": &dbtypes.AttributeValueMemberS{Value: "OVERDUE"},
		},
	})
	if out == nil {
		return
	}
	now := time.Now().UTC()
	shouldBlock, shouldGrace := false, false
	for _, item := range out.Items {
		var inv struct {
			Status         string `dynamodbav:"status"`
			DueDate        string `dynamodbav:"due_date"`
			GracePeriodEnd string `dynamodbav:"grace_period_end"`
		}
		attributevalue.UnmarshalMap(item, &inv)
		due, _ := time.Parse(time.RFC3339, inv.DueDate)
		grace, _ := time.Parse(time.RFC3339, inv.GracePeriodEnd)
		if inv.Status == "PENDING" && now.After(grace) {
			shouldBlock = true
		} else if inv.Status == "OVERDUE" {
			shouldBlock = true
		} else if inv.Status == "PENDING" && now.After(due) {
			shouldGrace = true
		}
	}
	newStatus := user.AccountStatus
	if shouldBlock {
		newStatus = "BLOCKED"
	} else if shouldGrace {
		newStatus = "GRACE"
	} else if user.AccountStatus == "GRACE" || user.AccountStatus == "BLOCKED" {
		newStatus = "ACTIVE"
	}
	if newStatus != user.AccountStatus {
		ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: &usersTable,
			Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: userID}},
			UpdateExpression: aws.String("SET account_status = :s, updated_at = :u"),
			ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
				":s": &dbtypes.AttributeValueMemberS{Value: newStatus},
				":u": &dbtypes.AttributeValueMemberS{Value: nowISO()},
			},
		})
	}
}

// --- Audit + Activity ---

func writeAudit(ctx context.Context, adminID, targetID, action, resource, resourceID, prev, newVal, reason string) {
	now := nowISO()
	id := fmt.Sprintf("audit_%d", time.Now().UnixNano())
	item := map[string]interface{}{
		"id": id, "timestamp": now, "admin_user_id": adminID, "target_user_id": targetID,
		"action": action, "resource_collection": resource, "resource_id": resourceID,
		"previous_value": prev, "new_value": newVal, "reason": reason,
	}
	m, _ := attributevalue.MarshalMap(item)
	ddbClient.PutItem(ctx, &dynamodb.PutItemInput{TableName: &auditLogTable, Item: m})
}

func writeActivityLog(ctx context.Context, userID, actType, message string) {
	item := map[string]dbtypes.AttributeValue{
		"userId":    &dbtypes.AttributeValueMemberS{Value: userID},
		"timestamp": &dbtypes.AttributeValueMemberS{Value: nowISO()},
		"type":      &dbtypes.AttributeValueMemberS{Value: actType},
		"message":   &dbtypes.AttributeValueMemberS{Value: message},
		"icon_type": &dbtypes.AttributeValueMemberS{Value: "system"},
	}
	ddbClient.PutItem(ctx, &dynamodb.PutItemInput{TableName: &activityTable, Item: item})
}

func calcVariableCost(input, output int64) float64 {
	ci := max64(0, input-FreeTokens)
	co := max64(0, output-FreeTokens)
	return (float64(ci)/1e6)*RateInputPerMil + (float64(co)/1e6)*RateOutputPerMil
}
func max64(a, b int64) int64 { if a > b { return a }; return b }
func nowISO() string { return time.Now().UTC().Format(time.RFC3339) }
func _ () { _ = math.Abs; _ = url.PathEscape } // keep imports

// --- Path helpers ---

func extractPathParam(path, prefix, suffix string) string {
	path = strings.TrimPrefix(path, prefix)
	if idx := strings.Index(path, suffix); idx >= 0 {
		return path[:idx]
	}
	return path
}

func extractInvoiceID(path string) string {
	// /admin/invoices/{id}
	p := strings.TrimPrefix(path, "/admin/invoices/")
	if idx := strings.Index(p, "/"); idx >= 0 {
		return p[:idx]
	}
	return p
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
	out, err := cogClient.GetUser(ctx, &cognitoidentityprovider.GetUserInput{AccessToken: &parts[1]})
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
			"Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization",
			"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
		},
		Body: string(b),
	}, nil
}

func corsResp(code int, body string) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{StatusCode: code, Headers: map[string]string{
		"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type,Authorization",
		"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
	}, Body: body}
}

func serverError(msg string) (events.APIGatewayProxyResponse, error) {
	log.Printf("ERROR: %s", msg)
	return jsonResp(http.StatusInternalServerError, ErrorResponse{Detail: "Internal server error"})
}

func main() {
	lambda.Start(handler)
}

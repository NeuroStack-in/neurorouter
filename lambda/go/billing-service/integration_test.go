// +build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	cip "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	ciptypes "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Run with: go test -tags integration -v -count=1 -timeout 120s ./...

func init() {
	setEnv("TABLE_USERS", "neurorouter-users-dev")
	setEnv("TABLE_INVOICES", "neurorouter-invoices-dev")
	setEnv("TABLE_USAGE_MONTHLY", "neurorouter-usage-monthly-dev")
	setEnv("TABLE_PLAN_CATALOG", "neurorouter-plan-catalog-dev")
	setEnv("PDF_BUCKET", "neurorouter-invoice-pdfs-dev")
	setEnv("PDF_LAMBDA_FUNCTION", "neurorouter-invoice-pdf-service-dev")
	setEnv("COGNITO_USER_POOL_ID", "ap-south-1_Rx2PCbjA8")
	setEnv("COGNITO_APP_CLIENT_ID", "3ol7kmafc07812mvb47g4enklo")
	setEnv("AWS_REGION", "ap-south-1")
}

func setEnv(k, v string) {
	if os.Getenv(k) == "" {
		os.Setenv(k, v)
	}
}

// setupBillingTestUser creates a user with ACTIVE status, seeds usage + invoice data.
func setupBillingTestUser(t *testing.T, ctx context.Context) (string, string, string) {
	t.Helper()
	cfg, _ := awsconfig.LoadDefaultConfig(ctx)
	cogCli := cip.NewFromConfig(cfg)
	ddbCli := dynamodb.NewFromConfig(cfg)

	email := fmt.Sprintf("billing_test_%d@integrationtest.neurorouter.dev", time.Now().UnixNano())
	password := "TestPass123"
	poolID := os.Getenv("COGNITO_USER_POOL_ID")
	clientID := os.Getenv("COGNITO_APP_CLIENT_ID")

	out, _ := cogCli.SignUp(ctx, &cip.SignUpInput{
		ClientId: &clientID, Username: &email, Password: &password,
		UserAttributes: []ciptypes.AttributeType{{Name: aws.String("email"), Value: aws.String(email)}},
	})
	userSub := aws.ToString(out.UserSub)
	cogCli.AdminConfirmSignUp(ctx, &cip.AdminConfirmSignUpInput{UserPoolId: &poolID, Username: &email})
	time.Sleep(2 * time.Second)

	// Set ACTIVE + plan
	tbl := os.Getenv("TABLE_USERS")
	ddbCli.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tbl,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: userSub}},
		UpdateExpression: aws.String("SET account_status = :s, plan_id = :p, full_name = :n"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: "ACTIVE"},
			":p": &dbtypes.AttributeValueMemberS{Value: "developer"},
			":n": &dbtypes.AttributeValueMemberS{Value: "Billing Test User"},
		},
	})

	// Seed usage
	usageTbl := os.Getenv("TABLE_USAGE_MONTHLY")
	ym := time.Now().UTC().Format("2006-01")
	usageItem := map[string]interface{}{
		"userId":        userSub,
		"sk":            ym + "#MODEL#llama-3.3-70b-versatile#KEY#testkey",
		"input_tokens":  int64(2_000_000),
		"output_tokens": int64(500_000),
	}
	item, _ := attributevalue.MarshalMap(usageItem)
	ddbCli.PutItem(ctx, &dynamodb.PutItemInput{TableName: &usageTbl, Item: item})

	// Seed invoice
	invoiceID := fmt.Sprintf("inv_%d", time.Now().UnixNano())
	invTbl := os.Getenv("TABLE_INVOICES")
	now := time.Now().UTC()
	dueDate := now.AddDate(0, 1, 5).Format(time.RFC3339)
	graceEnd := now.AddDate(0, 1, 10).Format(time.RFC3339)

	invItem := map[string]interface{}{
		"id":                    invoiceID,
		"user_id":               userSub,
		"invoice_number":        fmt.Sprintf("INV-%s-%s", ym, userSub[:8]),
		"year_month":            ym,
		"status":                "PENDING",
		"due_date":              dueDate,
		"grace_period_end":      graceEnd,
		"total_input_tokens":    int64(2_000_000),
		"total_output_tokens":   int64(500_000),
		"rate_input_usd_per_1m": float64(2.0),
		"rate_output_usd_per_1m": float64(8.0),
		"fixed_fee_inr":         float64(1599.0),
		"variable_cost_usd":     float64(2.0), // (2M-1M)/1M * 2 = 2.0
		"fixed_cost_inr":        float64(1599.0),
		"total_due_display":     "₹1599.00 + $2.00",
		"created_at":            now.Format(time.RFC3339),
		"updated_at":            now.Format(time.RFC3339),
	}
	invItemM, _ := attributevalue.MarshalMap(invItem)
	ddbCli.PutItem(ctx, &dynamodb.PutItemInput{TableName: &invTbl, Item: invItemM})

	// Login
	authOut, _ := cogCli.InitiateAuth(ctx, &cip.InitiateAuthInput{
		ClientId: &clientID,
		AuthFlow: ciptypes.AuthFlowTypeUserPasswordAuth,
		AuthParameters: map[string]string{"USERNAME": email, "PASSWORD": password},
	})
	accessToken := aws.ToString(authOut.AuthenticationResult.AccessToken)

	t.Logf("Test user: %s (sub=%s) invoice=%s", email, userSub, invoiceID)
	return userSub, accessToken, invoiceID
}

func makeReq(method, path, userID, token string) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{
		HTTPMethod: method,
		Path:       path,
		Headers:    map[string]string{"Authorization": "Bearer " + token},
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{
				"claims": map[string]interface{}{"sub": userID},
			},
		},
	}
}

// --- Test 1: GET /billing/me ---

func TestIntegration_BillingMe(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	userID, token, _ := setupBillingTestUser(t, ctx)

	req := makeReq("GET", "/billing/me", userID, token)
	resp, err := handler(ctx, req)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	t.Logf("BillingMe: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, resp.Body)
	}

	var dashboard BillingDashboard
	json.Unmarshal([]byte(resp.Body), &dashboard)

	// Verify current month usage
	if dashboard.CurrentMonth.InputTokens < 2_000_000 {
		t.Errorf("input_tokens = %d, want >= 2M", dashboard.CurrentMonth.InputTokens)
	}
	if dashboard.CurrentMonth.FixedFeeINR != 1599.0 {
		t.Errorf("fixed_fee = %.2f, want 1599.00", dashboard.CurrentMonth.FixedFeeINR)
	}
	// Variable cost: (2M-1M free)/1M * $2 = $2.00
	if dashboard.CurrentMonth.EstimatedVariableUSD < 1.99 {
		t.Errorf("variable_usd = %.2f, want ~2.00", dashboard.CurrentMonth.EstimatedVariableUSD)
	}

	if dashboard.AccountStatus != "ACTIVE" {
		t.Errorf("status = %q, want ACTIVE", dashboard.AccountStatus)
	}
	if len(dashboard.PastInvoices) < 1 {
		t.Error("expected at least 1 past invoice")
	}
	if dashboard.GraceBanner.Show {
		t.Error("grace banner should not show for ACTIVE user")
	}

	t.Logf("BillingMe OK: in=%d out=%d variable=$%.2f invoices=%d status=%s",
		dashboard.CurrentMonth.InputTokens, dashboard.CurrentMonth.OutputTokens,
		dashboard.CurrentMonth.EstimatedVariableUSD, len(dashboard.PastInvoices), dashboard.AccountStatus)
}

// --- Test 2: GET /billing/invoices/{id} ---

func TestIntegration_InvoiceDetail(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	userID, token, invoiceID := setupBillingTestUser(t, ctx)

	req := makeReq("GET", "/billing/invoices/"+invoiceID, userID, token)
	resp, _ := handler(ctx, req)
	t.Logf("InvoiceDetail: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var inv Invoice
	json.Unmarshal([]byte(resp.Body), &inv)
	if inv.ID != invoiceID {
		t.Errorf("id = %q, want %q", inv.ID, invoiceID)
	}
	if inv.Status != "PENDING" {
		t.Errorf("status = %q, want PENDING", inv.Status)
	}
	if inv.TotalDueDisplay != "₹1599.00 + $2.00" {
		t.Errorf("total_due = %q", inv.TotalDueDisplay)
	}
	t.Logf("InvoiceDetail OK: %s %s %s", inv.InvoiceNumber, inv.Status, inv.TotalDueDisplay)
}

// --- Test 3: Invoice not found ---

func TestIntegration_InvoiceNotFound(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	userID, token, _ := setupBillingTestUser(t, ctx)

	req := makeReq("GET", "/billing/invoices/nonexistent-id", userID, token)
	resp, _ := handler(ctx, req)
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
	t.Logf("Not found: %d (correct)", resp.StatusCode)
}

// --- Test 4: Invoice belongs to another user ---

func TestIntegration_InvoiceForeignUser(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	_, _, invoiceID := setupBillingTestUser(t, ctx)
	userID2, token2, _ := setupBillingTestUser(t, ctx) // different user
	_ = userID2

	req := makeReq("GET", "/billing/invoices/"+invoiceID, userID2, token2)
	resp, _ := handler(ctx, req)
	if resp.StatusCode != 404 {
		t.Errorf("expected 404 for foreign invoice, got %d", resp.StatusCode)
	}
	t.Logf("Foreign invoice: %d (correct)", resp.StatusCode)
}

// --- Test 5: No auth ---

func TestIntegration_BillingNoAuth(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	req := events.APIGatewayProxyRequest{HTTPMethod: "GET", Path: "/billing/me", Headers: map[string]string{}}
	resp, _ := handler(ctx, req)
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
	t.Logf("No auth: %d (correct)", resp.StatusCode)
}

// --- Test 6: Variable cost calculation ---

func TestVariableCostCalculation(t *testing.T) {
	tests := []struct {
		name     string
		input    int64
		output   int64
		wantCost float64
	}{
		{"under free tier", 500_000, 500_000, 0.0},
		{"at free tier", 1_000_000, 1_000_000, 0.0},
		{"1M over input", 2_000_000, 500_000, 2.0},  // (2M-1M)/1M * $2
		{"1M over output", 500_000, 2_000_000, 8.0},  // (2M-1M)/1M * $8
		{"both over", 2_000_000, 2_000_000, 10.0},     // $2 + $8
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := calculateVariableCost(tt.input, tt.output)
			if math_abs(got-tt.wantCost) > 0.01 {
				t.Errorf("calculateVariableCost(%d, %d) = %.2f, want %.2f", tt.input, tt.output, got, tt.wantCost)
			}
		})
	}
}

func math_abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

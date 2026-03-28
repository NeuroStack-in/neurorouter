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
	cip "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	ciptypes "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func init() {
	setEnv("TABLE_USERS", "neurorouter-users-dev")
	setEnv("TABLE_INVOICES", "neurorouter-invoices-dev")
	setEnv("TABLE_API_KEYS", "neurorouter-api-keys-dev")
	setEnv("TABLE_USAGE_MONTHLY", "neurorouter-usage-monthly-dev")
	setEnv("TABLE_ADMIN_AUDIT_LOG", "neurorouter-admin-audit-log-dev")
	setEnv("TABLE_ACTIVITY_LOG", "neurorouter-activity-log-dev")
	setEnv("TABLE_PLAN_CATALOG", "neurorouter-plan-catalog-dev")
	setEnv("COGNITO_USER_POOL_ID", "ap-south-1_Rx2PCbjA8")
	setEnv("COGNITO_APP_CLIENT_ID", "3ol7kmafc07812mvb47g4enklo")
	setEnv("AWS_REGION", "ap-south-1")
}

func setEnv(k, v string) {
	if os.Getenv(k) == "" {
		os.Setenv(k, v)
	}
}

// createUser registers a Cognito user, waits for DynamoDB row, returns (sub, email)
func createUser(t *testing.T, ctx context.Context) (string, string) {
	t.Helper()
	cfg, _ := awsconfig.LoadDefaultConfig(ctx)
	cogCli := cip.NewFromConfig(cfg)
	email := fmt.Sprintf("admin_test_%d@integrationtest.neurorouter.dev", time.Now().UnixNano())
	password := "TestPass123"
	poolID := os.Getenv("COGNITO_USER_POOL_ID")
	clientID := os.Getenv("COGNITO_APP_CLIENT_ID")
	out, err := cogCli.SignUp(ctx, &cip.SignUpInput{
		ClientId: &clientID, Username: &email, Password: &password,
		UserAttributes: []ciptypes.AttributeType{{Name: aws.String("email"), Value: aws.String(email)}},
	})
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	cogCli.AdminConfirmSignUp(ctx, &cip.AdminConfirmSignUpInput{UserPoolId: &poolID, Username: &email})
	time.Sleep(2 * time.Second)
	return aws.ToString(out.UserSub), email
}

func adminReq(method, path, adminID, body string) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{
		HTTPMethod: method, Path: path, Body: body,
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{"claims": map[string]interface{}{"sub": adminID}},
		},
	}
}

// --- Tests ---

func TestIntegration_ListUsers(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}
	resp, _ := handler(ctx, adminReq("GET", "/admin/users", "admin-test", ""))
	t.Logf("ListUsers: %d (body length=%d)", resp.StatusCode, len(resp.Body))
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var users []User
	json.Unmarshal([]byte(resp.Body), &users)
	if len(users) == 0 {
		t.Error("expected at least 1 user")
	}
	t.Logf("ListUsers OK: %d users", len(users))
}

func TestIntegration_RejectUser(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}
	userSub, _ := createUser(t, ctx)

	resp, _ := handler(ctx, adminReq("POST", "/admin/users/"+userSub+"/reject", "admin-test",
		`{"reason":"Test rejection"}`))
	t.Logf("Reject: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	// Verify user is REJECTED
	user, _ := getUser(ctx, userSub)
	if user.AccountStatus != "REJECTED" {
		t.Errorf("status = %q, want REJECTED", user.AccountStatus)
	}
	t.Log("Reject OK")
}

func TestIntegration_ChangeStatus(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}
	userSub, _ := createUser(t, ctx)

	resp, _ := handler(ctx, adminReq("POST", "/admin/users/"+userSub+"/status", "admin-test",
		`{"status":"BLOCKED","reason":"Security concern"}`))
	t.Logf("ChangeStatus: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	user, _ := getUser(ctx, userSub)
	if user.AccountStatus != "BLOCKED" {
		t.Errorf("status = %q, want BLOCKED", user.AccountStatus)
	}
	if !user.IsManualBlock {
		t.Error("is_manual_block should be true")
	}
	t.Log("ChangeStatus OK — BLOCKED with is_manual_block=true")
}

func TestIntegration_MarkPaidAndUnpaid(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}
	userSub, _ := createUser(t, ctx)

	// Set user to ACTIVE
	cfg, _ := awsconfig.LoadDefaultConfig(ctx)
	ddbCli := dynamodb.NewFromConfig(cfg)
	tbl := os.Getenv("TABLE_USERS")
	ddbCli.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tbl,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: userSub}},
		UpdateExpression: aws.String("SET account_status = :s"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{":s": &dbtypes.AttributeValueMemberS{Value: "BLOCKED"}},
	})

	// Create an invoice
	invID := fmt.Sprintf("inv_%d", time.Now().UnixNano())
	invTbl := os.Getenv("TABLE_INVOICES")
	now := time.Now().UTC().Format(time.RFC3339)
	invItem := map[string]dbtypes.AttributeValue{
		"id":                &dbtypes.AttributeValueMemberS{Value: invID},
		"user_id":           &dbtypes.AttributeValueMemberS{Value: userSub},
		"invoice_number":    &dbtypes.AttributeValueMemberS{Value: "INV-TEST-PAY"},
		"year_month":        &dbtypes.AttributeValueMemberS{Value: "2026-03"},
		"status":            &dbtypes.AttributeValueMemberS{Value: "PENDING"},
		"due_date":          &dbtypes.AttributeValueMemberS{Value: now},
		"grace_period_end":  &dbtypes.AttributeValueMemberS{Value: now},
		"total_due_display": &dbtypes.AttributeValueMemberS{Value: "₹1599.00"},
		"created_at":        &dbtypes.AttributeValueMemberS{Value: now},
		"updated_at":        &dbtypes.AttributeValueMemberS{Value: now},
	}
	ddbCli.PutItem(ctx, &dynamodb.PutItemInput{TableName: &invTbl, Item: invItem})

	// Mark PAID
	resp, _ := handler(ctx, adminReq("POST", "/admin/invoices/"+invID+"/pay", "admin-test", ""))
	t.Logf("MarkPaid: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	// Verify user is ACTIVE
	user, _ := getUser(ctx, userSub)
	if user.AccountStatus != "ACTIVE" {
		t.Errorf("after pay: status = %q, want ACTIVE", user.AccountStatus)
	}

	// Mark UNPAID
	resp2, _ := handler(ctx, adminReq("POST", "/admin/invoices/"+invID+"/unpay", "admin-test", ""))
	t.Logf("MarkUnpaid: %d %s", resp2.StatusCode, resp2.Body)
	if resp2.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp2.StatusCode)
	}

	// Verify invoice is PENDING again
	inv, _ := getInvoice(ctx, invID)
	if inv.Status != "PENDING" {
		t.Errorf("after unpay: invoice status = %q, want PENDING", inv.Status)
	}
	t.Log("MarkPaid + MarkUnpaid OK")
}

func TestIntegration_UpdateInvoice(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}
	userSub, _ := createUser(t, ctx)

	invID := fmt.Sprintf("inv_%d", time.Now().UnixNano())
	invTbl := os.Getenv("TABLE_INVOICES")
	now := time.Now().UTC().Format(time.RFC3339)
	invItem := map[string]dbtypes.AttributeValue{
		"id": &dbtypes.AttributeValueMemberS{Value: invID},
		"user_id": &dbtypes.AttributeValueMemberS{Value: userSub},
		"invoice_number": &dbtypes.AttributeValueMemberS{Value: "INV-TEST-UPD"},
		"year_month": &dbtypes.AttributeValueMemberS{Value: "2026-03"},
		"status": &dbtypes.AttributeValueMemberS{Value: "PENDING"},
		"due_date": &dbtypes.AttributeValueMemberS{Value: now},
		"grace_period_end": &dbtypes.AttributeValueMemberS{Value: now},
		"created_at": &dbtypes.AttributeValueMemberS{Value: now},
		"updated_at": &dbtypes.AttributeValueMemberS{Value: now},
	}
	cfg, _ := awsconfig.LoadDefaultConfig(ctx)
	dynamodb.NewFromConfig(cfg).PutItem(ctx, &dynamodb.PutItemInput{TableName: &invTbl, Item: invItem})

	newDue := time.Now().UTC().AddDate(0, 2, 0).Format(time.RFC3339)
	body := fmt.Sprintf(`{"due_date":"%s"}`, newDue)
	resp, _ := handler(ctx, adminReq("PUT", "/admin/invoices/"+invID, "admin-test", body))
	t.Logf("UpdateInvoice: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	inv, _ := getInvoice(ctx, invID)
	if inv.DueDate != newDue {
		t.Errorf("due_date not updated: got %q, want %q", inv.DueDate, newDue)
	}
	t.Log("UpdateInvoice OK — due date updated")
}

func TestIntegration_AuditLogs(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	resp, _ := handler(ctx, adminReq("GET", "/admin/audit-logs", "admin-test", ""))
	t.Logf("AuditLogs: %d (body length=%d)", resp.StatusCode, len(resp.Body))
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var entries []AuditEntry
	json.Unmarshal([]byte(resp.Body), &entries)
	t.Logf("AuditLogs OK: %d entries", len(entries))
}

func TestIntegration_AdminNoAuth(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}
	req := events.APIGatewayProxyRequest{HTTPMethod: "GET", Path: "/admin/users", Headers: map[string]string{}}
	resp, _ := handler(ctx, req)
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

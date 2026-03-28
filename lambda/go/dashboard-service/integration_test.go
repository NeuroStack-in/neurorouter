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

func init() {
	setEnv("TABLE_USERS", "neurorouter-users-dev")
	setEnv("TABLE_USAGE_MONTHLY", "neurorouter-usage-monthly-dev")
	setEnv("TABLE_API_KEYS", "neurorouter-api-keys-dev")
	setEnv("TABLE_ACTIVITY_LOG", "neurorouter-activity-log-dev")
	setEnv("TABLE_INVOICES", "neurorouter-invoices-dev")
	setEnv("COGNITO_USER_POOL_ID", "ap-south-1_Rx2PCbjA8")
	setEnv("COGNITO_APP_CLIENT_ID", "3ol7kmafc07812mvb47g4enklo")
	setEnv("AWS_REGION", "ap-south-1")
}

func setEnv(k, v string) {
	if os.Getenv(k) == "" {
		os.Setenv(k, v)
	}
}

// createTestUserWithUsage creates a Cognito user, sets ACTIVE, seeds usage data, returns (userID, accessToken).
func createTestUserWithUsage(t *testing.T, ctx context.Context) (string, string) {
	t.Helper()
	cfg, _ := awsconfig.LoadDefaultConfig(ctx)
	cogCli := cip.NewFromConfig(cfg)
	ddbCli := dynamodb.NewFromConfig(cfg)

	email := fmt.Sprintf("dash_test_%d@integrationtest.neurorouter.dev", time.Now().UnixNano())
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
	userSub := aws.ToString(out.UserSub)
	cogCli.AdminConfirmSignUp(ctx, &cip.AdminConfirmSignUpInput{UserPoolId: &poolID, Username: &email})
	time.Sleep(2 * time.Second)

	// Set to ACTIVE
	tbl := os.Getenv("TABLE_USERS")
	ddbCli.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &tbl,
		Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: userSub}},
		UpdateExpression: aws.String("SET account_status = :s, full_name = :n"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":s": &dbtypes.AttributeValueMemberS{Value: "ACTIVE"},
			":n": &dbtypes.AttributeValueMemberS{Value: "Dashboard Test User"},
		},
	})

	// Seed usage data
	usageTbl := os.Getenv("TABLE_USAGE_MONTHLY")
	usageItem := map[string]interface{}{
		"userId":        userSub,
		"sk":            "2026-03#MODEL#llama-3.3-70b-versatile#KEY#testkey1",
		"input_tokens":  int64(50000),
		"output_tokens": int64(25000),
		"total_tokens":  int64(75000),
		"request_count": int64(100),
	}
	item, _ := attributevalue.MarshalMap(usageItem)
	ddbCli.PutItem(ctx, &dynamodb.PutItemInput{TableName: &usageTbl, Item: item})

	// Seed activity log
	actTbl := os.Getenv("TABLE_ACTIVITY_LOG")
	actItem := map[string]dbtypes.AttributeValue{
		"userId":    &dbtypes.AttributeValueMemberS{Value: userSub},
		"timestamp": &dbtypes.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
		"type":      &dbtypes.AttributeValueMemberS{Value: "key"},
		"message":   &dbtypes.AttributeValueMemberS{Value: "Test activity entry"},
		"icon_type": &dbtypes.AttributeValueMemberS{Value: "key"},
	}
	ddbCli.PutItem(ctx, &dynamodb.PutItemInput{TableName: &actTbl, Item: actItem})

	// Login for token
	authOut, _ := cogCli.InitiateAuth(ctx, &cip.InitiateAuthInput{
		ClientId: &clientID,
		AuthFlow: ciptypes.AuthFlowTypeUserPasswordAuth,
		AuthParameters: map[string]string{"USERNAME": email, "PASSWORD": password},
	})
	accessToken := aws.ToString(authOut.AuthenticationResult.AccessToken)

	t.Logf("Test user: %s (sub=%s)", email, userSub)
	return userSub, accessToken
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

func TestIntegration_DashboardOverview(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	userID, token := createTestUserWithUsage(t, ctx)

	req := makeReq("GET", "/dashboard/overview", userID, token)
	resp, err := handler(ctx, req)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	t.Logf("Overview: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, resp.Body)
	}

	var overview DashboardOverview
	json.Unmarshal([]byte(resp.Body), &overview)

	if overview.UserName == "" {
		t.Error("user_name is empty")
	}
	if overview.TotalTokens < 75000 {
		t.Errorf("total_tokens = %d, want >= 75000", overview.TotalTokens)
	}
	if overview.TotalRequests < 100 {
		t.Errorf("total_requests = %d, want >= 100", overview.TotalRequests)
	}
	if overview.AccountStatus != "ACTIVE" {
		t.Errorf("account_status = %q, want ACTIVE", overview.AccountStatus)
	}
	t.Logf("Overview OK: name=%s tokens=%d requests=%d keys=%d status=%s activities=%d graceBanner=%v",
		overview.UserName, overview.TotalTokens, overview.TotalRequests,
		overview.ActiveKeys, overview.AccountStatus, len(overview.RecentActivity), overview.GraceBanner.Show)
}

func TestIntegration_DashboardUsage(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	userID, token := createTestUserWithUsage(t, ctx)

	// Without filters
	req := makeReq("GET", "/dashboard/usage", userID, token)
	req.QueryStringParameters = map[string]string{}
	resp, _ := handler(ctx, req)
	t.Logf("Usage (no filter): %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var stats UsageStats
	json.Unmarshal([]byte(resp.Body), &stats)
	if stats.TotalInputTokens < 50000 {
		t.Errorf("input_tokens = %d, want >= 50000", stats.TotalInputTokens)
	}
	if stats.TotalOutputTokens < 25000 {
		t.Errorf("output_tokens = %d, want >= 25000", stats.TotalOutputTokens)
	}
	if len(stats.ChartData) == 0 {
		t.Error("chart_data is empty")
	}
	t.Logf("Usage OK: in=%d out=%d reqs=%d chart_points=%d",
		stats.TotalInputTokens, stats.TotalOutputTokens, stats.TotalRequests, len(stats.ChartData))

	// With model filter
	req2 := makeReq("GET", "/dashboard/usage", userID, token)
	req2.QueryStringParameters = map[string]string{"model": "llama-3.3-70b-versatile"}
	resp2, _ := handler(ctx, req2)
	var stats2 UsageStats
	json.Unmarshal([]byte(resp2.Body), &stats2)
	if stats2.TotalInputTokens < 50000 {
		t.Errorf("filtered input = %d, want >= 50000", stats2.TotalInputTokens)
	}
	t.Logf("Usage filtered by model: in=%d out=%d", stats2.TotalInputTokens, stats2.TotalOutputTokens)

	// With non-matching model filter
	req3 := makeReq("GET", "/dashboard/usage", userID, token)
	req3.QueryStringParameters = map[string]string{"model": "nonexistent-model"}
	resp3, _ := handler(ctx, req3)
	var stats3 UsageStats
	json.Unmarshal([]byte(resp3.Body), &stats3)
	if stats3.TotalInputTokens != 0 {
		t.Errorf("non-matching filter should return 0 tokens, got %d", stats3.TotalInputTokens)
	}
	t.Log("Usage filtered by non-matching model: 0 tokens (correct)")
}

func TestIntegration_DashboardExport(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	userID, token := createTestUserWithUsage(t, ctx)

	req := makeReq("POST", "/dashboard/usage/export", userID, token)
	req.Body = `{"yearMonth":"2026-03"}`
	resp, _ := handler(ctx, req)
	t.Logf("Export: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var export ExportResponse
	json.Unmarshal([]byte(resp.Body), &export)
	if export.ExportID == "" {
		t.Error("exportId is empty")
	}
	if export.Status != "QUEUED" {
		t.Errorf("status = %q, want QUEUED", export.Status)
	}
	t.Logf("Export OK: id=%s status=%s", export.ExportID, export.Status)
}

func TestIntegration_DashboardNoAuth(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	req := events.APIGatewayProxyRequest{HTTPMethod: "GET", Path: "/dashboard/overview", Headers: map[string]string{}}
	resp, _ := handler(ctx, req)
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
	t.Logf("No auth: %d (correct)", resp.StatusCode)
}

// +build integration

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	setEnv("TABLE_API_KEYS", "neurorouter-api-keys-dev")
	setEnv("TABLE_USERS", "neurorouter-users-dev")
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

// setupTestUser creates a Cognito user + DynamoDB API key, returns (userID, rawAPIKey).
func setupTestUser(t *testing.T, ctx context.Context, status string) (string, string) {
	t.Helper()

	cfg, _ := awsconfig.LoadDefaultConfig(ctx)
	cogCli := cip.NewFromConfig(cfg)
	ddbCli := dynamodb.NewFromConfig(cfg)

	email := fmt.Sprintf("authz_test_%d@integrationtest.neurorouter.dev", time.Now().UnixNano())
	password := "TestPass123"
	poolID := os.Getenv("COGNITO_USER_POOL_ID")
	clientID := os.Getenv("COGNITO_APP_CLIENT_ID")

	// Create Cognito user
	out, err := cogCli.SignUp(ctx, &cip.SignUpInput{
		ClientId: &clientID, Username: &email, Password: &password,
		UserAttributes: []ciptypes.AttributeType{
			{Name: aws.String("email"), Value: aws.String(email)},
		},
	})
	if err != nil {
		t.Fatalf("signup: %v", err)
	}
	userSub := aws.ToString(out.UserSub)
	cogCli.AdminConfirmSignUp(ctx, &cip.AdminConfirmSignUpInput{
		UserPoolId: &poolID, Username: &email,
	})

	// Wait for Post-Confirmation trigger to create DynamoDB row
	time.Sleep(2 * time.Second)

	// Override status if needed
	if status != "" && status != "PENDING_APPROVAL" {
		tbl := os.Getenv("TABLE_USERS")
		// For BLOCKED: also set is_manual_block so billing refresh doesn't auto-unblock
		isManualBlock := status == "BLOCKED"
		ddbCli.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: &tbl,
			Key:       map[string]dbtypes.AttributeValue{"id": &dbtypes.AttributeValueMemberS{Value: userSub}},
			UpdateExpression: aws.String("SET account_status = :s, is_active = :a, is_manual_block = :m"),
			ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
				":s": &dbtypes.AttributeValueMemberS{Value: status},
				":a": &dbtypes.AttributeValueMemberBOOL{Value: true},
				":m": &dbtypes.AttributeValueMemberBOOL{Value: isManualBlock},
			},
		})
	}

	// Create an API key in DynamoDB
	rawKey := fmt.Sprintf("neurorouter_%013d", time.Now().UnixNano()%1e13)
	// Ensure it's exactly 25 chars and alphanumeric for the suffix
	suffix := fmt.Sprintf("%013d", time.Now().UnixNano()%10000000000000)
	rawKey = "neurorouter_" + suffix
	h := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(h[:])

	keyItem := map[string]interface{}{
		"id":               fmt.Sprintf("key_%d", time.Now().UnixNano()),
		"user_id":          userSub,
		"key_hash":         keyHash,
		"key_prefix":       rawKey[:16],
		"masked_reference": rawKey[:16] + "****",
		"is_active":        true,
		"created_at":       time.Now().UTC().Format(time.RFC3339),
	}
	item, _ := attributevalue.MarshalMap(keyItem)
	tbl := os.Getenv("TABLE_API_KEYS")
	ddbCli.PutItem(ctx, &dynamodb.PutItemInput{TableName: &tbl, Item: item})

	t.Logf("Test user: sub=%s status=%s key=%s...", userSub, status, rawKey[:20])
	return userSub, rawKey
}

func makeAuthReq(token string) events.APIGatewayCustomAuthorizerRequest {
	return events.APIGatewayCustomAuthorizerRequest{
		AuthorizationToken: "Bearer " + token,
		MethodArn:          "arn:aws:execute-api:ap-south-1:896823725438:u87jos3lg5/dev/POST/v1/chat/completions",
	}
}

// --- Test 1: Valid ACTIVE user key → Allow ---

func TestIntegration_AuthorizerAllow(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	_, rawKey := setupTestUser(t, ctx, "ACTIVE")

	resp, err := handler(ctx, makeAuthReq(rawKey))
	if err != nil {
		t.Fatalf("handler: %v", err)
	}

	if len(resp.PolicyDocument.Statement) == 0 {
		t.Fatal("no policy statements")
	}
	effect := resp.PolicyDocument.Statement[0].Effect
	t.Logf("Effect: %s, PrincipalID: %s, Context: %v", effect, resp.PrincipalID, resp.Context)

	if effect != "Allow" {
		t.Fatalf("expected Allow, got %s", effect)
	}
	if resp.Context["userId"] == nil || resp.Context["userId"] == "" {
		t.Error("missing userId in context")
	}
	if resp.Context["apiKeyId"] == nil || resp.Context["apiKeyId"] == "" {
		t.Error("missing apiKeyId in context")
	}
	if resp.Context["planId"] == nil {
		t.Error("missing planId in context")
	}
	if resp.Context["accountStatus"] == nil {
		t.Error("missing accountStatus in context")
	}
	t.Log("ALLOW with full context — correct")
}

// --- Test 2: Invalid key format → Deny ---

func TestIntegration_AuthorizerInvalidFormat(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	resp, _ := handler(ctx, makeAuthReq("invalid-key-format"))
	effect := resp.PolicyDocument.Statement[0].Effect
	t.Logf("Invalid format: %s", effect)
	if effect != "Deny" {
		t.Errorf("expected Deny, got %s", effect)
	}
}

// --- Test 3: Valid format but non-existent key → Deny ---

func TestIntegration_AuthorizerNonExistentKey(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	resp, _ := handler(ctx, makeAuthReq("neurorouter_aaabbbcccddde"))
	effect := resp.PolicyDocument.Statement[0].Effect
	t.Logf("Non-existent key: %s", effect)
	if effect != "Deny" {
		t.Errorf("expected Deny, got %s", effect)
	}
}

// --- Test 4: Missing Authorization header → Deny ---

func TestIntegration_AuthorizerNoHeader(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	req := events.APIGatewayCustomAuthorizerRequest{
		AuthorizationToken: "",
		MethodArn:          "arn:aws:execute-api:ap-south-1:896823725438:u87jos3lg5/dev/POST/v1/chat/completions",
	}
	resp, _ := handler(ctx, req)
	effect := resp.PolicyDocument.Statement[0].Effect
	t.Logf("No header: %s", effect)
	if effect != "Deny" {
		t.Errorf("expected Deny, got %s", effect)
	}
}

// --- Test 5: BLOCKED user key → Deny ---

func TestIntegration_AuthorizerBlockedUser(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	_, rawKey := setupTestUser(t, ctx, "BLOCKED")

	resp, _ := handler(ctx, makeAuthReq(rawKey))
	effect := resp.PolicyDocument.Statement[0].Effect
	t.Logf("Blocked user: %s, message=%v", effect, resp.Context["message"])
	if effect != "Deny" {
		t.Errorf("expected Deny for BLOCKED user, got %s", effect)
	}
}

// --- Test 6: PENDING_APPROVAL user key → Deny ---

func TestIntegration_AuthorizerPendingUser(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	_, rawKey := setupTestUser(t, ctx, "PENDING_APPROVAL")

	resp, _ := handler(ctx, makeAuthReq(rawKey))
	effect := resp.PolicyDocument.Statement[0].Effect
	t.Logf("Pending user: %s, message=%v", effect, resp.Context["message"])
	if effect != "Deny" {
		t.Errorf("expected Deny for PENDING_APPROVAL user, got %s", effect)
	}
}

// --- Test 7: GRACE user key → Allow (with grace days) ---

func TestIntegration_AuthorizerGraceUser(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	_, rawKey := setupTestUser(t, ctx, "GRACE")

	resp, _ := handler(ctx, makeAuthReq(rawKey))
	effect := resp.PolicyDocument.Statement[0].Effect
	t.Logf("Grace user: %s, context=%v", effect, resp.Context)
	if effect != "Allow" {
		t.Errorf("expected Allow for GRACE user, got %s", effect)
	}
}

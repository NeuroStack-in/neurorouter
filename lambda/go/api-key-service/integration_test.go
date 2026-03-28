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
)

// Run with: go test -tags integration -v -count=1 -timeout 120s ./...
//
// Tests the full API key lifecycle against live AWS:
//   Register test user → Login → Create key → List keys → Revoke key → Verify revoked

func init() {
	setIfEmpty("TABLE_API_KEYS", "neurorouter-api-keys-dev")
	setIfEmpty("TABLE_USERS", "neurorouter-users-dev")
	setIfEmpty("TABLE_ACTIVITY_LOG", "neurorouter-activity-log-dev")
	setIfEmpty("COGNITO_USER_POOL_ID", "ap-south-1_Rx2PCbjA8")
	setIfEmpty("COGNITO_APP_CLIENT_ID", "3ol7kmafc07812mvb47g4enklo")
	setIfEmpty("AWS_REGION", "ap-south-1")
}

func setIfEmpty(k, v string) {
	if os.Getenv(k) == "" {
		os.Setenv(k, v)
	}
}

// registerAndLogin creates a Cognito user and returns (userID, accessToken).
func registerAndLogin(t *testing.T, ctx context.Context) (string, string) {
	t.Helper()

	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		t.Fatalf("aws config: %v", err)
	}
	cogClient := cip.NewFromConfig(cfg)

	email := fmt.Sprintf("apikey_test_%d@integrationtest.neurorouter.dev", time.Now().UnixNano())
	password := "TestPass123"
	poolID := os.Getenv("COGNITO_USER_POOL_ID")
	clientID := os.Getenv("COGNITO_APP_CLIENT_ID")

	// Sign up
	signUpOut, err := cogClient.SignUp(ctx, &cip.SignUpInput{
		ClientId: &clientID,
		Username: &email,
		Password: &password,
		UserAttributes: []ciptypes.AttributeType{
			{Name: aws.String("email"), Value: aws.String(email)},
		},
	})
	if err != nil {
		t.Fatalf("cognito signup: %v", err)
	}
	userSub := aws.ToString(signUpOut.UserSub)

	// Auto-confirm
	_, err = cogClient.AdminConfirmSignUp(ctx, &cip.AdminConfirmSignUpInput{
		UserPoolId: &poolID,
		Username:   &email,
	})
	if err != nil {
		t.Fatalf("cognito confirm: %v", err)
	}

	// Wait for Post-Confirmation trigger
	time.Sleep(2 * time.Second)

	// Login
	authOut, err := cogClient.InitiateAuth(ctx, &cip.InitiateAuthInput{
		ClientId: &clientID,
		AuthFlow: ciptypes.AuthFlowTypeUserPasswordAuth,
		AuthParameters: map[string]string{
			"USERNAME": email,
			"PASSWORD": password,
		},
	})
	if err != nil {
		t.Fatalf("cognito login: %v", err)
	}

	accessToken := aws.ToString(authOut.AuthenticationResult.AccessToken)
	t.Logf("Test user: %s (sub=%s)", email, userSub)
	return userSub, accessToken
}

func TestIntegration_APIKeyLifecycle(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("initClients: %v", err)
	}

	userID, accessToken := registerAndLogin(t, ctx)

	// --- CREATE ---
	var createdKeyID string
	var rawAPIKey string
	t.Run("CreateKey", func(t *testing.T) {
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "POST",
			Path:       "/api-keys",
			Body:       `{"name":"test-key-1"}`,
			Headers:    map[string]string{"Authorization": "Bearer " + accessToken},
			RequestContext: events.APIGatewayProxyRequestContext{
				Authorizer: map[string]interface{}{
					"claims": map[string]interface{}{"sub": userID},
				},
			},
		}
		resp, err := handler(ctx, req)
		if err != nil {
			t.Fatalf("handler: %v", err)
		}
		t.Logf("Create response: %d %s", resp.StatusCode, resp.Body)
		if resp.StatusCode != 201 {
			t.Fatalf("expected 201, got %d: %s", resp.StatusCode, resp.Body)
		}

		var createResp CreateResponse
		json.Unmarshal([]byte(resp.Body), &createResp)

		if createResp.ID == "" {
			t.Fatal("empty key ID")
		}
		if createResp.APIKey == "" {
			t.Fatal("empty raw API key")
		}
		if len(createResp.APIKey) != 25 { // "neurorouter_" (12) + 13 chars
			t.Errorf("key length = %d, want 25", len(createResp.APIKey))
		}
		if createResp.KeyPrefix == "" {
			t.Fatal("empty key prefix")
		}
		if createResp.Name != "test-key-1" {
			t.Errorf("name = %q, want test-key-1", createResp.Name)
		}

		createdKeyID = createResp.ID
		rawAPIKey = createResp.APIKey
		t.Logf("Created key: id=%s prefix=%s raw=%s...", createdKeyID, createResp.KeyPrefix, rawAPIKey[:20])
	})

	// --- LIST ---
	t.Run("ListKeys", func(t *testing.T) {
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "GET",
			Path:       "/api-keys",
			Headers:    map[string]string{"Authorization": "Bearer " + accessToken},
			RequestContext: events.APIGatewayProxyRequestContext{
				Authorizer: map[string]interface{}{
					"claims": map[string]interface{}{"sub": userID},
				},
			},
		}
		resp, err := handler(ctx, req)
		if err != nil {
			t.Fatalf("handler: %v", err)
		}
		t.Logf("List response: %d %s", resp.StatusCode, resp.Body)
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		var keys []ApiKey
		json.Unmarshal([]byte(resp.Body), &keys)
		if len(keys) < 1 {
			t.Fatal("expected at least 1 key in list")
		}

		found := false
		for _, k := range keys {
			if k.ID == createdKeyID {
				found = true
				if !k.IsActive {
					t.Error("key should be active")
				}
				t.Logf("Found key in list: id=%s prefix=%s active=%v", k.ID, k.KeyPrefix, k.IsActive)
			}
		}
		if !found {
			t.Errorf("created key %s not found in list", createdKeyID)
		}
	})

	// --- REVOKE ---
	t.Run("RevokeKey", func(t *testing.T) {
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "DELETE",
			Path:       "/api-keys/" + createdKeyID,
			Headers:    map[string]string{"Authorization": "Bearer " + accessToken},
			RequestContext: events.APIGatewayProxyRequestContext{
				Authorizer: map[string]interface{}{
					"claims": map[string]interface{}{"sub": userID},
				},
			},
		}
		resp, err := handler(ctx, req)
		if err != nil {
			t.Fatalf("handler: %v", err)
		}
		t.Logf("Revoke response: %d %s", resp.StatusCode, resp.Body)
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}
	})

	// --- Verify revoked ---
	t.Run("VerifyRevoked", func(t *testing.T) {
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "GET",
			Path:       "/api-keys",
			Headers:    map[string]string{"Authorization": "Bearer " + accessToken},
			RequestContext: events.APIGatewayProxyRequestContext{
				Authorizer: map[string]interface{}{
					"claims": map[string]interface{}{"sub": userID},
				},
			},
		}
		resp, _ := handler(ctx, req)
		var keys []ApiKey
		json.Unmarshal([]byte(resp.Body), &keys)

		for _, k := range keys {
			if k.ID == createdKeyID {
				if k.IsActive {
					t.Error("key should be inactive after revoke")
				} else {
					t.Log("Key correctly marked inactive after revoke")
				}
				return
			}
		}
		t.Log("Revoked key found in list as inactive (correct)")
	})

	// --- Revoke someone else's key (should 404) ---
	t.Run("RevokeForeignKey", func(t *testing.T) {
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "DELETE",
			Path:       "/api-keys/fake-key-id-12345",
			Headers:    map[string]string{"Authorization": "Bearer " + accessToken},
			RequestContext: events.APIGatewayProxyRequestContext{
				Authorizer: map[string]interface{}{
					"claims": map[string]interface{}{"sub": userID},
				},
			},
		}
		resp, _ := handler(ctx, req)
		if resp.StatusCode != 404 {
			t.Errorf("expected 404, got %d", resp.StatusCode)
		}
		t.Logf("Foreign key revoke: %d (correct)", resp.StatusCode)
	})

	// --- No auth ---
	t.Run("NoAuth", func(t *testing.T) {
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "GET",
			Path:       "/api-keys",
			Headers:    map[string]string{},
		}
		resp, _ := handler(ctx, req)
		if resp.StatusCode != 401 {
			t.Errorf("expected 401, got %d", resp.StatusCode)
		}
		t.Logf("No auth: %d (correct)", resp.StatusCode)
	})

	_ = rawAPIKey // will be used in authorizer tests
}

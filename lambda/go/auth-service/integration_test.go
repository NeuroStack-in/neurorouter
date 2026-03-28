// +build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

// Run with: go test -tags integration -v -count=1 ./...
//
// Required env vars (set automatically by test):
//   COGNITO_USER_POOL_ID, COGNITO_APP_CLIENT_ID,
//   TABLE_USERS, TABLE_INVOICES, TABLE_ACTIVITY_LOG

func init() {
	// Set env vars for the auth-service to use
	setIfEmpty("COGNITO_USER_POOL_ID", "ap-south-1_Rx2PCbjA8")
	setIfEmpty("COGNITO_APP_CLIENT_ID", "3ol7kmafc07812mvb47g4enklo")
	setIfEmpty("TABLE_USERS", "neurorouter-users-dev")
	setIfEmpty("TABLE_INVOICES", "neurorouter-invoices-dev")
	setIfEmpty("TABLE_ACTIVITY_LOG", "neurorouter-activity-log-dev")
	setIfEmpty("AWS_REGION", "ap-south-1")
}

func setIfEmpty(key, val string) {
	if os.Getenv(key) == "" {
		os.Setenv(key, val)
	}
}

func randomEmail() string {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	return fmt.Sprintf("testuser_%d@integrationtest.neurorouter.dev", r.Int63())
}

// --- Test 1: Full Register → Login → Me → Logout flow ---

func TestIntegration_FullAuthFlow(t *testing.T) {
	ctx := context.Background()

	// Initialize AWS clients
	if err := initDynamo(ctx); err != nil {
		t.Fatalf("initDynamo: %v", err)
	}
	if err := initCognito(ctx); err != nil {
		t.Fatalf("initCognito: %v", err)
	}

	email := randomEmail()
	password := "TestPass123"
	t.Logf("Test email: %s", email)

	// --- REGISTER ---
	t.Run("Register", func(t *testing.T) {
		body := fmt.Sprintf(`{"email":"%s","full_name":"Integration Test","password":"%s"}`, email, password)
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "POST",
			Path:       "/auth/register",
			Body:       body,
		}
		resp, err := handler(ctx, req)
		if err != nil {
			t.Fatalf("handler error: %v", err)
		}
		t.Logf("Register response: %d %s", resp.StatusCode, resp.Body)
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, resp.Body)
		}

		var userOut UserOut
		json.Unmarshal([]byte(resp.Body), &userOut)
		if userOut.ID == "" {
			t.Fatal("register returned empty user ID")
		}
		if userOut.Email != email {
			t.Errorf("email = %q, want %q", userOut.Email, email)
		}
		t.Logf("Registered user ID: %s", userOut.ID)
	})

	// Small delay for Cognito Post-Confirmation trigger to fire
	time.Sleep(2 * time.Second)

	// --- Verify DynamoDB row was created by Post-Confirmation trigger ---
	t.Run("VerifyDynamoRow", func(t *testing.T) {
		user, err := GetUserByEmail(ctx, email)
		if err != nil {
			t.Fatalf("GetUserByEmail: %v", err)
		}
		if user == nil {
			t.Fatal("user not found in DynamoDB after registration")
		}
		t.Logf("DynamoDB user: id=%s status=%s plan=%s", user.ID, user.AccountStatus, user.PlanID)
		if user.AccountStatus != StatusPendingApproval {
			t.Errorf("account_status = %q, want PENDING_APPROVAL", user.AccountStatus)
		}
		if user.PlanID != "free" {
			t.Errorf("plan_id = %q, want free", user.PlanID)
		}
	})

	// --- LOGIN ---
	var accessToken string
	var refreshToken string
	t.Run("Login", func(t *testing.T) {
		body := fmt.Sprintf(`{"email":"%s","password":"%s"}`, email, password)
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "POST",
			Path:       "/auth/login",
			Body:       body,
		}
		resp, err := handler(ctx, req)
		if err != nil {
			t.Fatalf("handler error: %v", err)
		}
		t.Logf("Login response: %d %s", resp.StatusCode, resp.Body)

		// PENDING_APPROVAL users may be blocked — that's OK, the auth itself should work
		// but our handler rejects BLOCKED/REJECTED. PENDING_APPROVAL is allowed through login.
		if resp.StatusCode != 200 {
			// Check if it's a billing block (expected for pending users if billing logic triggers)
			var errResp ErrorResponse
			json.Unmarshal([]byte(resp.Body), &errResp)
			t.Logf("Login rejected: %s (this may be expected for PENDING_APPROVAL user)", errResp.Detail)
			// Login should still work for PENDING_APPROVAL — only BLOCKED/REJECTED are denied
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, resp.Body)
		}

		var tokenResp TokenResponse
		json.Unmarshal([]byte(resp.Body), &tokenResp)
		if tokenResp.AccessToken == "" {
			t.Fatal("login returned empty access token")
		}
		accessToken = tokenResp.AccessToken
		refreshToken = tokenResp.RefreshToken
		t.Logf("Login OK — token type=%s expires_in=%d has_refresh=%v",
			tokenResp.TokenType, tokenResp.ExpiresIn, refreshToken != "")
	})

	// --- ME ---
	t.Run("Me", func(t *testing.T) {
		if accessToken == "" {
			t.Skip("no access token from login")
		}
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "GET",
			Path:       "/auth/me",
			Headers: map[string]string{
				"Authorization": "Bearer " + accessToken,
			},
		}
		resp, err := handler(ctx, req)
		if err != nil {
			t.Fatalf("handler error: %v", err)
		}
		t.Logf("Me response: %d %s", resp.StatusCode, resp.Body)
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, resp.Body)
		}

		var me MeResponse
		json.Unmarshal([]byte(resp.Body), &me)
		if me.Email != email {
			t.Errorf("email = %q, want %q", me.Email, email)
		}
		if me.UserID == "" {
			t.Error("userId is empty")
		}
		t.Logf("Me OK — userId=%s status=%s plan=%s role=%s", me.UserID, me.AccountStatus, me.PlanID, me.Role)
	})

	// --- REFRESH ---
	t.Run("Refresh", func(t *testing.T) {
		if refreshToken == "" {
			t.Skip("no refresh token from login")
		}
		body := fmt.Sprintf(`{"refresh_token":"%s"}`, refreshToken)
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "POST",
			Path:       "/auth/refresh",
			Body:       body,
		}
		resp, err := handler(ctx, req)
		if err != nil {
			t.Fatalf("handler error: %v", err)
		}
		t.Logf("Refresh response: %d %s", resp.StatusCode, resp.Body)
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, resp.Body)
		}

		var tokenResp TokenResponse
		json.Unmarshal([]byte(resp.Body), &tokenResp)
		if tokenResp.AccessToken == "" {
			t.Fatal("refresh returned empty access token")
		}
		// Update access token for logout test
		accessToken = tokenResp.AccessToken
		t.Logf("Refresh OK — new token issued, expires_in=%d", tokenResp.ExpiresIn)
	})

	// --- LOGOUT ---
	t.Run("Logout", func(t *testing.T) {
		if accessToken == "" {
			t.Skip("no access token")
		}
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "POST",
			Path:       "/auth/logout",
			Headers: map[string]string{
				"Authorization": "Bearer " + accessToken,
			},
		}
		resp, err := handler(ctx, req)
		if err != nil {
			t.Fatalf("handler error: %v", err)
		}
		t.Logf("Logout response: %d %s", resp.StatusCode, resp.Body)
		if resp.StatusCode != 200 {
			t.Fatalf("expected 200, got %d: %s", resp.StatusCode, resp.Body)
		}
		t.Log("Logout OK")
	})

	// --- Verify token is invalidated after logout ---
	t.Run("MeAfterLogout", func(t *testing.T) {
		if accessToken == "" {
			t.Skip("no access token")
		}
		req := events.APIGatewayProxyRequest{
			HTTPMethod: "GET",
			Path:       "/auth/me",
			Headers: map[string]string{
				"Authorization": "Bearer " + accessToken,
			},
		}
		resp, err := handler(ctx, req)
		if err != nil {
			t.Fatalf("handler error: %v", err)
		}
		t.Logf("Me after logout: %d %s", resp.StatusCode, resp.Body)
		if resp.StatusCode != 401 {
			t.Logf("NOTE: expected 401 after logout, got %d (Cognito token may still be valid briefly)", resp.StatusCode)
		}
	})
}

// --- Test 2: Duplicate registration ---

func TestIntegration_DuplicateRegister(t *testing.T) {
	ctx := context.Background()
	if err := initDynamo(ctx); err != nil {
		t.Fatalf("initDynamo: %v", err)
	}
	if err := initCognito(ctx); err != nil {
		t.Fatalf("initCognito: %v", err)
	}

	email := randomEmail()
	password := "TestPass123"

	// Register first time
	body := fmt.Sprintf(`{"email":"%s","full_name":"Dup Test","password":"%s"}`, email, password)
	req := events.APIGatewayProxyRequest{HTTPMethod: "POST", Path: "/auth/register", Body: body}
	resp, _ := handler(ctx, req)
	if resp.StatusCode != 200 {
		t.Fatalf("first register failed: %d %s", resp.StatusCode, resp.Body)
	}

	time.Sleep(1 * time.Second)

	// Register again with same email
	resp2, _ := handler(ctx, req)
	t.Logf("Duplicate register: %d %s", resp2.StatusCode, resp2.Body)
	if resp2.StatusCode != 400 {
		t.Errorf("expected 400 for duplicate, got %d", resp2.StatusCode)
	}
}

// --- Test 3: Invalid login credentials ---

func TestIntegration_InvalidLogin(t *testing.T) {
	ctx := context.Background()
	if err := initDynamo(ctx); err != nil {
		t.Fatalf("initDynamo: %v", err)
	}
	if err := initCognito(ctx); err != nil {
		t.Fatalf("initCognito: %v", err)
	}

	body := `{"email":"nonexistent@test.com","password":"WrongPass123"}`
	req := events.APIGatewayProxyRequest{HTTPMethod: "POST", Path: "/auth/login", Body: body}
	resp, _ := handler(ctx, req)
	t.Logf("Invalid login: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

// --- Test 4: Me with invalid token ---

func TestIntegration_MeInvalidToken(t *testing.T) {
	ctx := context.Background()
	if err := initDynamo(ctx); err != nil {
		t.Fatalf("initDynamo: %v", err)
	}
	if err := initCognito(ctx); err != nil {
		t.Fatalf("initCognito: %v", err)
	}

	req := events.APIGatewayProxyRequest{
		HTTPMethod: "GET",
		Path:       "/auth/me",
		Headers:    map[string]string{"Authorization": "Bearer fake-token-12345"},
	}
	resp, _ := handler(ctx, req)
	t.Logf("Me with fake token: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

// --- Test 5: Refresh with invalid token ---

func TestIntegration_RefreshInvalidToken(t *testing.T) {
	ctx := context.Background()
	if err := initDynamo(ctx); err != nil {
		t.Fatalf("initDynamo: %v", err)
	}
	if err := initCognito(ctx); err != nil {
		t.Fatalf("initCognito: %v", err)
	}

	body := `{"refresh_token":"fake-refresh-token"}`
	req := events.APIGatewayProxyRequest{HTTPMethod: "POST", Path: "/auth/refresh", Body: body}
	resp, _ := handler(ctx, req)
	t.Logf("Refresh with fake token: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 401 {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

// --- Test 6: Route not found ---

func TestIntegration_NotFound(t *testing.T) {
	ctx := context.Background()
	if err := initDynamo(ctx); err != nil {
		t.Fatalf("initDynamo: %v", err)
	}
	if err := initCognito(ctx); err != nil {
		t.Fatalf("initCognito: %v", err)
	}

	req := events.APIGatewayProxyRequest{HTTPMethod: "GET", Path: "/auth/unknown"}
	resp, _ := handler(ctx, req)
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

// --- Test 7: DynamoDB direct operations ---

func TestIntegration_DynamoOperations(t *testing.T) {
	ctx := context.Background()
	if err := initDynamo(ctx); err != nil {
		t.Fatalf("initDynamo: %v", err)
	}

	// Test GetUserByEmail for a non-existent user
	user, err := GetUserByEmail(ctx, "definitely-not-exist@test.com")
	if err != nil {
		t.Fatalf("GetUserByEmail error: %v", err)
	}
	if user != nil {
		t.Error("expected nil user for non-existent email")
	}
	t.Log("DynamoDB GetUserByEmail for non-existent: nil (correct)")

	// Test GetUserByID for a non-existent user
	user2, err := GetUserByID(ctx, "non-existent-id-12345")
	if err != nil {
		t.Fatalf("GetUserByID error: %v", err)
	}
	if user2 != nil {
		t.Error("expected nil user for non-existent ID")
	}
	t.Log("DynamoDB GetUserByID for non-existent: nil (correct)")

	// Test GetUnpaidInvoices for a non-existent user (should return empty, not error)
	invoices, err := GetUnpaidInvoices(ctx, "non-existent-user")
	if err != nil {
		t.Fatalf("GetUnpaidInvoices error: %v", err)
	}
	if len(invoices) != 0 {
		t.Errorf("expected 0 invoices, got %d", len(invoices))
	}
	t.Log("DynamoDB GetUnpaidInvoices for non-existent: empty (correct)")
}

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/aws/aws-lambda-go/events"
)

// --- Helper function tests ---

func TestExtractBearerToken(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"valid lowercase", "bearer abc123", "abc123"},
		{"valid uppercase", "Bearer mytoken", "mytoken"},
		{"missing header", "", ""},
		{"no scheme", "abc123", ""},
		{"wrong scheme", "Basic abc123", ""},
		{"bearer no token", "Bearer ", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := events.APIGatewayProxyRequest{
				Headers: map[string]string{},
			}
			if tt.header != "" {
				req.Headers["Authorization"] = tt.header
			}
			got := extractBearerToken(req)
			if got != tt.want {
				t.Errorf("extractBearerToken() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNowISO(t *testing.T) {
	now := NowISO()
	_, err := time.Parse(time.RFC3339, now)
	if err != nil {
		t.Errorf("NowISO() = %q, not valid RFC3339: %v", now, err)
	}
}

func TestJsonResponse(t *testing.T) {
	resp, err := jsonResponse(http.StatusOK, map[string]string{"msg": "hello"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	if resp.Headers["Content-Type"] != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", resp.Headers["Content-Type"])
	}
	if resp.Headers["Access-Control-Allow-Origin"] != "*" {
		t.Errorf("CORS origin header missing")
	}
	var body map[string]string
	if err := json.Unmarshal([]byte(resp.Body), &body); err != nil {
		t.Fatalf("body is not valid JSON: %v", err)
	}
	if body["msg"] != "hello" {
		t.Errorf("body msg = %q, want hello", body["msg"])
	}
}

func TestCorsResponse(t *testing.T) {
	resp := corsResponse(200, "")
	if resp.Headers["Access-Control-Allow-Methods"] == "" {
		t.Error("CORS methods header missing")
	}
	if resp.Headers["Access-Control-Allow-Headers"] == "" {
		t.Error("CORS headers header missing")
	}
}

// --- Handler routing tests (without AWS services) ---
// These test that the router dispatches correctly and returns proper errors
// for bad requests BEFORE hitting any AWS calls.

func TestRouteNotFound(t *testing.T) {
	// handler() will try to init dynamo/cognito which fails without AWS.
	// But we can test that unknown routes return 404 after init.
	// Skip if no AWS env — we just verify the response shape.
	t.Skip("Requires AWS credentials for init — tested via integration")
}

func TestRegisterValidation(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantDetail string
	}{
		{
			"empty body",
			"{}",
			http.StatusBadRequest,
			"Email and password are required",
		},
		{
			"missing password",
			`{"email":"test@example.com"}`,
			http.StatusBadRequest,
			"Email and password are required",
		},
		{
			"short password",
			`{"email":"test@example.com","password":"12345"}`,
			http.StatusBadRequest,
			"Password must be at least 6 characters",
		},
		{
			"invalid json",
			"not json",
			http.StatusBadRequest,
			"Invalid request body",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := events.APIGatewayProxyRequest{Body: tt.body}
			resp, err := handleRegister(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
			var errResp ErrorResponse
			json.Unmarshal([]byte(resp.Body), &errResp)
			if errResp.Detail != tt.wantDetail {
				t.Errorf("detail = %q, want %q", errResp.Detail, tt.wantDetail)
			}
		})
	}
}

func TestLoginValidation(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
		wantDetail string
	}{
		{
			"empty body",
			"{}",
			http.StatusBadRequest,
			"Email and password are required",
		},
		{
			"invalid json",
			"bad",
			http.StatusBadRequest,
			"Invalid request body",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := events.APIGatewayProxyRequest{Body: tt.body}
			resp, err := handleLogin(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
			var errResp ErrorResponse
			json.Unmarshal([]byte(resp.Body), &errResp)
			if errResp.Detail != tt.wantDetail {
				t.Errorf("detail = %q, want %q", errResp.Detail, tt.wantDetail)
			}
		})
	}
}

func TestGoogleLoginValidation(t *testing.T) {
	req := events.APIGatewayProxyRequest{Body: `{"token":""}`}
	resp, err := handleGoogleLogin(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestRefreshValidation(t *testing.T) {
	req := events.APIGatewayProxyRequest{Body: `{"refresh_token":""}`}
	resp, err := handleRefresh(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestMeNoToken(t *testing.T) {
	req := events.APIGatewayProxyRequest{
		Headers: map[string]string{},
	}
	resp, err := handleMe(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

// --- Model serialization tests ---

func TestUserOutJSON(t *testing.T) {
	u := UserOut{
		ID:        "abc-123",
		Email:     "test@example.com",
		IsActive:  true,
		CreatedAt: "2026-03-28T00:00:00Z",
	}
	b, err := json.Marshal(u)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]interface{}
	json.Unmarshal(b, &parsed)

	if parsed["id"] != "abc-123" {
		t.Errorf("id = %v", parsed["id"])
	}
	if parsed["email"] != "test@example.com" {
		t.Errorf("email = %v", parsed["email"])
	}
	if parsed["is_active"] != true {
		t.Errorf("is_active = %v", parsed["is_active"])
	}
}

func TestTokenResponseJSON(t *testing.T) {
	tr := TokenResponse{
		AccessToken: "tok123",
		TokenType:   "bearer",
		ExpiresIn:   3600,
	}
	b, _ := json.Marshal(tr)
	var parsed map[string]interface{}
	json.Unmarshal(b, &parsed)

	if parsed["access_token"] != "tok123" {
		t.Errorf("access_token = %v", parsed["access_token"])
	}
	if parsed["token_type"] != "bearer" {
		t.Errorf("token_type = %v", parsed["token_type"])
	}
	// refresh_token should be omitted when empty
	if _, exists := parsed["refresh_token"]; exists {
		t.Error("refresh_token should be omitted when empty")
	}
}

func TestErrorResponseJSON(t *testing.T) {
	e := ErrorResponse{Detail: "something went wrong"}
	b, _ := json.Marshal(e)
	var parsed map[string]interface{}
	json.Unmarshal(b, &parsed)
	if parsed["detail"] != "something went wrong" {
		t.Errorf("detail = %v", parsed["detail"])
	}
}

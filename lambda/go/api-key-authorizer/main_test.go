package main

import (
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

// --- Token Extraction Tests ---

func TestExtractToken_Valid(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"standard bearer", "Bearer neurorouter_abc1234567890", "neurorouter_abc1234567890"},
		{"lowercase bearer", "bearer neurorouter_abc1234567890", "neurorouter_abc1234567890"},
		{"extra spaces", "Bearer  neurorouter_abc1234567890 ", "neurorouter_abc1234567890"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractToken(tt.header)
			if got != tt.want {
				t.Errorf("extractToken(%q) = %q, want %q", tt.header, got, tt.want)
			}
		})
	}
}

func TestExtractToken_Invalid(t *testing.T) {
	tests := []struct {
		name   string
		header string
	}{
		{"empty", ""},
		{"no scheme", "neurorouter_abc1234567890"},
		{"wrong scheme", "Basic neurorouter_abc1234567890"},
		{"bearer only", "Bearer"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractToken(tt.header)
			if got != "" {
				t.Errorf("extractToken(%q) = %q, want empty", tt.header, got)
			}
		})
	}
}

// --- API Key Format Validation ---

func TestAPIKeyPattern_Valid(t *testing.T) {
	valid := []string{
		"neurorouter_abcdefghijklm",
		"neurorouter_ABCDEFGHIJKLM",
		"neurorouter_abc123DEF456g",
		"neurorouter_0000000000000",
		"neurorouter_zzzzzzzzzzzzz",
	}
	for _, key := range valid {
		if !apiKeyPattern.MatchString(key) {
			t.Errorf("expected %q to be valid", key)
		}
	}
}

func TestAPIKeyPattern_Invalid(t *testing.T) {
	invalid := []string{
		"neurorouter_",                    // too short
		"neurorouter_abcdefghijkl",        // 12 chars (need 13)
		"neurorouter_abcdefghijklmn",      // 14 chars
		"other_prefix_abcdefghijklm",      // wrong prefix
		"neurorouter_abc!@#defghij",       // special chars
		"neurorouter_abc defghijkl",       // space
		"",                                 // empty
		"sk-abc123",                        // OpenAI format
	}
	for _, key := range invalid {
		if apiKeyPattern.MatchString(key) {
			t.Errorf("expected %q to be invalid", key)
		}
	}
}

// --- Hash Consistency ---

func TestHashKey_Consistency(t *testing.T) {
	key := "neurorouter_testkey123456"
	h1 := hashKey(key)
	h2 := hashKey(key)
	if h1 != h2 {
		t.Error("hash not deterministic")
	}
	if len(h1) != 64 {
		t.Errorf("hash length = %d, want 64", len(h1))
	}
}

// --- Policy Response Tests ---

func TestAllowResponse_Structure(t *testing.T) {
	ctx := map[string]interface{}{
		"userId":    "user-123",
		"apiKeyId":  "key-456",
		"planId":    "developer",
		"accountStatus": "ACTIVE",
	}
	resp := allowResponse(
		"arn:aws:execute-api:ap-south-1:896823725438:u87jos3lg5/dev/POST/v1/chat/completions",
		"user-123",
		ctx,
	)

	if resp.PrincipalID != "user-123" {
		t.Errorf("principalID = %q", resp.PrincipalID)
	}
	if len(resp.PolicyDocument.Statement) != 1 {
		t.Fatal("expected 1 policy statement")
	}
	stmt := resp.PolicyDocument.Statement[0]
	if stmt.Effect != "Allow" {
		t.Errorf("effect = %q, want Allow", stmt.Effect)
	}
	if resp.Context["userId"] != "user-123" {
		t.Errorf("context userId = %v", resp.Context["userId"])
	}
}

func TestDenyResponse_Structure(t *testing.T) {
	resp := denyResponse("test deny message")
	if resp.PrincipalID != "unauthorized" {
		t.Errorf("principalID = %q", resp.PrincipalID)
	}
	stmt := resp.PolicyDocument.Statement[0]
	if stmt.Effect != "Deny" {
		t.Errorf("effect = %q, want Deny", stmt.Effect)
	}
	if resp.Context["message"] != "test deny message" {
		t.Errorf("context message = %v", resp.Context["message"])
	}
}

func TestBuildResourceArn(t *testing.T) {
	arn := "arn:aws:execute-api:ap-south-1:896823725438:u87jos3lg5/dev/POST/v1/chat/completions"
	got := buildResourceArn(arn)
	want := "arn:aws:execute-api:ap-south-1:896823725438:u87jos3lg5/dev/*"
	if got != want {
		t.Errorf("buildResourceArn = %q, want %q", got, want)
	}
}

// --- Deny on missing token (no AWS needed) ---

func TestHandler_NoToken_Deny(t *testing.T) {
	// Can't fully test handler without AWS, but we can test that
	// extractToken returns empty for various bad inputs
	req := events.APIGatewayCustomAuthorizerRequest{
		AuthorizationToken: "",
	}
	token := extractToken(req.AuthorizationToken)
	if token != "" {
		t.Errorf("expected empty token, got %q", token)
	}
}

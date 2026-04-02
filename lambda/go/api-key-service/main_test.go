package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

// --- API Key Generation Tests ---

func TestGenerateAPIKey_Format(t *testing.T) {
	rawKey, prefix, hash := generateAPIKey()

	// Must start with neurorouter_
	if len(rawKey) != 25 {
		t.Errorf("key length = %d, want 25", len(rawKey))
	}
	if rawKey[:12] != "neurorouter_" {
		t.Errorf("key prefix = %q, want neurorouter_", rawKey[:12])
	}

	// Suffix must be alphanumeric
	pattern := regexp.MustCompile(`^neurorouter_[a-zA-Z0-9]{13}$`)
	if !pattern.MatchString(rawKey) {
		t.Errorf("key %q does not match pattern", rawKey)
	}

	// Prefix is first 16 chars
	if prefix != rawKey[:16] {
		t.Errorf("prefix = %q, want %q", prefix, rawKey[:16])
	}

	// Hash is 64 hex chars (SHA-256)
	if len(hash) != 64 {
		t.Errorf("hash length = %d, want 64", len(hash))
	}
}

func TestGenerateAPIKey_Uniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		key, _, _ := generateAPIKey()
		if seen[key] {
			t.Fatalf("duplicate key generated on iteration %d: %s", i, key)
		}
		seen[key] = true
	}
}

func TestHashKey_Deterministic(t *testing.T) {
	h1 := hashKey("neurorouter_test1234567")
	h2 := hashKey("neurorouter_test1234567")
	if h1 != h2 {
		t.Errorf("hash not deterministic: %s != %s", h1, h2)
	}
}

func TestHashKey_DifferentInputs(t *testing.T) {
	h1 := hashKey("neurorouter_aaaaaaaaaaaa1")
	h2 := hashKey("neurorouter_aaaaaaaaaaaa2")
	if h1 == h2 {
		t.Error("different inputs produced same hash")
	}
}

// --- Routing Tests ---

func TestRouteCreateKey_NoAuth(t *testing.T) {
	req := events.APIGatewayProxyRequest{
		HTTPMethod: "POST",
		Path:       "/api-keys",
		Body:       `{"name":"test"}`,
		Headers:    map[string]string{},
	}
	// Can't call handler without AWS clients, but we can verify auth extraction
	sub := extractCognitoSub(req)
	if sub != "" {
		t.Errorf("expected empty sub for no-auth request, got %q", sub)
	}
}

func TestExtractCognitoSub(t *testing.T) {
	req := events.APIGatewayProxyRequest{
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{
				"claims": map[string]interface{}{
					"sub": "user-123",
				},
			},
		},
	}
	sub := extractCognitoSub(req)
	if sub != "user-123" {
		t.Errorf("sub = %q, want user-123", sub)
	}
}

func TestExtractCognitoSub_NoClaims(t *testing.T) {
	req := events.APIGatewayProxyRequest{
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]interface{}{},
		},
	}
	sub := extractCognitoSub(req)
	if sub != "" {
		t.Errorf("expected empty sub, got %q", sub)
	}
}

func TestJsonResp_CORS(t *testing.T) {
	resp, _ := jsonResp(http.StatusOK, map[string]string{"test": "ok"})
	if resp.Headers["Access-Control-Allow-Origin"] != "*" {
		t.Error("missing CORS origin header")
	}
	if resp.Headers["Content-Type"] != "application/json" {
		t.Error("missing Content-Type header")
	}
	var body map[string]string
	json.Unmarshal([]byte(resp.Body), &body)
	if body["test"] != "ok" {
		t.Errorf("body = %v", body)
	}
}

func TestGenerateID_Uniqueness(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := generateID()
		if len(id) != 32 {
			t.Errorf("id length = %d, want 32", len(id))
		}
		if seen[id] {
			t.Fatalf("duplicate id on iteration %d", i)
		}
		seen[id] = true
	}
}

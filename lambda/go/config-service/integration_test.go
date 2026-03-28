// +build integration

package main

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func init() {
	setEnv("TABLE_PLAN_CATALOG", "neurorouter-plan-catalog-dev")
	setEnv("AWS_REGION", "ap-south-1")
}

func setEnv(k, v string) {
	if os.Getenv(k) == "" {
		os.Setenv(k, v)
	}
}

// GET /config/models — no auth needed, returns hardcoded list
func TestIntegration_ConfigModels(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	req := events.APIGatewayProxyRequest{HTTPMethod: "GET", Path: "/config/models"}
	resp, err := handler(ctx, req)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	t.Logf("Models: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var models []Model
	json.Unmarshal([]byte(resp.Body), &models)
	if len(models) != 5 {
		t.Errorf("expected 5 models, got %d", len(models))
	}

	// Verify first model
	if models[0].ID != "llama-3.3-70b-versatile" {
		t.Errorf("first model id = %q", models[0].ID)
	}
	if models[0].Provider != "groq" {
		t.Errorf("first model provider = %q", models[0].Provider)
	}
	t.Logf("Models OK: %d models, first=%s", len(models), models[0].ID)
}

// GET /config/plans — queries DynamoDB (may be empty if not seeded)
func TestIntegration_ConfigPlans(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	req := events.APIGatewayProxyRequest{HTTPMethod: "GET", Path: "/config/plans"}
	resp, err := handler(ctx, req)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	t.Logf("Plans: %d %s", resp.StatusCode, resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var plans []Plan
	json.Unmarshal([]byte(resp.Body), &plans)
	t.Logf("Plans OK: %d plans returned (may be 0 if plan_catalog not seeded)", len(plans))
	for _, p := range plans {
		t.Logf("  Plan: %s (%s) fee=%.2f %s", p.PlanID, p.Name, p.MonthlyFee, p.Currency)
	}
}

// GET /config/unknown — 404
func TestIntegration_ConfigNotFound(t *testing.T) {
	ctx := context.Background()
	if err := initClients(ctx); err != nil {
		t.Fatalf("init: %v", err)
	}

	req := events.APIGatewayProxyRequest{HTTPMethod: "GET", Path: "/config/unknown"}
	resp, _ := handler(ctx, req)
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

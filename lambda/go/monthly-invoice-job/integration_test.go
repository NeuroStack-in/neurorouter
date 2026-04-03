// +build integration

package main

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func init() {
	os.Setenv("USERS_TABLE", "neurorouter-users-dev")
	os.Setenv("INVOICES_TABLE", "neurorouter-invoices-dev")
	os.Setenv("USAGE_MONTHLY_TABLE", "neurorouter-usage-monthly-dev")
	os.Setenv("PLAN_CATALOG_TABLE", "neurorouter-plan-catalog-dev")
	os.Setenv("AUDIT_LOG_TABLE", "neurorouter-admin-audit-log-dev")
	os.Setenv("AWS_REGION", "ap-south-1")
}

func TestIntegration_MonthlyInvoiceJob(t *testing.T) {
	event, _ := json.Marshal(map[string]string{"yearMonth": "2026-04"})
	result, err := handler(context.Background(), event)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	t.Logf("Result: generated=%d skipped=%d errors=%d", result.Generated, result.Skipped, result.Errors)
	if result.Errors > 0 {
		t.Errorf("expected 0 errors, got %d", result.Errors)
	}
}

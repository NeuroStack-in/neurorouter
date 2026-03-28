// +build integration

package main

import (
	"context"
	"os"
	"testing"
)

func init() {
	setEnv("TABLE_USERS", "neurorouter-users-dev")
	setEnv("TABLE_INVOICES", "neurorouter-invoices-dev")
	setEnv("AWS_REGION", "ap-south-1")
}

func setEnv(k, v string) {
	if os.Getenv(k) == "" {
		os.Setenv(k, v)
	}
}

func TestIntegration_DailyEnforcement(t *testing.T) {
	ctx := context.Background()

	result, err := handler(ctx, nil)
	if err != nil {
		t.Fatalf("handler: %v", err)
	}

	t.Logf("Enforcement result: checked=%d updates=%d", result.UsersChecked, result.StatusUpdates)
	if result.UsersChecked == 0 {
		t.Error("expected at least 1 user checked")
	}
	t.Log("DailyEnforcement OK")
}

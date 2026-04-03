// +build integration

package main

import (
	"context"
	"os"
	"testing"
	"time"
	"fmt"
)

func init() {
	os.Setenv("USAGE_MONTHLY_TABLE", "neurorouter-usage-monthly-dev")
	os.Setenv("EXPORT_BUCKET", "neurorouter-invoice-pdfs-dev")
	os.Setenv("AWS_REGION", "ap-south-1")
}

func TestIntegration_AnalyticsExport(t *testing.T) {
	exportID := fmt.Sprintf("test_export_%d", time.Now().UnixNano())
	result, err := handler(context.Background(), ExportEvent{
		UserID:    "test-router-user",
		ExportID:  exportID,
		YearMonth: "2026-04",
	})
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	if result.Status != "COMPLETED" {
		t.Errorf("status = %q, want COMPLETED", result.Status)
	}
	if result.S3Key == "" {
		t.Error("s3Key is empty")
	}
	t.Logf("Export OK: s3Key=%s status=%s", result.S3Key, result.Status)
}

func TestIntegration_ExportMissingFields(t *testing.T) {
	_, err := handler(context.Background(), ExportEvent{})
	if err == nil {
		t.Error("expected error for missing fields")
	}
}

package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Ported from: lambda/python/router-service/usage.py
// Writes to two DynamoDB tables:
//   usage_events — one raw record per request (with 90-day TTL)
//   usage_monthly — atomic ADD to aggregate counters

var (
	ddbClient       *dynamodb.Client
	usageEventsTable  string
	usageMonthlyTable string
)

func initDynamo(ctx context.Context) error {
	if ddbClient != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	ddbClient = dynamodb.NewFromConfig(cfg)

	usageEventsTable = envOr("TABLE_USAGE_EVENTS", "neurorouter-usage-events-dev")
	usageMonthlyTable = envOr("TABLE_USAGE_MONTHLY", "neurorouter-usage-monthly-dev")
	return nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

// recordUsageAsync records usage in a goroutine (fire-and-forget).
// Uses context.WithTimeout to ensure writes complete before Lambda freeze.
func recordUsageAsync(userID, apiKeyID, model string, usage *Usage) {
	if usage == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := recordUsage(ctx, userID, apiKeyID, model, usage); err != nil {
			log.Printf("WARN: usage recording failed: %v", err)
		}
	}()
}

// recordUsage writes to both usage_events and usage_monthly tables.
func recordUsage(ctx context.Context, userID, apiKeyID, model string, usage *Usage) error {
	if err := initDynamo(ctx); err != nil {
		return err
	}

	// 1. Write raw event
	if err := writeUsageEvent(ctx, userID, apiKeyID, model, usage); err != nil {
		log.Printf("WARN: write_usage_event: %v", err)
	}

	// 2. Atomic increment monthly aggregate
	if err := updateUsageMonthly(ctx, userID, apiKeyID, model, usage); err != nil {
		return fmt.Errorf("update_usage_monthly: %w", err)
	}

	return nil
}

func writeUsageEvent(ctx context.Context, userID, apiKeyID, model string, usage *Usage) error {
	now := time.Now().UTC()
	expiresAt := now.Add(90 * 24 * time.Hour).Unix()

	_, err := ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &usageEventsTable,
		Item: map[string]dbtypes.AttributeValue{
			"userId":            &dbtypes.AttributeValueMemberS{Value: userID},
			"timestamp":         &dbtypes.AttributeValueMemberS{Value: now.Format(time.RFC3339Nano)},
			"api_key_id":        &dbtypes.AttributeValueMemberS{Value: apiKeyID},
			"model":             &dbtypes.AttributeValueMemberS{Value: model},
			"prompt_tokens":     &dbtypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", usage.PromptTokens)},
			"completion_tokens": &dbtypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", usage.CompletionTokens)},
			"total_tokens":      &dbtypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", usage.TotalTokens)},
			"year_month":        &dbtypes.AttributeValueMemberS{Value: now.Format("2006-01")},
			"expiresAt":         &dbtypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", expiresAt)},
		},
	})
	return err
}

func updateUsageMonthly(ctx context.Context, userID, apiKeyID, model string, usage *Usage) error {
	yearMonth := time.Now().UTC().Format("2006-01")
	sortKey := fmt.Sprintf("%s#MODEL#%s#KEY#%s", yearMonth, model, apiKeyID)

	_, err := ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: &usageMonthlyTable,
		Key: map[string]dbtypes.AttributeValue{
			"userId": &dbtypes.AttributeValueMemberS{Value: userID},
			"sk":     &dbtypes.AttributeValueMemberS{Value: sortKey},
		},
		UpdateExpression: aws.String(
			"ADD input_tokens :inp, output_tokens :out, total_tokens :tot, request_count :one " +
				"SET updated_at = :now, #ym = :ym, #mdl = :mdl, api_key_id = :kid",
		),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":inp": &dbtypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", usage.PromptTokens)},
			":out": &dbtypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", usage.CompletionTokens)},
			":tot": &dbtypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", usage.TotalTokens)},
			":one": &dbtypes.AttributeValueMemberN{Value: "1"},
			":now": &dbtypes.AttributeValueMemberS{Value: time.Now().UTC().Format(time.RFC3339)},
			":ym":  &dbtypes.AttributeValueMemberS{Value: yearMonth},
			":mdl": &dbtypes.AttributeValueMemberS{Value: model},
			":kid": &dbtypes.AttributeValueMemberS{Value: apiKeyID},
		},
		ExpressionAttributeNames: map[string]string{
			"#ym":  "year_month",
			"#mdl": "model",
		},
	})
	return err
}

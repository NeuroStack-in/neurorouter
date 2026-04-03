package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Ported from: lambda/python/monthly-invoice-job/billing_job.py

var (
	ddbClient   *dynamodb.Client
	usersTbl    string
	invoicesTbl string
	usageTbl    string
	planTbl     string
	auditTbl    string
)

const (
	freeInputTokens  = 1_000_000
	freeOutputTokens = 1_000_000
)

func initClients(ctx context.Context) error {
	if ddbClient != nil {
		return nil
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return err
	}
	ddbClient = dynamodb.NewFromConfig(cfg)
	usersTbl = envOr("USERS_TABLE", "neurorouter-users-dev")
	invoicesTbl = envOr("INVOICES_TABLE", "neurorouter-invoices-dev")
	usageTbl = envOr("USAGE_MONTHLY_TABLE", "neurorouter-usage-monthly-dev")
	planTbl = envOr("PLAN_CATALOG_TABLE", "neurorouter-plan-catalog-dev")
	auditTbl = envOr("AUDIT_LOG_TABLE", "neurorouter-admin-audit-log-dev")
	return nil
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

type User struct {
	ID            string `dynamodbav:"id"`
	Email         string `dynamodbav:"email"`
	AccountStatus string `dynamodbav:"account_status"`
	PlanID        string `dynamodbav:"plan_id"`
}

type Plan struct {
	PlanID          string  `dynamodbav:"planId"`
	MonthlyFee      float64 `dynamodbav:"monthly_fee"`
	OverageInput    float64 `dynamodbav:"overage_input_rate"`
	OverageOutput   float64 `dynamodbav:"overage_output_rate"`
	Currency        string  `dynamodbav:"currency"`
}

type Result struct {
	Generated int32 `json:"generated"`
	Skipped   int32 `json:"skipped"`
	Errors    int32 `json:"errors"`
}

func handler(ctx context.Context, event json.RawMessage) (Result, error) {
	log.Println("Starting monthly invoice generation...")
	if err := initClients(ctx); err != nil {
		return Result{}, err
	}

	// Parse yearMonth from event or calculate previous month
	var input struct {
		YearMonth string `json:"yearMonth"`
	}
	json.Unmarshal(event, &input)
	if input.YearMonth == "" {
		now := time.Now().UTC()
		prev := now.AddDate(0, -1, 0)
		input.YearMonth = prev.Format("2006-01")
	}
	log.Printf("Generating invoices for: %s", input.YearMonth)

	// Scan ACTIVE/GRACE users with pagination
	var users []User
	var lastKey map[string]dbtypes.AttributeValue
	for {
		scanInput := &dynamodb.ScanInput{
			TableName:        &usersTbl,
			FilterExpression: aws.String("account_status IN (:a, :g)"),
			ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
				":a": &dbtypes.AttributeValueMemberS{Value: "ACTIVE"},
				":g": &dbtypes.AttributeValueMemberS{Value: "GRACE"},
			},
		}
		if lastKey != nil {
			scanInput.ExclusiveStartKey = lastKey
		}
		out, err := ddbClient.Scan(ctx, scanInput)
		if err != nil {
			return Result{}, fmt.Errorf("scan users: %w", err)
		}
		var batch []User
		attributevalue.UnmarshalListOfMaps(out.Items, &batch)
		users = append(users, batch...)
		lastKey = out.LastEvaluatedKey
		if lastKey == nil {
			break
		}
	}
	log.Printf("Found %d eligible users", len(users))

	// Process with bounded concurrency (10 workers)
	var generated, skipped, errors int32
	sem := make(chan struct{}, 10)
	var wg sync.WaitGroup

	for _, user := range users {
		wg.Add(1)
		sem <- struct{}{}
		go func(u User) {
			defer wg.Done()
			defer func() { <-sem }()

			err := processUser(ctx, u, input.YearMonth)
			if err != nil {
				log.Printf("ERROR user %s: %v", u.ID, err)
				atomic.AddInt32(&errors, 1)
			} else {
				atomic.AddInt32(&generated, 1)
			}
		}(user)
	}
	wg.Wait()

	log.Printf("Done: generated=%d skipped=%d errors=%d", generated, skipped, errors)
	return Result{Generated: generated, Skipped: skipped, Errors: errors}, nil
}

func processUser(ctx context.Context, user User, yearMonth string) error {
	// Check existing invoice
	existing, _ := getExistingInvoice(ctx, user.ID, yearMonth)
	if existing != nil && existing["status"] != nil {
		s := existing["status"].(*dbtypes.AttributeValueMemberS).Value
		if s != "PENDING" {
			return nil // already finalized
		}
	}

	// Get plan
	plan := getPlan(ctx, user.PlanID)
	rateInput := 2.0
	rateOutput := 8.0
	fixedFee := 1599.0
	currency := "INR"
	if plan != nil {
		if plan.OverageInput > 0 { rateInput = plan.OverageInput }
		if plan.OverageOutput > 0 { rateOutput = plan.OverageOutput }
		if plan.MonthlyFee > 0 { fixedFee = plan.MonthlyFee }
		if plan.Currency != "" { currency = plan.Currency }
	}

	// Aggregate usage
	inputTk, outputTk := aggregateUsage(ctx, user.ID, yearMonth)
	variableCost := calcCost(inputTk, outputTk, rateInput, rateOutput)

	// Create or update invoice
	now := time.Now().UTC()
	invID := fmt.Sprintf("inv_%d", now.UnixNano())
	invNumber := fmt.Sprintf("INV-%s-%s", yearMonth, user.ID[:8])

	// Due date: 5th of next month, grace: 10th
	y, m := parseYearMonth(yearMonth)
	dueDate := time.Date(y, m+1, 5, 0, 0, 0, 0, time.UTC)
	graceEnd := time.Date(y, m+1, 10, 0, 0, 0, 0, time.UTC)

	invItem := map[string]interface{}{
		"id": invID, "user_id": user.ID, "invoice_number": invNumber,
		"year_month": yearMonth, "status": "PENDING",
		"due_date": dueDate.Format(time.RFC3339), "grace_period_end": graceEnd.Format(time.RFC3339),
		"total_input_tokens": inputTk, "total_output_tokens": outputTk,
		"rate_input_usd_per_1m": rateInput, "rate_output_usd_per_1m": rateOutput,
		"fixed_fee_inr": fixedFee, "variable_cost_usd": variableCost,
		"fixed_cost_inr": fixedFee, "currency": currency,
		"total_due_display": fmt.Sprintf("₹%.2f + $%.2f", fixedFee, variableCost),
		"created_at": now.Format(time.RFC3339), "updated_at": now.Format(time.RFC3339),
	}
	item, _ := attributevalue.MarshalMap(invItem)
	ddbClient.PutItem(ctx, &dynamodb.PutItemInput{TableName: &invoicesTbl, Item: item})

	// Audit log
	writeAudit(ctx, "SYSTEM", user.ID, "GENERATE_INVOICE", invID, invNumber)
	return nil
}

func getExistingInvoice(ctx context.Context, userID, yearMonth string) (map[string]dbtypes.AttributeValue, error) {
	out, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName: &invoicesTbl, IndexName: aws.String("userId-yearMonth-index"),
		KeyConditionExpression: aws.String("user_id = :uid AND year_month = :ym"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
			":ym":  &dbtypes.AttributeValueMemberS{Value: yearMonth},
		},
		Limit: aws.Int32(1),
	})
	if err != nil || len(out.Items) == 0 {
		return nil, err
	}
	return out.Items[0], nil
}

func getPlan(ctx context.Context, planID string) *Plan {
	if planID == "" { planID = "developer" }
	out, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &planTbl,
		Key: map[string]dbtypes.AttributeValue{"planId": &dbtypes.AttributeValueMemberS{Value: planID}},
	})
	if err != nil || out.Item == nil { return nil }
	var p Plan
	attributevalue.UnmarshalMap(out.Item, &p)
	return &p
}

func aggregateUsage(ctx context.Context, userID, yearMonth string) (int64, int64) {
	out, _ := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName: &usageTbl,
		KeyConditionExpression: aws.String("userId = :uid AND begins_with(sk, :ym)"),
		ExpressionAttributeValues: map[string]dbtypes.AttributeValue{
			":uid": &dbtypes.AttributeValueMemberS{Value: userID},
			":ym":  &dbtypes.AttributeValueMemberS{Value: yearMonth},
		},
	})
	if out == nil { return 0, 0 }
	type row struct {
		Input  int64 `dynamodbav:"input_tokens"`
		Output int64 `dynamodbav:"output_tokens"`
	}
	var rows []row
	attributevalue.UnmarshalListOfMaps(out.Items, &rows)
	var i, o int64
	for _, r := range rows { i += r.Input; o += r.Output }
	return i, o
}

func calcCost(input, output int64, rateIn, rateOut float64) float64 {
	ci := math.Max(0, float64(input-freeInputTokens))
	co := math.Max(0, float64(output-freeOutputTokens))
	return (ci/1e6)*rateIn + (co/1e6)*rateOut
}

func parseYearMonth(ym string) (int, time.Month) {
	t, _ := time.Parse("2006-01", ym)
	return t.Year(), t.Month()
}

func writeAudit(ctx context.Context, adminID, targetID, action, resourceID, newVal string) {
	now := time.Now().UTC().Format(time.RFC3339)
	item := map[string]interface{}{
		"id": fmt.Sprintf("audit_%d", time.Now().UnixNano()), "timestamp": now,
		"admin_user_id": adminID, "target_user_id": targetID,
		"action": action, "resource_collection": "invoices",
		"resource_id": resourceID, "new_value": newVal,
	}
	m, _ := attributevalue.MarshalMap(item)
	ddbClient.PutItem(ctx, &dynamodb.PutItemInput{TableName: &auditTbl, Item: m})
}

func main() {
	lambda.Start(handler)
}

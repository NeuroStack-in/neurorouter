#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Seed Plan Catalog — Inserts free & developer plans into DynamoDB
# ═══════════════════════════════════════════════════════════════
#
# WHAT THIS DOES:
#   Inserts two plan records into the neurorouter-plan-catalog-dev table.
#   These plans define pricing, token limits, and features for each tier.
#
# USAGE:
#   bash infra/scripts/seed-plan-catalog.sh
#
# SAFE TO RUN MULTIPLE TIMES:
#   DynamoDB put_item overwrites existing items with the same key,
#   so running this twice just updates the same records.

set -e
REGION="ap-south-1"
TABLE="neurorouter-plan-catalog-dev"

echo "🌱 Seeding plan_catalog table: $TABLE"

# ── Free Plan ──
# For users who just signed up. Limited tokens, no cost.
echo "  → Inserting 'free' plan..."
aws dynamodb put-item \
  --table-name "$TABLE" \
  --region "$REGION" \
  --item '{
    "planId": {"S": "free"},
    "name": {"S": "Free"},
    "description": {"S": "Free tier with limited usage"},
    "monthlyTokenLimit": {"N": "1000000"},
    "inputTokensFree": {"N": "1000000"},
    "outputTokensFree": {"N": "1000000"},
    "fixedFeeInr": {"N": "0"},
    "rateInputUsdPer1M": {"N": "0"},
    "rateOutputUsdPer1M": {"N": "0"},
    "features": {"L": [
      {"S": "1M free input tokens/month"},
      {"S": "1M free output tokens/month"},
      {"S": "Access to llama-3.3-70b-versatile"},
      {"S": "Community support"}
    ]},
    "isActive": {"BOOL": true},
    "createdAt": {"S": "2026-03-25T00:00:00Z"},
    "updatedAt": {"S": "2026-03-25T00:00:00Z"}
  }'

# ── Developer Plan ──
# Paid plan with higher limits and variable usage billing.
echo "  → Inserting 'developer' plan..."
aws dynamodb put-item \
  --table-name "$TABLE" \
  --region "$REGION" \
  --item '{
    "planId": {"S": "developer"},
    "name": {"S": "Developer"},
    "description": {"S": "For developers and small teams with production workloads"},
    "monthlyTokenLimit": {"N": "50000000"},
    "inputTokensFree": {"N": "1000000"},
    "outputTokensFree": {"N": "1000000"},
    "fixedFeeInr": {"N": "1599"},
    "rateInputUsdPer1M": {"N": "2"},
    "rateOutputUsdPer1M": {"N": "8"},
    "features": {"L": [
      {"S": "50M token limit/month"},
      {"S": "1M free input + 1M free output tokens"},
      {"S": "INR 1599/month infrastructure fee"},
      {"S": "USD 2/1M input tokens (after free tier)"},
      {"S": "USD 8/1M output tokens (after free tier)"},
      {"S": "Access to all models"},
      {"S": "Priority support"},
      {"S": "Invoice PDF generation"}
    ]},
    "isActive": {"BOOL": true},
    "createdAt": {"S": "2026-03-25T00:00:00Z"},
    "updatedAt": {"S": "2026-03-25T00:00:00Z"}
  }'

echo "✅ Plan catalog seeded successfully!"
echo ""
echo "Verify in console: https://eu-north-1.console.aws.amazon.com/dynamodbv2/home?region=eu-north-1#item-explorer?table=neurorouter-plan-catalog-dev"

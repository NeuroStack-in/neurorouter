#!/bin/bash
# Build and deploy auth-service Lambda
# Usage: ./deploy.sh [dev|staging|prod]

set -euo pipefail

ENV="${1:-dev}"
FUNCTION_NAME="neurorouter-auth-service-${ENV}"

echo "Building auth-service for Linux/ARM64..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap .

echo "Packaging..."
zip -j auth-service.zip bootstrap

echo "Deploying to ${FUNCTION_NAME}..."
aws lambda update-function-code \
    --function-name "${FUNCTION_NAME}" \
    --zip-file fileb://auth-service.zip \
    --architectures arm64

echo "Done. Cleaning up..."
rm -f bootstrap auth-service.zip

echo "auth-service deployed to ${FUNCTION_NAME}"

#!/bin/bash
set -euo pipefail
ENV="${1:-dev}"
FUNCTION_NAME="neurorouter-billing-service-${ENV}"
echo "Building billing-service..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap .
zip -j billing-service.zip bootstrap
echo "Deploying to ${FUNCTION_NAME}..."
aws lambda update-function-code --function-name "${FUNCTION_NAME}" --zip-file fileb://billing-service.zip --architectures arm64
rm -f bootstrap billing-service.zip
echo "Done."

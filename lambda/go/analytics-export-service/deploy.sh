#!/bin/bash
set -euo pipefail
ENV="${1:-dev}"
FUNCTION_NAME="neurorouter-analytics-export-service-${ENV}"
echo "Building analytics-export-service..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap .
zip -j analytics-export-service.zip bootstrap
echo "Deploying to ${FUNCTION_NAME}..."
aws lambda update-function-code --function-name "${FUNCTION_NAME}" --zip-file fileb://analytics-export-service.zip --architectures arm64
rm -f bootstrap analytics-export-service.zip
echo "Done."

#!/bin/bash
set -euo pipefail
ENV="${1:-dev}"
FUNCTION_NAME="neurorouter-router-service-${ENV}"
echo "Building router-service..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap .
zip -j router-service.zip bootstrap
echo "Deploying to ${FUNCTION_NAME}..."
aws lambda update-function-code --function-name "${FUNCTION_NAME}" --zip-file fileb://router-service.zip --architectures arm64
rm -f bootstrap router-service.zip
echo "Done."

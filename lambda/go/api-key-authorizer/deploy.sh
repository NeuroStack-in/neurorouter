#!/bin/bash
set -euo pipefail
ENV="${1:-dev}"
FUNCTION_NAME="neurorouter-api-key-authorizer-${ENV}"
echo "Building api-key-authorizer..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap .
zip -j api-key-authorizer.zip bootstrap
echo "Deploying to ${FUNCTION_NAME}..."
aws lambda update-function-code --function-name "${FUNCTION_NAME}" --zip-file fileb://api-key-authorizer.zip --architectures arm64
rm -f bootstrap api-key-authorizer.zip
echo "Done."

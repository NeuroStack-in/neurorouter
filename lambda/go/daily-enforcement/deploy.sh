#!/bin/bash
set -euo pipefail
ENV="${1:-dev}"
FUNCTION_NAME="neurorouter-daily-enforcement-${ENV}"
echo "Building daily-enforcement..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap .
zip -j daily-enforcement.zip bootstrap
echo "Deploying to ${FUNCTION_NAME}..."
aws lambda update-function-code --function-name "${FUNCTION_NAME}" --zip-file fileb://daily-enforcement.zip --architectures arm64
rm -f bootstrap daily-enforcement.zip
echo "Done."

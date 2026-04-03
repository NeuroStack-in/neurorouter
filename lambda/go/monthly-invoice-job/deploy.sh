#!/bin/bash
set -euo pipefail
ENV="${1:-dev}"
FUNCTION_NAME="neurorouter-monthly-invoice-job-${ENV}"
echo "Building monthly-invoice-job..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap .
zip -j monthly-invoice-job.zip bootstrap
echo "Deploying to ${FUNCTION_NAME}..."
aws lambda update-function-code --function-name "${FUNCTION_NAME}" --zip-file fileb://monthly-invoice-job.zip --architectures arm64
rm -f bootstrap monthly-invoice-job.zip
echo "Done."

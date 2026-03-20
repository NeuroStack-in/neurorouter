#!/bin/bash
set -e
FUNCTION_NAME="${1:-neurorouter-analytics-export-service}"
REGION="${AWS_REGION:-ap-south-1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
ZIP_FILE="${SCRIPT_DIR}/analytics-export-service.zip"

echo "🚀 Deploying ${FUNCTION_NAME}..."
rm -rf "${BUILD_DIR}" "${ZIP_FILE}"
mkdir -p "${BUILD_DIR}"
pip install -r "${SCRIPT_DIR}/requirements.txt" -t "${BUILD_DIR}" --no-cache-dir --quiet
rm -rf "${BUILD_DIR}/boto3" "${BUILD_DIR}/botocore" "${BUILD_DIR}/s3transfer"
cp "${SCRIPT_DIR}"/*.py "${BUILD_DIR}/"
cd "${BUILD_DIR}" && zip -r "${ZIP_FILE}" . -q && cd "${SCRIPT_DIR}"
echo "📏 Zip size: $(du -h "${ZIP_FILE}" | cut -f1)"
aws lambda update-function-code --function-name "${FUNCTION_NAME}" --zip-file "fileb://${ZIP_FILE}" --region "${REGION}" --no-cli-pager
echo "✅ Deployed ${FUNCTION_NAME}!"

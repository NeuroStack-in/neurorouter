#!/bin/bash
# ============================================================
# Deploy script for router-service Lambda
# ============================================================
#
# WHAT THIS SCRIPT DOES (step by step):
# 1. Cleans up any previous build artifacts
# 2. Installs Python dependencies into a build/ folder
# 3. Copies your Lambda code files into build/
# 4. Zips everything into router-service.zip
# 5. Uploads the zip to AWS Lambda
#
# USAGE:
#   ./deploy.sh                    # Uses default function name
#   ./deploy.sh my-function-name   # Override the Lambda function name
#
# PREREQUISITES:
# - AWS CLI installed and configured (aws configure)
# - Lambda function already created in AWS (Dev 1 does this via CDK)
# ============================================================

set -e  # Exit immediately if any command fails (safety net)

# --------------- Configuration ---------------

# Lambda function name — can be overridden by passing as argument
# Default: "neurorouter-router-service"
FUNCTION_NAME="${1:-neurorouter-router-service}"

# AWS region — change if your Lambda is in a different region
REGION="${AWS_REGION:-ap-south-1}"

# Directory this script lives in (so it works from any working directory)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Build artifacts go here
BUILD_DIR="${SCRIPT_DIR}/build"
ZIP_FILE="${SCRIPT_DIR}/router-service.zip"

echo "🚀 Deploying ${FUNCTION_NAME} to ${REGION}..."

# --------------- Step 1: Clean previous build ---------------
echo "🧹 Cleaning previous build..."
rm -rf "${BUILD_DIR}" "${ZIP_FILE}"
# WHY: Old files from previous deploys could cause conflicts.
# rm -rf = remove recursively and force (no "are you sure?" prompts)

# --------------- Step 2: Install dependencies ---------------
echo "📦 Installing dependencies..."
mkdir -p "${BUILD_DIR}"
pip install \
    -r "${SCRIPT_DIR}/requirements.txt" \
    -t "${BUILD_DIR}" \
    --no-cache-dir \
    --quiet
# WHY each flag:
# -r requirements.txt  = install packages listed in this file
# -t build/            = install INTO the build directory (not global)
# --no-cache-dir       = don't cache downloads (saves disk space in CI)
# --quiet              = less noisy output

# SKIP boto3 — it's already in the Lambda runtime (saves ~50MB in zip)
echo "🗑️  Removing boto3/botocore (pre-installed in Lambda runtime)..."
rm -rf "${BUILD_DIR}/boto3" "${BUILD_DIR}/botocore" "${BUILD_DIR}/s3transfer"
# WHY: Lambda runtime already has boto3. Including it would:
# 1. Make the zip file huge (~50MB bigger)
# 2. Possibly conflict with Lambda's built-in version

# --------------- Step 3: Copy Lambda code ---------------
echo "📋 Copying Lambda code..."
cp "${SCRIPT_DIR}"/*.py "${BUILD_DIR}/"
cp -r "${SCRIPT_DIR}/providers" "${BUILD_DIR}/"
# WHY: We copy .py files into the same directory as dependencies
# so that imports work correctly. Lambda extracts the zip to /var/task/
# and all files must be at the root level (or in proper packages).

# --------------- Step 4: Create zip archive ---------------
echo "📦 Creating zip archive..."
cd "${BUILD_DIR}"
zip -r "${ZIP_FILE}" . -q
# WHY: Lambda expects a .zip file.
# -r  = recursive (include all subdirectories)
# -q  = quiet (don't list every file)
# We cd into BUILD_DIR first so the zip contains files at root level,
# not nested inside a "build/" directory.

cd "${SCRIPT_DIR}"

# Show zip size (Lambda has a 50MB direct upload limit, 250MB unzipped limit)
ZIP_SIZE=$(du -h "${ZIP_FILE}" | cut -f1)
echo "📏 Zip size: ${ZIP_SIZE}"

# --------------- Step 5: Upload to AWS Lambda ---------------
echo "☁️  Uploading to AWS Lambda..."
aws lambda update-function-code \
    --function-name "${FUNCTION_NAME}" \
    --zip-file "fileb://${ZIP_FILE}" \
    --region "${REGION}" \
    --no-cli-pager
# WHY each flag:
# --function-name    = which Lambda to update
# --zip-file         = path to zip, "fileb://" prefix means local binary file
# --region           = AWS region where the Lambda lives
# --no-cli-pager     = don't open a pager (less) for the output

echo "✅ Deployed ${FUNCTION_NAME} successfully!"

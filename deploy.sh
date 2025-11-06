#!/bin/bash

set -e

# Configuration
PROJECT_ID="${GOOGLE_CLOUD_PROJECT}"
REGION="us-central1"
SERVICE_NAME="mcp-glucose"

# Validate required environment variables
if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: GOOGLE_CLOUD_PROJECT environment variable is required"
  exit 1
fi

if [ -z "$STORAGE_API_URL" ]; then
  echo "❌ Error: STORAGE_API_URL environment variable is required"
  exit 1
fi

if [ -z "$API_SECRET" ]; then
  echo "❌ Error: API_SECRET environment variable is required"
  exit 1
fi

echo "🚀 Deploying MCP Glucose Server to Cloud Run"
echo "================================================"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo "Storage API: $STORAGE_API_URL"
echo ""

# Enable required APIs
echo "📡 Enabling required Google Cloud APIs..."
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID"

# Create/update secrets in Secret Manager
echo "🔐 Setting up secrets in Secret Manager..."

# API_SECRET
if gcloud secrets describe glucose-api-secret --project="$PROJECT_ID" &>/dev/null; then
  echo "Updating glucose-api-secret..."
  echo -n "$API_SECRET" | gcloud secrets versions add glucose-api-secret \
    --data-file=- \
    --project="$PROJECT_ID"
else
  echo "Creating glucose-api-secret..."
  echo -n "$API_SECRET" | gcloud secrets create glucose-api-secret \
    --data-file=- \
    --replication-policy="automatic" \
    --project="$PROJECT_ID"
fi

# Grant Secret Manager access to Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "🔓 Granting secret access to Cloud Run service account..."
gcloud secrets add-iam-policy-binding glucose-api-secret \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="$PROJECT_ID" \
  --quiet

# Build container image
echo "🏗️  Building container image..."
gcloud builds submit \
  --tag "gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest" \
  --project="$PROJECT_ID"

# Deploy to Cloud Run
echo "🚢 Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --image "gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest" \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,STORAGE_API_URL=${STORAGE_API_URL},USER_ID=${USER_ID:-}" \
  --set-secrets="API_SECRET=glucose-api-secret:latest" \
  --memory=512Mi \
  --cpu=1 \
  --timeout=300 \
  --max-instances=10 \
  --project="$PROJECT_ID"

# Get service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")

echo ""
echo "================================================"
echo "✅ Deployment successful!"
echo "================================================"
echo ""
echo "Service URL: $SERVICE_URL"
echo ""
echo "📌 Important Endpoints:"
echo "  Health Check: ${SERVICE_URL}/health"
echo "  Tools List:   ${SERVICE_URL}/tools"
echo "  SSE Endpoint: ${SERVICE_URL}/sse"
echo ""
echo "🔌 For ChatGPT/Deep Research:"
echo "  Use this URL: ${SERVICE_URL}/sse"
echo ""
echo "🧪 Test the deployment:"
echo "  curl ${SERVICE_URL}/health"
echo "  curl ${SERVICE_URL}/tools"
echo ""

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

# OAuth configuration (required for OAuth-enabled deployment)
if [ -z "$OAUTH_CLIENT_SECRET" ]; then
  echo "❌ Error: OAUTH_CLIENT_SECRET environment variable is required for OAuth deployment"
  echo "   This should be the client secret from migration 015"
  exit 1
fi

# Set default OAUTH_CLIENT_ID if not provided
OAUTH_CLIENT_ID="${OAUTH_CLIENT_ID:-glucose-mcp-production}"

# Backend URL (where OAuth authorization happens)
BACKEND_URL="${BACKEND_URL:-https://health-data-storage-835031330028.us-central1.run.app}"

# Public URL for this MCP server (used for OAuth redirects)
PUBLIC_URL="${PUBLIC_URL:-https://mcp-glucose-835031330028.us-central1.run.app}"

echo "🚀 Deploying MCP Glucose Server (OAuth) to Cloud Run"
echo "============================================================="
echo "Project:        $PROJECT_ID"
echo "Region:         $REGION"
echo "Service:        $SERVICE_NAME"
echo "Backend URL:    $BACKEND_URL"
echo "Public URL:     $PUBLIC_URL"
echo "OAuth Client:   $OAUTH_CLIENT_ID"
echo ""

# Enable required APIs
echo "📡 Enabling required Google Cloud APIs..."
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID"

# Create/update OAuth secrets in Secret Manager
echo "🔐 Setting up OAuth secrets in Secret Manager..."

# OAuth Client ID
if gcloud secrets describe glucose-oauth-client-id --project="$PROJECT_ID" &>/dev/null; then
  echo "Updating glucose-oauth-client-id..."
  echo -n "$OAUTH_CLIENT_ID" | gcloud secrets versions add glucose-oauth-client-id \
    --data-file=- \
    --project="$PROJECT_ID"
else
  echo "Creating glucose-oauth-client-id..."
  echo -n "$OAUTH_CLIENT_ID" | gcloud secrets create glucose-oauth-client-id \
    --data-file=- \
    --replication-policy="automatic" \
    --project="$PROJECT_ID"
fi

# OAuth Client Secret
if gcloud secrets describe glucose-oauth-secret --project="$PROJECT_ID" &>/dev/null; then
  echo "Updating glucose-oauth-secret..."
  echo -n "$OAUTH_CLIENT_SECRET" | gcloud secrets versions add glucose-oauth-secret \
    --data-file=- \
    --project="$PROJECT_ID"
else
  echo "Creating glucose-oauth-secret..."
  echo -n "$OAUTH_CLIENT_SECRET" | gcloud secrets create glucose-oauth-secret \
    --data-file=- \
    --replication-policy="automatic" \
    --project="$PROJECT_ID"
fi

# Grant Secret Manager access to Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "🔓 Granting secret access to Cloud Run service account..."
gcloud secrets add-iam-policy-binding glucose-oauth-client-id \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="$PROJECT_ID" \
  --quiet

gcloud secrets add-iam-policy-binding glucose-oauth-secret \
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
  --set-env-vars="NODE_ENV=production,BACKEND_URL=${BACKEND_URL},PUBLIC_URL=${PUBLIC_URL}" \
  --set-secrets="OAUTH_CLIENT_ID=glucose-oauth-client-id:latest,OAUTH_CLIENT_SECRET=glucose-oauth-secret:latest" \
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
echo "============================================================="
echo "✅ OAuth-enabled deployment successful!"
echo "============================================================="
echo ""
echo "Service URL: $SERVICE_URL"
echo ""
echo "📌 Important OAuth Endpoints:"
echo "  Health Check:     ${SERVICE_URL}/health"
echo "  SSE Endpoint:     ${SERVICE_URL}/sse"
echo "  OAuth Start:      ${SERVICE_URL}/oauth/authorize"
echo "  OAuth Callback:   ${SERVICE_URL}/oauth/callback"
echo "  RFC 9728 Metadata: ${SERVICE_URL}/.well-known/oauth-protected-resource"
echo ""
echo "🔐 OAuth Configuration:"
echo "  Client ID:     $OAUTH_CLIENT_ID"
echo "  Backend:       $BACKEND_URL"
echo "  Public URL:    $PUBLIC_URL"
echo ""
echo "🧪 Test the deployment:"
echo "  curl ${SERVICE_URL}/health"
echo "  curl ${SERVICE_URL}/.well-known/oauth-protected-resource"
echo ""
echo "📝 For ChatGPT Deep Research:"
echo "  1. The service will auto-discover OAuth via RFC 9728"
echo "  2. Users will be redirected to $BACKEND_URL for authentication"
echo "  3. After auth, they'll return to ${SERVICE_URL}/oauth/callback"
echo ""

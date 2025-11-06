# MCP Glucose Server - Deployment Guide

## ✅ Successfully Deployed!

Your MCP Glucose server is now live on Google Cloud Run!

### 🔗 Service Information

**Service URL:** `https://mcp-glucose-835031330028.us-central1.run.app`

**Important Endpoints:**
- **Health Check:** https://mcp-glucose-835031330028.us-central1.run.app/health
- **Tools List:** https://mcp-glucose-835031330028.us-central1.run.app/tools
- **SSE Endpoint (ChatGPT):** https://mcp-glucose-835031330028.us-central1.run.app/sse

---

## 🤖 Using with ChatGPT / Deep Research

### Setup Instructions:

1. **In ChatGPT**, click your profile (bottom left)
2. Go to **Settings → Beta Features**
3. Enable **"MCP Actions"** or **"Actions"**
4. Go to **Settings → Actions**
5. Click **"Add Action"**
6. **Name:** `Glucose Data`
7. **URL:** `https://mcp-glucose-835031330028.us-central1.run.app/sse`
8. Click **Save**

### Available Tools:

ChatGPT can now access these glucose data tools:

1. **get_latest_glucose** - Get your most recent glucose reading
2. **get_glucose_readings** - Get glucose readings for a date range
3. **get_glucose_stats** - Get glucose statistics (avg, min, max)

### Example Queries:

Try asking ChatGPT:
- "What's my latest glucose reading?"
- "Show me my glucose levels from today"
- "What's my average glucose this week?"
- "How has my glucose been trending over the past 3 days?"

---

## 💻 Using with Claude Desktop (Local)

Your local Claude Desktop config is already set up!

**Config File:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "glucose": {
      "command": "node",
      "args": ["/Users/lucashanson/Documents/Github/mcp-glucose/build/index.js"],
      "env": {
        "STORAGE_API_URL": "https://health-data-storage-835031330028.us-central1.run.app",
        "API_SECRET": "ksYdBzcl5cqhxLEqGd9Pxlk+3ouea7rrGR7lCPq7Xeg=",
        "USER_ID": "lucas@example.com"
      }
    }
  }
}
```

**Restart Claude Desktop** to use the tools.

---

## 📊 Architecture

```
┌─────────────────────────────────────────────┐
│           AI Assistants                      │
│  ┌──────────────┐      ┌──────────────┐    │
│  │   ChatGPT    │      │    Claude    │    │
│  │   (Remote)   │      │   (Local)    │    │
│  └──────┬───────┘      └──────┬───────┘    │
│         │ SSE                  │ stdio       │
└─────────┼──────────────────────┼────────────┘
          │                      │
          ▼                      ▼
   ┌──────────────┐       ┌──────────────┐
   │ mcp-glucose  │       │ mcp-glucose  │
   │ (Cloud Run)  │       │   (Local)    │
   └──────┬───────┘       └──────┬───────┘
          │                      │
          │   HTTP GET           │
          └──────────┬───────────┘
                     ▼
          ┌─────────────────────┐
          │ health-data-storage │
          │   (Cloud Run API)   │
          └─────────┬───────────┘
                    ▼
          ┌─────────────────────┐
          │  PostgreSQL (Cloud  │
          │   SQL Database)     │
          └─────────────────────┘
```

---

## 🧪 Testing the Deployment

### Test Health Endpoint:
```bash
curl https://mcp-glucose-835031330028.us-central1.run.app/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "mcp-glucose",
  "timestamp": "2025-10-23T05:06:59.098Z",
  "storage_api": "https://health-data-storage-835031330028.us-central1.run.app"
}
```

### Test Tools Endpoint:
```bash
curl https://mcp-glucose-835031330028.us-central1.run.app/tools
```

### View Logs:
```bash
gcloud run services logs read mcp-glucose --region=us-central1 --limit=50
```

---

## 🔄 Updating the Deployment

If you make changes to the code and want to redeploy:

```bash
cd /Users/lucashanson/Documents/Github/mcp-glucose

# Rebuild TypeScript
npm run build

# Redeploy to Cloud Run
GOOGLE_CLOUD_PROJECT=personal-assistant-e4351 \
STORAGE_API_URL=https://health-data-storage-835031330028.us-central1.run.app \
API_SECRET="ksYdBzcl5cqhxLEqGd9Pxlk+3ouea7rrGR7lCPq7Xeg=" \
USER_ID="lucas@example.com" \
./deploy.sh
```

---

## 🔐 Security

- **Authentication:** Uses API_SECRET stored in Google Secret Manager
- **Public Access:** Service is public (`--allow-unauthenticated`) - anyone can call it
- **Storage API:** Protected by API_SECRET header
- **Data Access:** Limited to configured USER_ID (`lucas@example.com`)

### To Make Private:

If you want to restrict access:

```bash
gcloud run services update mcp-glucose \
  --region=us-central1 \
  --no-allow-unauthenticated \
  --project=personal-assistant-e4351
```

Then you'll need to use authentication tokens for ChatGPT access.

---

## 📈 Monitoring

### View Service Status:
```bash
gcloud run services describe mcp-glucose \
  --region=us-central1 \
  --project=personal-assistant-e4351
```

### View Recent Logs:
```bash
gcloud run services logs read mcp-glucose \
  --region=us-central1 \
  --limit=100
```

### Check Metrics:
Visit: https://console.cloud.google.com/run/detail/us-central1/mcp-glucose/metrics

---

## 💰 Cost Estimate

**Cloud Run Pricing (approximate):**
- **Requests:** First 2 million requests/month free
- **Compute Time:** First 180,000 vCPU-seconds free
- **Memory:** First 360,000 GiB-seconds free
- **Typical Cost:** $0-2/month for personal use

**Total System Cost:**
- MCP Server: $0-2/month
- Health Data Storage: $0-5/month
- PostgreSQL Database: $10-15/month
- **Total:** ~$10-22/month

---

## 🐛 Troubleshooting

### ChatGPT Can't Connect:

1. Check the URL is correct (no trailing slash): `/sse` not `/sse/`
2. Test the SSE endpoint manually:
   ```bash
   curl -N https://mcp-glucose-835031330028.us-central1.run.app/sse
   ```
3. Check Cloud Run logs for errors

### No Data Returned:

1. Verify your iPhone app is syncing data
2. Check USER_ID matches between iPhone app and MCP server
3. Test the storage API directly:
   ```bash
   curl -H "X-API-Secret: ksYdBzcl5cqhxLEqGd9Pxlk+3ouea7rrGR7lCPq7Xeg=" \
     "https://health-data-storage-835031330028.us-central1.run.app/api/samples/latest?userId=lucas@example.com&type=BloodGlucose"
   ```

### Server Errors:

1. Check logs: `gcloud run services logs read mcp-glucose --region=us-central1`
2. Verify secrets are accessible
3. Check storage API is reachable from Cloud Run

---

## 🎉 Success!

Your glucose MCP server is now:
- ✅ Deployed to Google Cloud Run
- ✅ Connected to your health data storage
- ✅ Ready to use with ChatGPT and Claude
- ✅ Automatically syncing from your iPhone
- ✅ Providing real-time glucose insights

**Next Steps:**
1. Add the server to ChatGPT (see instructions above)
2. Try asking questions about your glucose data
3. Keep your iPhone app syncing in the background

---

**Deployed on:** October 23, 2025
**Service URL:** https://mcp-glucose-835031330028.us-central1.run.app
**Region:** us-central1
**Project:** personal-assistant-e4351

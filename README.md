# MCP Glucose Server

A Model Context Protocol (MCP) server that provides glucose data query tools to AI assistants like Claude and ChatGPT. Connects to the `health-data-storage` API to retrieve glucose readings.

## 🎯 Purpose

This MCP server acts as a **specialized interface** between AI assistants and your glucose data. It provides natural language tools for querying glucose levels, trends, and statistics.

## 🏗️ Architecture Position

```
┌──────────────────────┐
│ health-data-storage  │
│  REST API            │
└──────────┬───────────┘
           │ HTTP GET
           ▼
    ┌──────────────┐
    │ mcp-glucose  │  ← YOU ARE HERE
    │ (MCP Server) │
    └──────┬───────┘
           │ MCP Tools
           ▼
   ┌───────────────┐
   │ Claude/ChatGPT│
   └───────────────┘
```

## 🔧 Available Tools

### 1. `get_glucose_readings`
Get glucose readings within a date range.

**Parameters:**
- `userId` (optional): User identifier (defaults to USER_ID env var)
- `startDate` (optional): Start date in ISO 8601 format
- `endDate` (optional): End date in ISO 8601 format
- `limit` (optional): Maximum number of readings (default: 1000)

**Example queries:**
- "What's my glucose been like today?"
- "Show me my glucose readings for the past week"
- "Get my glucose levels from October 1st to October 22nd"

### 2. `get_latest_glucose`
Get the most recent glucose reading.

**Parameters:**
- `userId` (optional): User identifier (defaults to USER_ID env var)

**Example queries:**
- "What's my current glucose?"
- "What was my last glucose reading?"
- "Check my latest blood sugar"

### 3. `get_glucose_stats`
Get glucose statistics (count, average, min, max) for a time period.

**Parameters:**
- `userId` (optional): User identifier (defaults to USER_ID env var)
- `startDate` (optional): Start date in ISO 8601 format
- `endDate` (optional): End date in ISO 8601 format

**Example queries:**
- "What's my average glucose this week?"
- "Show me my glucose stats for the past month"
- "What was my glucose range yesterday?"

## 🚀 Setup

### Prerequisites
- Node.js 20+
- Access to a deployed `health-data-storage` instance
- API secret for authentication

### Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build
```

### Configuration

Create a `.env` file (or set environment variables):

```bash
STORAGE_API_URL=https://your-storage-api.run.app
API_SECRET=your-api-secret
USER_ID=user@example.com  # Optional default user
```

### Usage with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "glucose": {
      "command": "node",
      "args": ["/path/to/mcp-glucose/build/index.js"],
      "env": {
        "STORAGE_API_URL": "https://your-storage-api.run.app",
        "API_SECRET": "your-api-secret",
        "USER_ID": "user@example.com"
      }
    }
  }
}
```

Restart Claude Desktop.

### Usage with ChatGPT

*(ChatGPT MCP support coming soon)*

## 💬 Example Conversations

Once configured, you can ask Claude:

**Simple queries:**
> "What's my latest glucose?"

```json
{
  "value": 95,
  "unit": "mg/dL",
  "date": "2025-10-22T10:30:00Z",
  "source": "Lingo"
}
```

**Time range queries:**
> "Show me my glucose for the past 24 hours"

```json
{
  "count": 48,
  "readings": [
    { "value": 95, "unit": "mg/dL", "date": "2025-10-22T10:30:00Z", "source": "Lingo" },
    ...
  ]
}
```

**Statistical queries:**
> "What's my average glucose this week?"

```json
{
  "count": 336,
  "average": 98.5,
  "min": 75,
  "max": 125,
  "unit": "mg/dL"
}
```

**Analysis queries:**
> "Analyze my glucose patterns over the last month"

Claude will use the tools to fetch data and provide intelligent analysis of your glucose trends, patterns, and insights.

## 🔗 Related Projects

- **health-data-storage**: Storage backend that this server queries
- **health-tracking-app**: iOS app that collects the glucose data
- **mcp-activity**: (future) MCP server for activity/exercise data
- **mcp-nutrition**: (future) MCP server for food/nutrition data

## 📈 Future Enhancements

Potential additions:
- **Trend analysis tools**: Detect glucose spikes, patterns
- **Correlation tools**: Compare glucose with meals, exercise
- **Alert tools**: Notify when glucose is out of range
- **Export tools**: Generate reports, charts
- **Multi-user support**: Query data for multiple users

## 🛠️ Development

### Local Testing

```bash
# Build
npm run build

# Run (will use stdio transport)
npm start
```

The server runs on stdio (standard input/output) as per MCP specification. Use it with Claude Desktop or the MCP inspector for testing.

### Testing with MCP Inspector

```bash
npm install -g @modelcontextprotocol/inspector
npx @modelcontextprotocol/inspector node build/index.js
```

## 📝 License

MIT

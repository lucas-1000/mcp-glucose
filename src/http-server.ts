import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { HealthDataAPI } from './api-client.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const STORAGE_API_URL = process.env.STORAGE_API_URL || '';
const API_SECRET = process.env.API_SECRET || '';
const DEFAULT_USER_ID = process.env.USER_ID || '';

if (!STORAGE_API_URL || !API_SECRET) {
  console.error('❌ Error: STORAGE_API_URL and API_SECRET environment variables are required');
  process.exit(1);
}

// Initialize API client
const api = new HealthDataAPI(STORAGE_API_URL, API_SECRET);

// Define available tools
const TOOLS: Tool[] = [
  {
    name: 'search',
    description:
      'Search through glucose/blood sugar readings. Query can include date ranges or natural language.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query for glucose data. Can include keywords like "today", "yesterday", ' +
            '"last week", "last 30 days", or specific dates.',
        },
        userId: {
          type: 'string',
          description: `User identifier. Defaults to ${DEFAULT_USER_ID || 'configured user'} if not specified.`,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch',
    description:
      'Retrieve complete details for a specific glucose reading by ID. ' +
      'Use this after finding readings with the search tool.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'The unique identifier for the reading. Format: "reading:timestamp" ' +
            '(e.g., "reading:2024-01-15T10:30:00Z")',
        },
        userId: {
          type: 'string',
          description: `User identifier. Defaults to ${DEFAULT_USER_ID || 'configured user'} if not specified.`,
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_glucose_readings',
    description:
      'Get glucose/blood sugar readings for a user within a date range. Returns glucose values in mg/dL with timestamps and sources.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: `User identifier. Defaults to ${DEFAULT_USER_ID || 'configured user'} if not specified.`,
        },
        startDate: {
          type: 'string',
          description: 'Start date in ISO 8601 format (e.g., 2025-10-01T00:00:00Z). Optional.',
        },
        endDate: {
          type: 'string',
          description: 'End date in ISO 8601 format (e.g., 2025-10-22T23:59:59Z). Optional.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of readings to return (default: 1000)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_latest_glucose',
    description: 'Get the most recent glucose/blood sugar reading for a user. Returns value, unit, timestamp, and source.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: `User identifier. Defaults to ${DEFAULT_USER_ID || 'configured user'} if not specified.`,
        },
      },
      required: [],
    },
  },
  {
    name: 'get_glucose_stats',
    description:
      'Get glucose statistics (count, average, min, max) for a user within a date range. Useful for understanding glucose trends and patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: `User identifier. Defaults to ${DEFAULT_USER_ID || 'configured user'} if not specified.`,
        },
        startDate: {
          type: 'string',
          description: 'Start date in ISO 8601 format. Optional.',
        },
        endDate: {
          type: 'string',
          description: 'End date in ISO 8601 format. Optional.',
        },
      },
      required: [],
    },
  },
];

// Create ONE MCP server instance (reused for all sessions)
const server = new Server(
  {
    name: 'mcp-glucose',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper function to parse date queries for glucose
function parseGlucoseDateQuery(query: string): { startDate?: string; endDate?: string } {
  const now = new Date();
  const lowerQuery = query.toLowerCase();

  if (lowerQuery.includes('today')) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { startDate: today.toISOString(), endDate: now.toISOString() };
  }

  if (lowerQuery.includes('yesterday')) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
    const yesterdayEnd = new Date(yesterdayStart.getTime() + 24 * 60 * 60 * 1000);
    return { startDate: yesterdayStart.toISOString(), endDate: yesterdayEnd.toISOString() };
  }

  const lastDaysMatch = lowerQuery.match(/last (\d+) days?/);
  if (lastDaysMatch) {
    const days = parseInt(lastDaysMatch[1]);
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { startDate: start.toISOString(), endDate: now.toISOString() };
  }

  const lastWeekMatch = lowerQuery.match(/last week/);
  if (lastWeekMatch) {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { startDate: start.toISOString(), endDate: now.toISOString() };
  }

  // Default to last 7 days
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { startDate: start.toISOString(), endDate: now.toISOString() };
}

// Register tool handlers ONCE
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const userId = (args?.userId as string) || DEFAULT_USER_ID;

  if (!userId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: userId is required. Either provide it in the tool call or set USER_ID environment variable.',
        },
      ],
      isError: true,
    };
  }

  try {
    switch (name) {
      case 'search': {
        const query = args?.query as string;
        if (!query) {
          throw new Error('Query parameter is required');
        }

        console.log(`🔍 Executing search with query: "${query}"`);
        const { startDate, endDate } = parseGlucoseDateQuery(query);

        const readings = await api.getGlucoseReadings({
          userId,
          startDate,
          endDate,
          limit: 100,
        });

        // Format results for Deep Research
        const results: any[] = [];

        readings.forEach(reading => {
          const date = new Date(reading.date);
          results.push({
            id: `reading:${reading.date}`,
            title: `Glucose: ${reading.value} ${reading.unit}`,
            text: `Glucose reading of ${reading.value} ${reading.unit} on ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}. Source: ${reading.source}`,
            url: 'https://healthmate.app',
          });
        });

        console.log(`✅ Search completed successfully. Found ${results.length} results`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ results }, null, 2),
            },
          ],
        };
      }

      case 'fetch': {
        const id = args?.id as string;
        if (!id) {
          throw new Error('ID parameter is required');
        }

        console.log(`📥 Executing fetch with id: "${id}"`);
        const [type, timestamp] = id.split(':');

        if (type !== 'reading') {
          throw new Error(`Unknown type: ${type}`);
        }

        // Get readings around that timestamp
        const targetDate = new Date(timestamp);
        const startDate = new Date(targetDate.getTime() - 1 * 60 * 60 * 1000); // 1 hour before
        const endDate = new Date(targetDate.getTime() + 1 * 60 * 60 * 1000); // 1 hour after

        const readings = await api.getGlucoseReadings({
          userId,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          limit: 100,
        });

        const reading = readings.find(r => r.date === timestamp);

        if (!reading) {
          throw new Error(`Reading not found for ID: ${id}`);
        }

        const result = {
          id,
          title: `Glucose: ${reading.value} ${reading.unit}`,
          text: JSON.stringify({
            value: reading.value,
            unit: reading.unit,
            date: reading.date,
            source: reading.source,
          }, null, 2),
          url: 'https://healthmate.app',
          metadata: {
            type: 'glucose_reading',
            retrieved_at: new Date().toISOString(),
          },
        };

        console.log(`✅ Fetch completed successfully`);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_glucose_readings': {
        console.log(`📊 Fetching glucose readings for user: ${userId}`);
        const readings = await api.getGlucoseReadings({
          userId,
          startDate: args?.startDate as string | undefined,
          endDate: args?.endDate as string | undefined,
          limit: (args?.limit as number) || 1000,
        });

        console.log(`✅ Found ${readings.length} glucose readings`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: readings.length,
                  readings: readings.map((r) => ({
                    value: r.value,
                    unit: r.unit,
                    date: r.date,
                    source: r.source,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'get_latest_glucose': {
        console.log(`📊 Fetching latest glucose for user: ${userId}`);
        const reading = await api.getLatestGlucose(userId);

        if (!reading) {
          return {
            content: [
              {
                type: 'text',
                text: 'No glucose readings found for this user.',
              },
            ],
          };
        }

        console.log(`✅ Latest glucose: ${reading.value} ${reading.unit}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  value: reading.value,
                  unit: reading.unit,
                  date: reading.date,
                  source: reading.source,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'get_glucose_stats': {
        console.log(`📊 Fetching glucose stats for user: ${userId}`);
        const stats = await api.getGlucoseStats({
          userId,
          startDate: args?.startDate as string | undefined,
          endDate: args?.endDate as string | undefined,
        });

        if (!stats) {
          return {
            content: [
              {
                type: 'text',
                text: 'No glucose data found for the specified time range.',
              },
            ],
          };
        }

        console.log(`✅ Glucose stats: avg ${stats.average} ${stats.unit}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    console.error('❌ Error calling tool:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Set up Express server
const app = express();

// Don't parse JSON for /message - SSEServerTransport handles it
app.use((req, res, next) => {
  if (req.path === '/message') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Store transports by sessionId for multi-session support
const transports: Map<string, SSEServerTransport> = new Map();

// SSE endpoint - IMPORTANT: No trailing slash for ChatGPT compatibility
app.get('/sse', async (req, res) => {
  console.log('SSE client connected');

  // Create SSE transport - it will generate its own sessionId
  const transport = new SSEServerTransport('/message', res);

  // Use the transport's own sessionId
  const sessionId = (transport as any).sessionId;
  console.log(`Established SSE stream with session ID: ${sessionId}`);

  // Store transport by its sessionId
  transports.set(sessionId, transport);
  console.log(`Transport stored for session: ${sessionId} (total transports: ${transports.size})`);

  // Set up close handler
  (transport as any).onclose = () => {
    console.log(`SSE transport closed for session ${sessionId}`);
    transports.delete(sessionId);
    console.log(`Transport removed (total transports: ${transports.size})`);
  };

  // Connect the transport to the MCP server
  await server.connect(transport);
});

// POST /message handler - forwards messages to correct session
app.post('/message', async (req, res) => {
  console.log('Received POST to /message');

  // Extract session ID from URL query parameter
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    console.error('No session ID provided in request URL');
    res.status(400).send('Missing sessionId parameter');
    return;
  }

  console.log(`Looking for transport with sessionId: ${sessionId}`);
  console.log(`Available sessions: ${Array.from(transports.keys()).join(', ')}`);

  const transport = transports.get(sessionId);

  if (!transport) {
    console.error(`No active transport found for session ID: ${sessionId}`);
    res.status(404).json({
      error: 'Session not found',
      sessionId,
      availableSessions: Array.from(transports.keys())
    });
    return;
  }

  try {
    console.log(`Found transport for session: ${sessionId}, forwarding message`);
    await transport.handlePostMessage(req, res);
    console.log(`Message handled successfully for session: ${sessionId}`);
  } catch (error) {
    console.error(`Error handling message for session ${sessionId}:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'mcp-glucose',
    timestamp: new Date().toISOString(),
    storage_api: STORAGE_API_URL,
  });
});

// List tools endpoint (for debugging)
app.get('/tools', (req, res) => {
  res.json({
    tools: TOOLS,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🩸 Glucose MCP Server listening on port ${PORT}`);
  console.log(`📊 Health check: http://${HOST}:${PORT}/health`);
  console.log(`🔌 SSE endpoint: http://${HOST}:${PORT}/sse`);
  console.log(`📡 Connected to storage API: ${STORAGE_API_URL}`);
  console.log(`👤 Default user: ${DEFAULT_USER_ID || '(none - must specify in tool calls)'}`);
});

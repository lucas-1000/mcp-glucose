/**
 * OAuth-Enabled MCP Server for Glucose Data
 * Provides OAuth 2.1 multi-tenant authentication for ChatGPT and Claude
 *
 * This server implements RFC 9728 OAuth Protected Resource Metadata
 * and provides Bearer token authentication for secure multi-user access.
 */

import express from 'express';
import { AsyncLocalStorage } from 'async_hooks';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { HealthDataAPI } from './api-client.js';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Backend OAuth configuration
const BACKEND_URL = process.env.BACKEND_URL || 'https://health-data-storage-835031330028.us-central1.run.app';
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;

// Public URL for this MCP server (used for OAuth redirects)
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// Validate required environment variables
if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
  console.error('❌ Missing required OAuth environment variables:');
  if (!OAUTH_CLIENT_ID) console.error('  - OAUTH_CLIENT_ID');
  if (!OAUTH_CLIENT_SECRET) console.error('  - OAUTH_CLIENT_SECRET');
  process.exit(1);
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * AsyncLocalStorage provides session context for each request
 * This allows us to track which user (access token) is making each request
 */
const sessionContext = new AsyncLocalStorage<string>();

/**
 * Map of sessionId -> access_token
 * In production, consider using Redis or another distributed cache
 */
const sessionTokens = new Map<string, string>();

/**
 * Map of sessionId -> SSEServerTransport
 * Stores active SSE connections for message routing
 */
const transports = new Map<string, SSEServerTransport>();

/**
 * Get the current session's access token
 */
function getCurrentAccessToken(): string | undefined {
  const sessionId = sessionContext.getStore();
  if (!sessionId) return undefined;
  return sessionTokens.get(sessionId);
}

// ============================================================================
// MCP SERVER SETUP (Shared Instance)
// ============================================================================

/**
 * Create ONE MCP server instance (reused for all sessions)
 * This is critical for proper message routing via the transport Map
 */
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

// Setup tool handlers ONCE for the shared server
setupToolHandlers(server);

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================

const app = express();
app.use(express.json());

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'mcp-glucose',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    oauth_enabled: true,
  });
});

// ============================================================================
// RFC 9728: OAUTH PROTECTED RESOURCE METADATA
// ============================================================================

/**
 * REQUIRED for ChatGPT OAuth integration
 * See: https://www.rfc-editor.org/rfc/rfc9728.html
 */
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const baseUrl = PUBLIC_URL;

  res.json({
    resource: baseUrl,
    authorization_servers: [BACKEND_URL],
    bearer_methods_supported: ['header'],
    resource_signing_alg_values_supported: [],
    resource_documentation: `${baseUrl}/docs`,
    resource_policy_uri: `${baseUrl}/policy`,
    mcp_endpoint: `${baseUrl}/sse`,
  });
});

// ============================================================================
// OAUTH AUTHORIZATION FLOW
// ============================================================================

/**
 * Step 1: OAuth Authorization
 * Redirects user to LifeOS backend for authentication
 */
app.get('/oauth/authorize', async (req, res) => {
  const { scope } = req.query;

  console.log('🔐 OAuth authorization requested', { scope });

  // Construct authorization URL with backend OAuth server
  const backendAuthUrl = new URL(`${BACKEND_URL}/oauth/authorize`);
  backendAuthUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
  backendAuthUrl.searchParams.set('redirect_uri', `${PUBLIC_URL}/oauth/callback`);
  backendAuthUrl.searchParams.set('response_type', 'code');
  backendAuthUrl.searchParams.set('scope', scope as string || 'profile read:health write:health');
  backendAuthUrl.searchParams.set('state', uuidv4()); // CSRF protection

  res.redirect(backendAuthUrl.toString());
});

/**
 * Step 2: OAuth Callback
 * Handles the callback from LifeOS backend after user authentication
 */
app.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('❌ OAuth error:', error);
    return res.status(400).send(`OAuth error: ${error}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  console.log('🔐 OAuth callback received, exchanging code for token');

  try {
    // Exchange authorization code for access token
    const tokenResponse = await axios.post(
      `${BACKEND_URL}/oauth/token`,
      {
        grant_type: 'authorization_code',
        code,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        redirect_uri: `${PUBLIC_URL}/oauth/callback`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      throw new Error('No access token in response');
    }

    // Generate session ID and store the access token
    const sessionId = uuidv4();
    sessionTokens.set(sessionId, access_token);

    console.log('✅ OAuth token obtained and stored', { sessionId });

    // Return success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorization Successful</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 1rem;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 400px;
          }
          h1 { color: #667eea; margin: 0 0 1rem 0; }
          p { color: #666; line-height: 1.6; }
          .checkmark { font-size: 4rem; color: #10b981; margin-bottom: 1rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="checkmark">✓</div>
          <h1>Authorization Successful</h1>
          <p>You can now close this window and return to ChatGPT or Claude.</p>
          <p style="font-size: 0.875rem; color: #999; margin-top: 2rem;">
            Session ID: ${sessionId}
          </p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Token exchange failed:', error);
    res.status(500).send('Token exchange failed');
  }
});

// ============================================================================
// SSE ENDPOINT FOR MCP
// ============================================================================

/**
 * Server-Sent Events endpoint for ChatGPT/Claude MCP connection
 * Requires Bearer token authentication
 */
app.get('/sse', async (req, res) => {
  console.log('📡 New SSE connection request');

  // Extract Bearer token from Authorization header
  const authHeader = req.headers.authorization;
  let accessToken: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7);
  }

  // If no token provided, send WWW-Authenticate challenge
  if (!accessToken) {
    const baseUrl = PUBLIC_URL;
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", ` +
      `scope="profile read:health write:health"`
    );
    return res.status(401).json({
      error: 'unauthorized',
      error_description: 'Bearer token required',
    });
  }

  console.log('✅ Bearer token provided, establishing SSE connection');

  try {
    // Create transport - SDK will generate sessionId
    const transport = new SSEServerTransport('/message', res);

    // Set 6-hour timeout for long-lived SSE connection
    res.setTimeout(1000 * 60 * 60 * 6); // 6 hours

    // Connect SHARED server to transport FIRST (generates sessionId)
    await server.connect(transport);

    // NOW we can get the sessionId from the transport
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    // Store access token for this session
    if (accessToken) {
      // Optional: introspect token for logging
      try {
        const introspectResponse = await axios.post(`${BACKEND_URL}/oauth/introspect`, {
          token: accessToken,
        });
        const userEmail = introspectResponse.data.email || 'unknown';
        sessionTokens.set(sessionId, accessToken);
        console.log(`✅ MCP server connected with sessionId: ${sessionId} (authenticated as ${userEmail})`);
      } catch (error) {
        console.warn('⚠️ Could not introspect token for logging');
        sessionTokens.set(sessionId, accessToken);
        console.log(`✅ MCP server connected with sessionId: ${sessionId}`);
      }
    }

    // Handle client disconnect
    req.on('close', () => {
      console.log(`🔌 SSE connection closed for ${sessionId}`);
      transports.delete(sessionId);
      sessionTokens.delete(sessionId);
    });

    // Handle errors
    req.on('error', (error) => {
      console.error(`❌ SSE error for ${sessionId}:`, error);
      transports.delete(sessionId);
      sessionTokens.delete(sessionId);
    });
  } catch (error) {
    console.error(`❌ Error setting up SSE:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to establish SSE connection' });
    }
  }
});

/**
 * POST endpoint for MCP messages (used by SSE transport)
 */
app.post('/message', express.json(), async (req, res) => {
  const sessionId = req.query.sessionId as string;

  console.log(`📨 Message request with sessionId: ${sessionId}, active transports: ${transports.size}`);

  if (!sessionId) {
    console.log(`❌ No sessionId provided in query`);
    return res.status(400).json({ error: 'sessionId query parameter is required' });
  }

  // Look up the transport by sessionId
  const transport = transports.get(sessionId);

  if (!transport) {
    console.log(`❌ No transport found for sessionId: ${sessionId}`);
    console.log(`   Available sessions: ${Array.from(transports.keys()).join(', ')}`);
    return res.status(404).json({
      error: 'No active SSE connection for this session. Please connect to /sse first.'
    });
  }

  console.log(`✅ Found transport for session ${sessionId}`);
  console.log(`📦 Message body:`, JSON.stringify(req.body).substring(0, 200));

  try {
    // Set session context before handling message
    await sessionContext.run(sessionId, async () => {
      // Pass the already-parsed body (express.json() middleware)
      await transport.handlePostMessage(req, res, req.body);
    });
  } catch (error) {
    console.error('❌ Error handling message:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to handle message' });
    }
  }
});

// ============================================================================
// TOOL HANDLERS
// ============================================================================

/**
 * Helper function to parse date queries for glucose
 */
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

/**
 * Set up MCP tool handlers with OAuth session context
 */
function setupToolHandlers(server: Server) {
  /**
   * List available tools
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
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
          properties: {},
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

    return { tools };
  });

  /**
   * Handle tool calls
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Get the current session's access token
    const accessToken = getCurrentAccessToken();

    if (!accessToken) {
      return {
        content: [
          {
            type: 'text',
            text: '❌ Error: No access token available. Please re-authenticate.',
          },
        ],
        isError: true,
      };
    }

    // Get userId from token introspection - for now use a placeholder
    // TODO: In production, validate token with backend and get actual user info
    const userId = 'oauth-user';

    try {
      // Initialize HealthData API client with Bearer token
      const api = new HealthDataAPI(BACKEND_URL, accessToken, true);

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

          readings.forEach((reading) => {
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

          const reading = readings.find((r) => r.date === timestamp);

          if (!reading) {
            throw new Error(`Reading not found for ID: ${id}`);
          }

          const result = {
            id,
            title: `Glucose: ${reading.value} ${reading.unit}`,
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
      const errorMessage = error.response?.data?.error || error.message || 'Unknown error';

      return {
        content: [
          {
            type: 'text',
            text: `❌ Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });
}

// ============================================================================
// START SERVER
// ============================================================================

app.listen(Number(PORT), HOST, () => {
  console.log('');
  console.log('='.repeat(80));
  console.log(`✅ mcp-glucose (OAuth) running on http://${HOST}:${PORT}`);
  console.log('='.repeat(80));
  console.log('');
  console.log('📋 Endpoints:');
  console.log(`  Health:         http://${HOST}:${PORT}/health`);
  console.log(`  SSE:            http://${HOST}:${PORT}/sse`);
  console.log(`  OAuth Start:    http://${HOST}:${PORT}/oauth/authorize`);
  console.log(`  OAuth Callback: http://${HOST}:${PORT}/oauth/callback`);
  console.log(`  Metadata:       http://${HOST}:${PORT}/.well-known/oauth-protected-resource`);
  console.log('');
  console.log('🔐 OAuth Configuration:');
  console.log(`  Client ID:      ${OAUTH_CLIENT_ID}`);
  console.log(`  Backend:        ${BACKEND_URL}`);
  console.log(`  Public URL:     ${PUBLIC_URL}`);
  console.log('');
  console.log('='.repeat(80));
});

#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { HealthDataAPI } from './api-client.js';
import dotenv from 'dotenv';

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

// Define MCP tools
const tools: Tool[] = [
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

// Create MCP server
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

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
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
      case 'get_glucose_readings': {
        const readings = await api.getGlucoseReadings({
          userId,
          startDate: args?.startDate as string | undefined,
          endDate: args?.endDate as string | undefined,
          limit: (args?.limit as number) || 1000,
        });

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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('✅ MCP Glucose Server running on stdio');
  console.error(`📊 Connected to storage API: ${STORAGE_API_URL}`);
  console.error(`👤 Default user: ${DEFAULT_USER_ID || '(none - must specify in tool calls)'}`);
}

main();

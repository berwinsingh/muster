#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  describeConfig,
  getFilteredServiceLogs,
  getGroupStatus,
  getServiceLogs,
  listServerGroups,
  restartServerGroup,
  runServerGroup,
  stopServerGroup,
} from './tools';

const server = new McpServer(
  {
    name: 'muster',
    version: '0.1.0',
  },
  {
    // Required when registering raw request handlers on server.server —
    // without these declarations the SDK throws at setRequestHandler time.
    capabilities: { tools: {}, resources: {}, prompts: {} },
  }
);

server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_server_groups',
      description: 'List all merged Muster server groups and their services',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'get_group_status',
      description: 'Get running/stopped status for each service in a group',
      inputSchema: {
        type: 'object',
        properties: { groupId: { type: 'string', description: 'Server group id' } },
        required: ['groupId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'run_server_group',
      description: 'Start all services in a server group (requires user confirmation in VS Code)',
      inputSchema: {
        type: 'object',
        properties: { groupId: { type: 'string', description: 'Server group id' } },
        required: ['groupId'],
        additionalProperties: false,
      },
    },
    {
      name: 'stop_server_group',
      description: 'Stop all services in a server group (requires user confirmation in VS Code)',
      inputSchema: {
        type: 'object',
        properties: { groupId: { type: 'string', description: 'Server group id' } },
        required: ['groupId'],
        additionalProperties: false,
      },
    },
    {
      name: 'restart_server_group',
      description: 'Restart all services in a server group (requires user confirmation in VS Code)',
      inputSchema: {
        type: 'object',
        properties: { groupId: { type: 'string', description: 'Server group id' } },
        required: ['groupId'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_service_logs',
      description:
        'Fetch recent log output from a running service (or every service in a group when serviceId is omitted — lines are tagged "[service] …"). Filter by severity (error/warn/info) and/or a substring to pull exactly the lines that matter, e.g. only the errors from one service.',
      inputSchema: {
        type: 'object',
        properties: {
          groupId: { type: 'string', description: 'Server group id' },
          serviceId: {
            type: 'string',
            description: 'Service id within the group; omit for all services combined',
          },
          lines: {
            type: 'number',
            description: 'How many recent lines to fetch per service (default 100, max 500)',
          },
          level: {
            type: 'string',
            enum: ['all', 'error', 'warn', 'info'],
            description: 'Only return lines classified at this severity (default all)',
          },
          contains: {
            type: 'string',
            description: 'Only return lines containing this substring (case-insensitive)',
          },
        },
        required: ['groupId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'describe_config',
      description: 'Return Muster config file paths and schema location',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
  ],
}));

const GroupIdSchema = z.object({ groupId: z.string().min(1) });

const LogsSchema = z.object({
  groupId: z.string().min(1),
  serviceId: z.string().min(1).optional(),
  lines: z.number().int().min(1).max(500).default(100),
  level: z.enum(['all', 'error', 'warn', 'info']).default('all'),
  contains: z.string().optional(),
});

server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_server_groups': {
        const result = await listServerGroups();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_group_status': {
        const { groupId } = GroupIdSchema.parse(args);
        const result = await getGroupStatus(groupId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'run_server_group': {
        const { groupId } = GroupIdSchema.parse(args);
        const result = await runServerGroup(groupId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'stop_server_group': {
        const { groupId } = GroupIdSchema.parse(args);
        const result = await stopServerGroup(groupId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'restart_server_group': {
        const { groupId } = GroupIdSchema.parse(args);
        const result = await restartServerGroup(groupId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_service_logs': {
        const { groupId, serviceId, lines, level, contains } = LogsSchema.parse(args);
        const result = await getFilteredServiceLogs(groupId, serviceId, lines, level, contains);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'describe_config': {
        const result = await describeConfig();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

server.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'muster/start',
      description: 'Start the dev stack group best suited for this workspace',
      arguments: [
        {
          name: 'groupId',
          description: 'Optional group id override',
          required: false,
        },
      ],
    },
    {
      name: 'muster/status',
      description: 'Show which Muster services are running',
      arguments: [],
    },
  ],
}));

server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'muster://config/workspace',
      name: 'Workspace Muster Config',
      description: 'Live workspace muster.json paths and merged groups summary',
      mimeType: 'application/json',
    },
  ],
}));

server.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'muster://config/workspace') {
    const [groups, describe] = await Promise.all([listServerGroups(), describeConfig()]);
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ groups, describe }, null, 2),
        },
      ],
    };
  }

  const logsMatch = uri.match(/^muster:\/\/logs\/([^/]+)\/([^/]+)$/);
  if (logsMatch) {
    const [, groupId, serviceId] = logsMatch;
    const logs = await getServiceLogs(groupId, serviceId);
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: JSON.stringify(logs, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

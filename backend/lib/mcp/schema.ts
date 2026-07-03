import { tool } from "ai";

import { executeTool } from "@/lib/mcp/executor";
import { getMcpClient } from "@/lib/mcp/client";
import { toolDefinitions } from "@/lib/mcp/definitions";

export function getAiToolSet() {
  return Object.fromEntries(
    Object.entries(toolDefinitions).map(([name, definition]) => [
      name,
      tool({
        description: definition.description,
        parameters: definition.schema,
        execute: async (args) => executeTool(name, args)
      })
    ])
  );
}

export async function getMcpSchemaResponse() {
  try {
    const client = await getMcpClient();
    const result = await client.listTools();
    return {
      source: "mcp",
      tools: result.tools
    };
  } catch (error) {
    return {
      source: "local-fallback",
      error: error instanceof Error ? error.message : "Unable to load MCP tools",
      tools: Object.entries(toolDefinitions).map(([name, definition]) => ({
        name,
        description: definition.description
      }))
    };
  }
}

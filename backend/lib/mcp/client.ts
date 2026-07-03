import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let sessionPromise: Promise<Client> | null = null;

export async function getMcpClient(): Promise<Client> {
  if (!sessionPromise) {
    sessionPromise = createMcpClient();
  }
  return sessionPromise;
}

async function createMcpClient() {
  const serverUrl = process.env.MCP_SERVER_URL ?? "https://mcp.kapruka.com/mcp";
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
  const client = new Client(
    { name: "bowie-agent", version: "0.1.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

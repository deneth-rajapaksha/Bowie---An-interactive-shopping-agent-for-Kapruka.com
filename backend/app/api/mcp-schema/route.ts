import { getMcpSchemaResponse } from "@/lib/mcp/schema";

export const runtime = "edge";

export async function GET() {
  return Response.json(await getMcpSchemaResponse(), {
    headers: {
      "Cache-Control": "public, max-age=86400, immutable"
    }
  });
}

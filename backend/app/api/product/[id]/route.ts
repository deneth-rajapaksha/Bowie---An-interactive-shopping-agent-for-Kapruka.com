import { executeTool } from "@/lib/mcp/executor";

export const runtime = "edge";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_req: Request, { params }: RouteContext) {
  const product = await executeTool("kapruka_get_product", {
    product_id: params.id,
    response_format: "json"
  });

  return Response.json(product, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=300"
    }
  });
}

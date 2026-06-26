import { isLangfuseEnabled } from "@/lib/observability/langfuse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    langfuseEnabled: isLangfuseEnabled(),
    publicKeyPresent: Boolean(process.env.LANGFUSE_PUBLIC_KEY),
    secretKeyPresent: Boolean(process.env.LANGFUSE_SECRET_KEY),
    baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com",
    environment: process.env.LANGFUSE_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    exportMode: process.env.LANGFUSE_EXPORT_MODE === "batched" ? "batched" : "immediate"
  });
}

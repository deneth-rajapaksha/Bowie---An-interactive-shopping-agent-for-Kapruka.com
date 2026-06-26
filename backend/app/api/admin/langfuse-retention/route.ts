import {
  getLangfuseClient,
  NORMAL_TRACE_TAG,
  NORMAL_TRACE_TTL_DAYS,
  traceHasUnsatisfiedFeedback
} from "@/lib/observability/langfuse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runRetentionCleanup(req);
}

export async function POST(req: Request) {
  return runRetentionCleanup(req);
}

async function runRetentionCleanup(req: Request) {
  const auth = req.headers.get("authorization");
  const url = new URL(req.url);
  const expected = process.env.BOWIE_RETENTION_CRON_SECRET ?? process.env.CRON_SECRET;

  if (expected && auth !== `Bearer ${expected}` && url.searchParams.get("secret") !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getLangfuseClient();
  if (!client) {
    return Response.json({ ok: false, error: "Langfuse is not configured" }, { status: 503 });
  }

  const cutoff = new Date(Date.now() - NORMAL_TRACE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const traces = await client.api.trace.list({
    tags: NORMAL_TRACE_TAG,
    toTimestamp: cutoff.toISOString(),
    limit: 100,
    fields: "core,scores"
  });

  const deletableTraceIds: string[] = [];
  const retainedTraceIds: string[] = [];

  for (const trace of traces.data) {
    if (await traceHasUnsatisfiedFeedback(trace.id)) {
      retainedTraceIds.push(trace.id);
    } else {
      deletableTraceIds.push(trace.id);
    }
  }

  if (deletableTraceIds.length > 0) {
    await client.api.trace.deleteMultiple({ traceIds: deletableTraceIds });
  }

  return Response.json({
    ok: true,
    cutoff: cutoff.toISOString(),
    deleted: deletableTraceIds,
    retainedForAdminReview: retainedTraceIds,
    hasMore: traces.meta.page < traces.meta.totalPages
  });
}

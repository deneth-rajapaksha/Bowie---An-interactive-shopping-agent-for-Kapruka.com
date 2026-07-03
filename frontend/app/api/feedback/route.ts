import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const endpoint = process.env.BOWIE_BACKEND_URL;
  const payload = await req.json();

  if (!endpoint) {
    return NextResponse.json({
      ok: true,
      stored: false,
      requiresReason: payload?.rating === "dislike" && !payload?.reason,
      prompt:
        payload?.rating === "dislike" && !payload?.reason
          ? "I am sorry that missed the mark. If possible, could you share what went wrong?"
          : undefined,
      skipped: "missing_BOWIE_BACKEND_URL"
    });
  }

  const backendFeedbackUrl = getBackendFeedbackUrl(endpoint);
  let response: Response;

  try {
    response = await fetch(backendFeedbackUrl, {
      method: "POST",
      headers: getBackendHeaders(),
      body: JSON.stringify(payload)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to reach backend feedback endpoint.",
        backendFeedbackUrl,
        detail: error instanceof Error ? error.message : "Unknown network error"
      },
      { status: 502 }
    );
  }

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return NextResponse.json(JSON.parse(rawBody), { status: response.status });
    } catch (error) {
      return NextResponse.json(
        {
          error: "Backend feedback endpoint returned invalid JSON.",
          backendFeedbackUrl,
          detail: error instanceof Error ? error.message : "Unable to parse backend JSON"
        },
        { status: 502 }
      );
    }
  }

  return NextResponse.json(
    {
      error: "Backend feedback endpoint returned a non-JSON response.",
      backendFeedbackUrl,
      contentType,
      detail: rawBody.slice(0, 1000)
    },
    { status: response.status || 502 }
  );
}

function getBackendFeedbackUrl(endpoint: string) {
  const normalized = endpoint.replace(/\/$/, "");
  if (normalized.endsWith("/api/feedback")) return normalized;
  if (normalized.endsWith("/api/chat")) return normalized.replace(/\/api\/chat$/, "/api/feedback");
  return `${normalized}/api/feedback`;
}

function getBackendHeaders() {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = process.env.BOWIE_API_SECRET?.trim();
  if (secret) headers.authorization = `Bearer ${secret}`;
  return headers;
}

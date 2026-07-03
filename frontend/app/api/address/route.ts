import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const endpoint = process.env.BOWIE_BACKEND_URL;

  if (!endpoint) {
    return NextResponse.json(
      { error: "Address lookup requires BOWIE_BACKEND_URL and a backend Google Places configuration." },
      { status: 501 }
    );
  }

  const backendAddressUrl = getBackendAddressUrl(endpoint);

  try {
    const response = await fetch(backendAddressUrl, {
      method: "POST",
      headers: getBackendHeaders(),
      body: JSON.stringify(body)
    });

    const payload = await response.text();
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Backend address lookup failed.",
          backendAddressUrl,
          detail: summarizeBackendError(payload, contentType, response.status)
        },
        { status: response.status }
      );
    }

    if (contentType.includes("application/json")) {
      return NextResponse.json(JSON.parse(payload));
    }

    return NextResponse.json({ error: "Backend returned a non-JSON address response." }, { status: 502 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to reach backend address lookup endpoint.",
        backendAddressUrl,
        detail: error instanceof Error ? error.message : "Unknown network error"
      },
      { status: 502 }
    );
  }
}

function getBackendAddressUrl(endpoint: string) {
  const normalized = endpoint.replace(/\/$/, "");
  if (normalized.endsWith("/api/chat")) return normalized.replace(/\/api\/chat$/, "/api/address");
  return normalized.endsWith("/api/address") ? normalized : `${normalized}/api/address`;
}

function getBackendHeaders() {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = process.env.BOWIE_API_SECRET?.trim();
  if (secret) headers.authorization = `Bearer ${secret}`;
  return headers;
}

function summarizeBackendError(rawBody: string, contentType: string, status: number) {
  if (!rawBody) return `Backend returned HTTP ${status}.`;

  if (contentType.includes("application/json")) {
    try {
      const payload = JSON.parse(rawBody) as { detail?: unknown; error?: unknown; message?: unknown };
      const detail = payload.detail || payload.error || payload.message;
      if (typeof detail === "string" && detail.trim()) return limitErrorText(detail);
    } catch {
      return limitErrorText(rawBody);
    }
  }

  return limitErrorText(
    rawBody
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function limitErrorText(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 400 ? `${clean.slice(0, 397).trim()}...` : clean;
}

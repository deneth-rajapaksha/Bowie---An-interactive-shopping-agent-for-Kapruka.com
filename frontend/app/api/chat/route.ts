import { NextResponse } from "next/server";
import { sampleCategories, sampleDelivery, sampleOrder, sampleProductDetail, sampleProducts, sampleTracking } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

type ChatRequest = {
  message?: string;
  messages?: Array<{ role: string; content: string }>;
  conversationId?: string;
  userId?: string;
  cart?: MockCartItem[];
  language?: "en" | "si" | "ta";
};

type MockCartItem = {
  product_id?: string;
  name?: string;
  quantity?: number;
  price?: number;
  currency?: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;
  const endpoint = process.env.BOWIE_BACKEND_URL;

  if (endpoint) {
    const backendChatUrl = getBackendChatUrl(endpoint);
    let response: Response;

    try {
      response = await fetch(backendChatUrl, {
        method: "POST",
        headers: getBackendHeaders(),
        body: JSON.stringify({
          messages: body.messages ?? [],
          responseFormat: "json",
          conversationId: body.conversationId,
          userId: body.userId,
          cart: body.cart,
          language: body.language
        })
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "Unable to reach backend chat endpoint.",
          backendChatUrl,
          detail: error instanceof Error ? error.message : "Unknown network error"
        },
        { status: 502 }
      );
    }

    if (!response.ok) {
      const detail = await response.text();
      const contentType = response.headers.get("content-type") || "";
      return NextResponse.json(
        {
          error: "Backend chat request failed.",
          backendChatUrl,
          detail: summarizeBackendError(detail, contentType, response.status)
        },
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type") || "";
    const rawBody = await response.text();

    if (contentType.includes("application/json")) {
      try {
        return NextResponse.json(JSON.parse(rawBody));
      } catch (error) {
        return NextResponse.json(
          {
            error: "Backend returned invalid JSON.",
            backendChatUrl,
            detail: error instanceof Error ? error.message : "Unable to parse backend JSON"
          },
          { status: 502 }
        );
      }
    }

    const streamedText = parseAiSdkDataStreamText(rawBody);
    if (streamedText) {
      return NextResponse.json({ text: streamedText, toolResults: [] });
    }

    return NextResponse.json(
      {
        error: "Backend returned a non-JSON response.",
        backendChatUrl,
        contentType,
        detail: summarizeBackendError(rawBody, contentType, 502)
      },
      { status: 502 }
    );
  }

  const latest = (body.message || body.messages?.at(-1)?.content || "").toLowerCase();
  const payload = mockReply(latest, Array.isArray(body.cart) ? body.cart : []);
  return NextResponse.json(payload);
}

function getBackendChatUrl(endpoint: string) {
  const normalized = endpoint.replace(/\/$/, "");
  return normalized.endsWith("/api/chat") ? normalized : `${normalized}/api/chat`;
}

function getBackendHeaders() {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = process.env.BOWIE_API_SECRET?.trim();
  if (secret) headers.authorization = `Bearer ${secret}`;
  return headers;
}

function parseAiSdkDataStreamText(rawBody: string) {
  return rawBody
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith("0:")) return "";

      try {
        const value = JSON.parse(line.slice(2));
        return typeof value === "string" ? value : "";
      } catch {
        return "";
      }
    })
    .join("")
    .trim();
}

function summarizeBackendError(rawBody: string, contentType: string, status: number) {
  if (!rawBody) return `Backend returned HTTP ${status}.`;

  if (contentType.includes("application/json")) {
    try {
      const payload = JSON.parse(rawBody) as { detail?: unknown; error?: unknown; message?: unknown };
      const detail = payload.detail || payload.error || payload.message;
      if (typeof detail === "string" && detail.trim()) return limitErrorText(detail);
    } catch {
      // Fall through to text extraction.
    }
  }

  const nextDataMatch = rawBody.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(unescapeHtml(nextDataMatch[1])) as {
        err?: { message?: string };
      };
      if (nextData.err?.message) return limitErrorText(nextData.err.message);
    } catch {
      // Fall through to HTML stripping.
    }
  }

  const text = rawBody
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return limitErrorText(text || `Backend returned HTTP ${status}.`);
}

function unescapeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function limitErrorText(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 400 ? `${clean.slice(0, 397).trim()}...` : clean;
}

function mockReply(message: string, cart: MockCartItem[]) {
  if (isCheckoutIntent(message)) {
    const itemLabel = cart.length
      ? `${cart.length} item${cart.length === 1 ? "" : "s"} from your cart`
      : "the selected item";

    return {
      text: `Great, I will use ${itemLabel} for checkout. I can create the Kapruka checkout once the recipient name, phone, delivery address, city, delivery date, and sender name are confirmed. <!--QUICK_REPLIES:["Add gift message","Change recipient","Confirm details"]-->`,
      toolResults: [{ name: "kapruka_create_order", result: sampleOrder }]
    };
  }

  if (isTrackingIntent(message)) {
    return {
      text: "I found the latest order status for you.",
      toolResults: [{ name: "kapruka_track_order", result: sampleTracking }],
      quickReplies: []
    };
  }

  if (message.includes("deliver") || message.includes("colombo")) {
    return {
      text: "Colombo delivery is available for the selected date. The flat delivery rate is shown below. <!--QUICK_REPLIES:[\"Proceed to checkout\",\"Change date\",\"Add another item\"]-->",
      toolResults: [{ name: "kapruka_check_delivery", result: sampleDelivery }]
    };
  }

  if (message.includes("category") || message.includes("browse")) {
    return {
      text: "Here are good Kapruka categories to start with. <!--QUICK_REPLIES:[\"Birthday gifts\",\"Flowers under 6000\",\"Chocolate gifts\"]-->",
      toolResults: [{ name: "kapruka_list_categories", result: { categories: sampleCategories } }]
    };
  }

  if (message.includes("details") || message.includes("view")) {
    return {
      text: "The Chocolate Ganache Birthday Cake is a strong pick for a family celebration. <!--QUICK_REPLIES:[\"Check delivery\",\"Add to cart\",\"See similar cakes\"]-->",
      toolResults: [{ name: "kapruka_get_product", result: sampleProductDetail }]
    };
  }

  return {
    text: "Lovely, I found a few giftable options. The chocolate cake is the safest birthday pick, and it pairs well with flowers, chocolates, or a soft toy if you want the gift to feel fuller. <!--QUICK_REPLIES:[\"View top result\",\"Check delivery to Colombo\",\"Browse categories\"]-->",
    toolResults: [{ name: "kapruka_search_products", result: { results: sampleProducts } }]
  };
}

function isCheckoutIntent(message: string) {
  return /\b(checkout|proceed|pay|place\s+order|create\s+order|confirm\s+order)\b/i.test(message);
}

function isTrackingIntent(message: string) {
  return /\b(track|tracking|order\s+status|where\s+is\s+my\s+order|order\s*(no|number|#))\b/i.test(message);
}

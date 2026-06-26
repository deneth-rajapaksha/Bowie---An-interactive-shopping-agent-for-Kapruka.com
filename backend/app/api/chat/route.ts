import { generateText, streamText, type CoreMessage } from "ai";

import { trimHistory } from "@/lib/ai/history";
import { getSystemPrompt } from "@/lib/ai/prompt";
import { getActiveModel, getProviderConfig } from "@/lib/ai/provider";
import { executeTool } from "@/lib/mcp/executor";
import { getAiToolSet } from "@/lib/mcp/schema";
import {
  getTraceRetentionExpiresAt,
  isLangfuseEnabled,
  NORMAL_TRACE_TAG,
  upsertLangfuseTrace
} from "@/lib/observability/langfuse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequest = {
  messages?: CoreMessage[];
  responseFormat?: "json" | "stream";
  conversationId?: string;
  userId?: string;
  cart?: CartItem[];
};

type CartItem = {
  product_id: string;
  name: string;
  price: number;
  currency: string;
  image_url?: string | null;
  quantity: number;
  icing_text?: string;
};

type ChatTrace = {
  traceId?: string;
  update(attributes: TraceAttributes): void;
  end(): Promise<void> | void;
};

type TraceAttributes = {
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  level?: string;
  statusMessage?: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const latestText = getLatestUserText(messages);
  const cart = Array.isArray(body.cart) ? body.cart.filter(isCartItem) : [];
  const messagesWithCart = appendCartContext(messages, cart);
  const providerConfig = getProviderConfig();
  const trimmedMessages = trimHistory(
    messagesWithCart,
    providerConfig.provider === "modal" ? 4 : 10,
    providerConfig.provider === "modal" ? 420 : 900
  );
  const conversationId = body.conversationId ?? crypto.randomUUID();
  const retentionExpiresAt = getTraceRetentionExpiresAt();
  const responseFormat = body.responseFormat ?? "json";

  const options = {
    model: getActiveModel(trimmedMessages.length, latestText, providerConfig),
    system: getSystemPrompt(),
    messages: trimmedMessages,
    tools: getAiToolSet(),
    maxSteps: 4,
    temperature: 0.4,
    experimental_telemetry: {
      isEnabled: isLangfuseEnabled(),
      functionId: "bowie-chat",
      metadata: {
        conversationId,
        provider: providerConfig.provider,
        fastModel: providerConfig.fastModel,
        smartModel: providerConfig.smartModel,
        retentionPolicy: "auto_delete_after_14_days",
        retentionExpiresAt
      }
    }
  };

  const runChatTurn = async (trace: ChatTrace) => {
    const headers = getTraceHeaders(conversationId, trace.traceId);
    trace.update({
      input: {
        latestUserText: latestText,
        messages: trimmedMessages
      },
      metadata: {
        conversationId,
        responseFormat,
        provider: providerConfig.provider,
        fastModel: providerConfig.fastModel,
        smartModel: providerConfig.smartModel,
        retentionPolicy: "auto_delete_after_14_days",
        retentionExpiresAt
      }
    });

    if (responseFormat === "json") {
      try {
        const paginationRequest = extractPaginationRequest(
          trimmedMessages,
          stripOperationalContext(latestText)
        );

        if (paginationRequest) {
          const paginatedSearch = await runPaginatedProductSearch(paginationRequest);
          const text = sanitizeAssistantText(paginatedSearch.text);
          const finalToolResults = [paginatedSearch.toolResult];

          trace.update({
            output: {
              text,
              toolResults: finalToolResults
            },
            metadata: {
              retentionExpiresAt
            }
          });
          trace.end();

          return Response.json(
            {
              text,
              toolResults: finalToolResults,
              conversationId,
              traceId: trace.traceId,
              feedback: trace.traceId ? getFeedbackInstructions() : undefined
            },
            { headers }
          );
        }

        const result = await generateText(options);
        const toolResults = result.toolResults.map((toolResult) => ({
          name: toolResult.toolName,
          result: toolResult.result
        }));
        const groundedSearch = await maybeRunGroundedProductSearch(
          trimmedMessages,
          toolResults,
          result.text
        );
        const text = sanitizeAssistantText(groundedSearch?.text ?? result.text);
        const finalToolResults = groundedSearch
          ? [...toolResults, groundedSearch.toolResult]
          : toolResults;

        trace.update({
          output: {
            text,
            toolResults: finalToolResults
          },
          metadata: {
            usage: result.usage,
            retentionExpiresAt
          }
        });
        trace.end();
        console.info("BowieAgent token usage", result.usage);

        return Response.json(
          {
            text,
            toolResults: finalToolResults,
            conversationId,
            traceId: trace.traceId,
            feedback: trace.traceId ? getFeedbackInstructions() : undefined
          },
          { headers }
        );
      } catch (error) {
        trace.update({
          level: "ERROR",
          statusMessage: error instanceof Error ? error.message : "Unknown error"
        });
        trace.end();
        const status = getErrorStatus(error);
        const detail = getErrorDetail(error);
        console.error("BowieAgent chat failed", getErrorLogSummary(error, detail, status));
        return Response.json(
          {
            error: "Chat request failed",
            detail,
            conversationId,
            traceId: trace.traceId
          },
          { status, headers }
        );
      }
    }

    try {
      const result = await streamText({
        ...options,
        onFinish({ usage, text }) {
          trace.update({
            output: { text },
            metadata: {
              usage,
              retentionExpiresAt
            }
          });
          trace.end();
          console.info("BowieAgent token usage", usage);
        }
      });

      return result.toDataStreamResponse({ headers });
    } catch (error) {
      trace.update({
        level: "ERROR",
        statusMessage: error instanceof Error ? error.message : "Unknown error"
      });
      trace.end();
      const status = getErrorStatus(error);
      const detail = getErrorDetail(error);
      console.error("BowieAgent stream failed", getErrorLogSummary(error, detail, status));
      return Response.json(
        {
          error: "Chat request failed",
          detail,
          conversationId,
          traceId: trace.traceId
        },
        { status, headers }
      );
    }
  };

  if (!isLangfuseEnabled()) {
    return runChatTurn(createNoopTrace());
  }

  return runChatTurn(
    createLangfuseTrace({
      traceId: crypto.randomUUID(),
      name: "bowie-chat-turn",
      sessionId: conversationId,
      userId: body.userId,
      tags: [NORMAL_TRACE_TAG]
    })
  );
}

function createNoopTrace(): ChatTrace {
  return {
    update() {},
    end() {}
  };
}

function createLangfuseTrace(params: {
  traceId: string;
  name: string;
  sessionId: string;
  userId?: string;
  tags: string[];
}): ChatTrace {
  let attributes: TraceAttributes = {};

  return {
    traceId: params.traceId,
    update(nextAttributes) {
      attributes = {
        ...attributes,
        ...nextAttributes,
        metadata: {
          ...(isRecord(attributes.metadata) ? attributes.metadata : {}),
          ...(isRecord(nextAttributes.metadata) ? nextAttributes.metadata : {})
        }
      };
    },
    async end() {
      try {
        await upsertLangfuseTrace({
          traceId: params.traceId,
          name: params.name,
          sessionId: params.sessionId,
          userId: params.userId,
          tags: params.tags,
          input: attributes.input,
          output: attributes.output,
          metadata: attributes.metadata,
          level: attributes.level,
          statusMessage: attributes.statusMessage
        });
      } catch (error) {
        console.error("Langfuse trace export failed", getErrorLogSummary(error, "Trace export failed", 500));
      }
    }
  };
}

function getTraceHeaders(conversationId: string, traceId?: string) {
  const headers: Record<string, string> = {
    "x-bowie-conversation-id": conversationId,
    "x-bowie-feedback-endpoint": "/api/feedback"
  };

  if (traceId) {
    headers["x-langfuse-trace-id"] = traceId;
  }

  return headers;
}

function getFeedbackInstructions() {
  return {
    endpoint: "/api/feedback",
    likePayload: {
      rating: "like",
      traceId: "<x-langfuse-trace-id>",
      conversationId: "<x-bowie-conversation-id>",
      messageId: "<assistant-message-id>"
    },
    dislikePayload: {
      rating: "dislike",
      traceId: "<x-langfuse-trace-id>",
      conversationId: "<x-bowie-conversation-id>",
      messageId: "<assistant-message-id>",
      reason: "optional on first click; required for admin email alert",
      conversation: "<full conversation snapshot>"
    }
  };
}

const PRODUCT_CONTEXT_COMMENT_REGEX = /<!--PRODUCT_CONTEXT:[\s\S]*?-->/g;
const CART_CONTEXT_COMMENT_REGEX = /<!--CART_CONTEXT:[\s\S]*?-->/g;
const PRODUCT_CONTEXT_CAPTURE_REGEX = /<!--PRODUCT_CONTEXT:\s*([\s\S]*?)-->/g;
const LEAKED_TOOL_CALL_BLOCK_REGEX = /<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi;
const DANGLING_TOOL_CALL_REGEX = /<tool_call\b[\s\S]*$/i;
const LEAKED_TOOL_JSON_REGEX =
  /\s*\{\s*"name"\s*:\s*"kapruka_[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}\s*/gi;
const LEAKED_PRODUCT_CONTEXT_REGEX =
  /\s*Product cards shown to the user:\s*(?:\[(?:search|card)\s+\d+\][\s\S]*?)(?=(?:Would you|Do you|Pick one|Tell me|I can|$))/i;

function sanitizeAssistantText(text: string) {
  const cleaned = text
    .replace(PRODUCT_CONTEXT_COMMENT_REGEX, "")
    .replace(CART_CONTEXT_COMMENT_REGEX, "")
    .replace(LEAKED_TOOL_CALL_BLOCK_REGEX, " ")
    .replace(DANGLING_TOOL_CALL_REGEX, " ")
    .replace(LEAKED_TOOL_JSON_REGEX, " ")
    .replace(LEAKED_PRODUCT_CONTEXT_REGEX, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned && /<tool_call\b|kapruka_/i.test(text)) {
    return "I had trouble completing that action cleanly. Please confirm the checkout details and I will try again.";
  }

  return cleaned;
}

function appendCartContext(messages: CoreMessage[], cart: CartItem[]) {
  if (!messages.length || !cart.length) return messages;

  const latestUserIndex = findLatestUserIndex(messages);
  if (latestUserIndex < 0) return messages;

  const cartContext = cart
    .map((item, index) => {
      const price = Number.isFinite(item.price) ? `${item.currency || "LKR"} ${item.price}` : "price unavailable";
      return `[cart ${index + 1}] product_id=${item.product_id}; name=${item.name}; quantity=${item.quantity}; unit_price=${price}`;
    })
    .join("\n");

  return messages.map<CoreMessage>((message, index) => {
    if (index !== latestUserIndex || message.role !== "user" || typeof message.content !== "string") {
      return message;
    }

    return {
      ...message,
      content: `${message.content}\n\n<!--CART_CONTEXT:\nCurrent cart items selected by the user:\n${cartContext}\nUse these as the checkout cart. Do not ask the user to select or add these products again.\n-->`
    };
  });
}

function findLatestUserIndex(messages: CoreMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }

  return -1;
}

function isCartItem(item: unknown): item is CartItem {
  if (!item || typeof item !== "object") return false;
  const data = item as CartItem;
  return (
    typeof data.product_id === "string" &&
    typeof data.name === "string" &&
    typeof data.quantity === "number" &&
    Number.isFinite(data.quantity)
  );
}

function stripOperationalContext(text: string) {
  return text.replace(PRODUCT_CONTEXT_COMMENT_REGEX, "").replace(CART_CONTEXT_COMMENT_REGEX, "").trim();
}

type ApiToolResult = {
  name: string;
  result: unknown;
};

const PRODUCT_QUERY_PATTERNS = [
  /\bear\s?phones?\b/i,
  /\bhead\s?phones?\b/i,
  /\bearbuds?\b/i,
  /\bbuds\b/i,
  /\bspeakers?\b/i,
  /\bchargers?\b/i,
  /\bcables?\b/i,
  /\bcakes?\b/i,
  /\bflowers?\b/i,
  /\bchocolates?\b/i,
  /\bperfumes?\b/i,
  /\bwatches?\b/i,
  /\btoys?\b/i,
  /\bgifts?\b/i
];

async function maybeRunGroundedProductSearch(
  messages: CoreMessage[],
  toolResults: ApiToolResult[],
  assistantText: string
) {
  const userText = messages
    .filter((message) => message.role === "user")
    .map(messageToText)
    .join("\n");
  const allUserText = stripOperationalContext(userText);
  const latestText = stripOperationalContext(getLatestUserText(messages));
  const priceRange = extractPriceRange(allUserText);
  const paginationRequest = extractPaginationRequest(messages, latestText);

  if (isCheckoutIntent(latestText)) return null;
  if (paginationRequest) {
    return runPaginatedProductSearch(paginationRequest);
  }
  if (hasSearchResults(toolResults) && !priceRange.max_price) return null;

  const query = extractProductQuery(`${latestText}\n${allUserText}`);

  if (!query || !looksLikeProductSearch(latestText, allUserText, assistantText, messages)) {
    return null;
  }

  const existingSearch = findSearchResult(toolResults);
  const filteredExistingSearch = existingSearch ? filterResultByPrice(existingSearch, priceRange) : null;
  const result =
    filteredExistingSearch && hasResults(filteredExistingSearch)
      ? { result: filteredExistingSearch, broadened: false }
      : await findGroundedProductResults(query, priceRange);

  if (hasResults(result.result)) {
    return {
      text:
        result.broadened
          ? `I could not find enough ${query} within that exact budget, so I broadened the live Kapruka search and found these options. Pick one to view details or add it to cart. <!--QUICK_REPLIES:["View top result","See similar","Try another budget"]-->`
          : `I found these ${query} options on Kapruka. The cards below are from the live product search, so you can view details or add one to cart. <!--QUICK_REPLIES:["View top result","See similar","Proceed to checkout"]-->`,
      toolResult: { name: "kapruka_search_products", result: result.result }
    };
  }

  return {
    text:
      `I checked the live Kapruka search for ${query} and related terms, but I could not find in-stock product cards to show right now. Delivery may still be available to Matale or Kandy, but I do not want to invent products. Try "headphones", "earbuds", or a higher budget. <!--QUICK_REPLIES:["Search headphones","Search earbuds","Increase budget"]-->`,
    toolResult: { name: "kapruka_search_products", result: { results: [] } }
  };
}

async function findGroundedProductResults(
  query: string,
  priceRange: { min_price?: number; max_price?: number }
) {
  const queries = getSearchQueries(query);
  const exactPriceQueries = priceRange.max_price
    ? queries.map((q) => ({ q, min_price: priceRange.min_price, max_price: priceRange.max_price }))
    : [];
  const broadQueries = queries.map((q) => ({ q }));

  for (const search of [...exactPriceQueries, ...broadQueries]) {
    const result = await executeTool("kapruka_search_products", {
      params: {
        ...search,
        limit: 6,
        currency: "LKR",
        in_stock_only: true,
        sort: "relevance",
        response_format: "json"
      }
    });

    if (hasResults(result)) {
      return {
        result,
        broadened: !("max_price" in search) && Boolean(priceRange.max_price)
      };
    }
  }

  return { result: { results: [] }, broadened: Boolean(priceRange.max_price) };
}

async function runPaginatedProductSearch(request: { query: string; cursor: string }) {
  const result = await executeTool("kapruka_search_products", {
    params: {
      q: request.query,
      limit: 6,
      cursor: request.cursor,
      currency: "LKR",
      in_stock_only: true,
      sort: "relevance",
      response_format: "json"
    }
  });

  return {
    text: hasResults(result)
      ? `I found more ${request.query} options on Kapruka. The cards below are from the live product search, so you can view details or add one to cart. <!--QUICK_REPLIES:["View top result","See similar","Proceed to checkout"]-->`
      : `I checked for more ${request.query} options, but I could not find another page of product cards right now. <!--QUICK_REPLIES:["Search again","Browse categories","Try another budget"]-->`,
    toolResult: { name: "kapruka_search_products", result }
  };
}

function hasSearchResults(toolResults: ApiToolResult[]) {
  return toolResults.some(
    (toolResult) => toolResult.name === "kapruka_search_products" && hasResults(toolResult.result)
  );
}

function findSearchResult(toolResults: ApiToolResult[]) {
  return toolResults.find((toolResult) => toolResult.name === "kapruka_search_products")?.result;
}

function hasResults(result: unknown) {
  if (!result || typeof result !== "object") return false;
  const data = result as { results?: unknown };
  return Array.isArray(data.results) && data.results.length > 0;
}

function extractPaginationRequest(messages: CoreMessage[], latestText: string) {
  if (!isProductPaginationIntent(latestText)) return null;

  const explicitCursor = latestText.match(/\busing\s+cursor\s+([A-Za-z0-9_-]+=*)/i)?.[1];
  const explicitQuery = extractProductQuery(latestText);

  if (explicitCursor && explicitQuery) {
    return { query: explicitQuery, cursor: explicitCursor };
  }

  const contexts = Array.from(
    messages
      .map(messageToText)
      .join("\n")
      .matchAll(PRODUCT_CONTEXT_CAPTURE_REGEX),
    (match) => match[1]
  );

  for (const context of contexts.reverse()) {
    const searchLines = context
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("[search "));

    for (const line of searchLines.reverse()) {
      const cursor = line.match(/\bnext_cursor=([^;\s]+)/)?.[1]?.trim();
      const contextQuery = line.match(/\bquery=([^;\n]*)/)?.[1]?.trim();

      if (cursor) {
        const query = explicitQuery || contextQuery;
        if (query) return { query, cursor };
      }
    }
  }

  return null;
}

function isProductPaginationIntent(text: string) {
  return (
    /\b(show|see|load|give|get)\s+more\b/i.test(text) &&
    /\b(products?|picks|options?|results?|items?)\b/i.test(text)
  );
}

function filterResultByPrice(
  result: unknown,
  priceRange: { min_price?: number; max_price?: number }
) {
  if (!priceRange.min_price && !priceRange.max_price) return result;
  if (!result || typeof result !== "object") return result;

  const data = result as { results?: Array<{ price?: { amount?: unknown } }> };
  if (!Array.isArray(data.results)) return result;

  const results = data.results.filter((product) => {
    const amount = Number(product.price?.amount);
    if (!Number.isFinite(amount)) return false;
    if (priceRange.min_price && amount < priceRange.min_price) return false;
    if (priceRange.max_price && amount > priceRange.max_price) return false;
    return true;
  });

  return { ...data, results };
}

function looksLikeProductSearch(
  latestText: string,
  allUserText: string,
  assistantText: string,
  messages: CoreMessage[]
) {
  if (isCheckoutIntent(latestText)) return false;
  if (PRODUCT_QUERY_PATTERNS.some((pattern) => pattern.test(latestText))) return true;
  if (isAffirmative(latestText) && priorAssistantAskedToSearch(messages)) return true;
  if (extractPriceRange(latestText).max_price && PRODUCT_QUERY_PATTERNS.some((pattern) => pattern.test(allUserText))) {
    return true;
  }
  if (mentionsFakeProducts(assistantText)) return true;
  if (!/\b(more options?|more valuable|valuable|higher|premium|show|find|search|look|increase|budget|collect|delivery|city)\b/i.test(latestText)) {
    return false;
  }
  return PRODUCT_QUERY_PATTERNS.some((pattern) => pattern.test(allUserText));
}

function isCheckoutIntent(text: string) {
  return /\b(check\s*out|checkout|proceed|pay|payment|place\s+order|create\s+order|complete\s+order)\b/i.test(
    text
  );
}

function getSearchQueries(query: string) {
  if (query === "earphones" || query === "earbuds" || query === "headphones") {
    return [
      "earphones",
      "earphone",
      "earbuds",
      "ear buds",
      "headphones",
      "bluetooth earphones",
      "wireless earphones"
    ];
  }

  if (query === "perfumes" || query === "perfume") {
    return [
      "perfume",
      "perfumes",
      "eau de parfum",
      "eau de toilette",
      "ladies perfume",
      "mens perfume",
      "fragrance"
    ];
  }

  return [query];
}

function extractProductQuery(text: string) {
  for (const pattern of PRODUCT_QUERY_PATTERNS) {
    const match = text.match(pattern);
    if (match) return normalizeProductQuery(match[0]);
  }

  return "";
}

function normalizeProductQuery(query: string) {
  const normalized = query.toLowerCase().replace(/\s+/g, "");
  if (normalized === "earphone" || normalized === "earphones") return "earphones";
  if (normalized === "headphone" || normalized === "headphones") return "headphones";
  if (normalized === "earbud" || normalized === "earbuds" || normalized === "buds") return "earbuds";
  if (normalized === "perfume" || normalized === "perfumes") return "perfumes";
  return query.toLowerCase();
}

function isAffirmative(text: string) {
  return /^(y|yes|yeah|yep|yup|ok|okay|sure|please|go ahead|proceed)\b/i.test(text.trim());
}

function priorAssistantAskedToSearch(messages: CoreMessage[]) {
  const previousAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!previousAssistant) return false;
  const text = messageToText(previousAssistant);
  return /\b(search|look for|looking for|proceed)\b/i.test(text);
}

function mentionsFakeProducts(text: string) {
  return /\bProduct\s+\d+\b/i.test(text) || /\bBrand\s+[A-Z]\b/i.test(text);
}

function extractPriceRange(text: string) {
  const explicitPrices = Array.from(text.matchAll(/(?:rs\.?\s*)?(\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:lkr|rs)?/gi))
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
  const shorthandPrices = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*k\b/gi))
    .map((match) => Number(match[1]) * 1000)
    .filter((value) => Number.isFinite(value) && value > 0);
  const prices = [...explicitPrices, ...shorthandPrices];

  if (!prices.length) return {};
  if (prices.length === 1) return { max_price: prices[0] };

  return {
    min_price: Math.min(...prices),
    max_price: Math.max(...prices)
  };
}

function messageToText(message: CoreMessage) {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";

  return message.content
    .map((part) => ("text" in part ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function getLatestUserText(messages: CoreMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  if (!latest) return "";
  if (typeof latest.content === "string") return latest.content;

  return latest.content
    .map((part) => ("text" in part ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function getErrorStatus(error: unknown) {
  if (error && typeof error === "object") {
    const maybeStatus = (error as { statusCode?: unknown }).statusCode;
    if (typeof maybeStatus === "number" && maybeStatus >= 400 && maybeStatus < 600) {
      return maybeStatus;
    }

    const maybeLastError = (error as { lastError?: { statusCode?: unknown } }).lastError;
    if (
      maybeLastError &&
      typeof maybeLastError.statusCode === "number" &&
      maybeLastError.statusCode >= 400 &&
      maybeLastError.statusCode < 600
    ) {
      return maybeLastError.statusCode;
    }
  }

  return 500;
}

function getErrorDetail(error: unknown) {
  if (error && typeof error === "object") {
    const responseBody = (error as { responseBody?: unknown }).responseBody;
    if (typeof responseBody === "string" && responseBody.trim()) {
      try {
        const parsed = JSON.parse(responseBody) as { message?: unknown; error?: unknown };
        const message = parsed.message || parsed.error;
        if (typeof message === "string" && message.trim()) return message;
      } catch {
        return responseBody.slice(0, 500);
      }
    }
  }

  return error instanceof Error ? error.message : "Unknown error";
}

function getErrorLogSummary(error: unknown, detail: string, status: number) {
  if (!error || typeof error !== "object") {
    return { status, detail, value: String(error) };
  }

  const data = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    statusCode?: unknown;
    url?: unknown;
    responseBody?: unknown;
  };

  return {
    status,
    detail,
    name: typeof data.name === "string" ? data.name : undefined,
    message: typeof data.message === "string" ? data.message : undefined,
    code: typeof data.code === "string" || typeof data.code === "number" ? data.code : undefined,
    statusCode: typeof data.statusCode === "number" ? data.statusCode : undefined,
    url: typeof data.url === "string" ? data.url : undefined,
    responseBody:
      typeof data.responseBody === "string" ? data.responseBody.slice(0, 1000) : undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

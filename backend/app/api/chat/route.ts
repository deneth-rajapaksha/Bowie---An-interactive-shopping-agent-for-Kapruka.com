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
import { requireBackendAccess } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRequest = {
  messages?: CoreMessage[];
  responseFormat?: "json" | "stream";
  conversationId?: string;
  userId?: string;
  cart?: CartItem[];
  language?: "en" | "si" | "ta";
};

type CartItem = {
  product_id: string;
  name: string;
  summary?: string;
  price: number;
  currency: string;
  image_url?: string | null;
  quantity: number;
  category?: string;
  url?: string;
  icing_text?: string;
};

type CheckoutDraft = {
  recipientName?: string;
  phone?: string;
  address?: string;
  city?: string;
  addressType?: string;
  locationType?: "house" | "office" | "other";
  deliveryDate?: string;
  senderName?: string;
  giftMessage?: string;
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
  const accessDenied = await requireBackendAccess(req, {
    route: "chat",
    requireSecretInProduction: true
  });
  if (accessDenied) return accessDenied;

  const body = (await req.json()) as ChatRequest;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const latestText = getLatestUserText(messages);
  const conversationId = body.conversationId ?? crypto.randomUUID();
  const cart = Array.isArray(body.cart) ? body.cart.filter(isCartItem) : [];

  const providerConfig = getProviderConfig();
  const checkoutDraft = extractCheckoutDraft(messages, cart);
  const messagesWithCart = appendConversationStateContext(
    appendCheckoutDraftContext(appendCartContext(messages, cart), checkoutDraft),
    buildConversationState({
      messages,
      cart,
      checkoutDraft,
      conversationId,
      language: body.language
    })
  );
  const trimmedMessages = trimHistory(
    messagesWithCart,
    providerConfig.provider === "modal" ? 4 : 10,
    providerConfig.provider === "modal" ? 420 : 900
  );
  const retentionExpiresAt = getTraceRetentionExpiresAt();
  const responseFormat = body.responseFormat ?? "json";
  const tools = getAiToolSet();
  const useLocalProductRouting = shouldUseLocalProductRouting(latestText, body.language);
  const forceProductSearchTool = useLocalProductRouting && shouldForceProductSearchTool(latestText);

  const options = {
    model: getActiveModel(trimmedMessages.length, latestText, providerConfig),
    system: getSystemPrompt(),
    messages: trimmedMessages,
    tools,
    maxSteps: 4,
    temperature: 0.4,
    experimental_prepareStep: async ({ stepNumber }: { stepNumber: number }) => {
      if (forceProductSearchTool && stepNumber === 0) {
        return {
          toolChoice: { type: "tool" as const, toolName: "kapruka_search_products" as const },
          experimental_activeTools: ["kapruka_search_products" as const]
        };
      }

      return undefined;
    },
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

        const productDetailRequest = extractProductDetailRequest(
          trimmedMessages,
          stripOperationalContext(latestText)
        );
        if (productDetailRequest) {
          const productDetail = await runDirectProductDetail(productDetailRequest);
          const text = sanitizeAssistantText(productDetail.text);
          const finalToolResults = [productDetail.toolResult];

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

        const directSearchRequest = useLocalProductRouting ? getDirectProductSearchRequest(latestText) : null;
        if (directSearchRequest) {
          const directSearch = await runDirectProductSearch(directSearchRequest);
          const text = sanitizeAssistantText(directSearch.text);
          const finalToolResults = [directSearch.toolResult];

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

        const checkoutStepResponse = getCheckoutStepResponse({
          latestText,
          cart,
          checkoutDraft,
          language: body.language
        });
        if (checkoutStepResponse) {
          const text = checkoutStepResponse.text;
          const finalToolResults: ApiToolResult[] = [];

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
        const groundedSearch = await maybeRunMissingProductSearch({
          latestText,
          messages: trimmedMessages,
          toolResults,
          assistantText: result.text,
          providerConfig
        });
        const finalToolResults = groundedSearch
          ? [...toolResults, groundedSearch.toolResult]
          : toolResults;
        const text = await normalizeToolBackedAssistantResponse({
          rawText: groundedSearch?.text ?? result.text,
          toolResults: finalToolResults,
          latestText,
          messages: trimmedMessages,
          providerConfig,
          language: body.language
        });

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
const CHECKOUT_DRAFT_CONTEXT_REGEX = /<!--CHECKOUT_DRAFT:[\s\S]*?-->/g;
const ADDRESS_CONFIRMED_CONTEXT_REGEX = /<!--ADDRESS_CONFIRMED:[\s\S]*?-->/g;
const CONVERSATION_STATE_CONTEXT_REGEX = /<!--CONVERSATION_STATE:[\s\S]*?-->/g;
const CHECKOUT_FLOW_MARKER_REGEX = /<!--CHECKOUT_[A-Z_]+-->/g;
const PRODUCT_CONTEXT_CAPTURE_REGEX = /<!--PRODUCT_CONTEXT:\s*([\s\S]*?)-->/g;
const ADDRESS_CONFIRMED_CAPTURE_REGEX = /<!--ADDRESS_CONFIRMED:\s*([\s\S]*?)-->/g;
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
    .replace(CHECKOUT_DRAFT_CONTEXT_REGEX, "")
    .replace(ADDRESS_CONFIRMED_CONTEXT_REGEX, "")
    .replace(CONVERSATION_STATE_CONTEXT_REGEX, "")
    .replace(CHECKOUT_FLOW_MARKER_REGEX, "")
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

type ToolBackedResponseInput = {
  rawText: string;
  toolResults: ApiToolResult[];
  latestText: string;
  messages: CoreMessage[];
  providerConfig: ReturnType<typeof getProviderConfig>;
  language?: ChatRequest["language"];
};

type StructuredAssistantResponse = {
  text: string;
  quickReplies?: string[];
};

const RENDERABLE_TOOL_NAMES = new Set([
  "kapruka_search_products",
  "kapruka_get_product",
  "kapruka_check_delivery",
  "kapruka_create_order",
  "kapruka_track_order",
  "kapruka_list_categories"
]);

async function normalizeToolBackedAssistantResponse({
  rawText,
  toolResults,
  latestText,
  messages,
  providerConfig,
  language
}: ToolBackedResponseInput) {
  const sanitized = sanitizeAssistantText(rawText);
  const renderableTools = toolResults.filter((toolResult) => RENDERABLE_TOOL_NAMES.has(toolResult.name));
  if (!renderableTools.length) return sanitized;

  const visibleLanguage = getVisibleLanguage(latestText, language);
  const fallback = fallbackStructuredToolText(renderableTools, visibleLanguage);

  try {
    const result = await generateText({
      model: getActiveModel(messages.length, latestText, providerConfig),
      system: `You convert an ecommerce assistant turn into a strict frontend render contract.

Return only JSON:
{
  "text": "one short user-facing sentence in the required response language",
  "quickReplies": ["short chip 1", "short chip 2", "short chip 3"]
}

Rules:
- Required response language: ${visibleLanguage}.
- Use this required language even if the latest user text, quick reply, product
  name, address, or checkout fragment is written in another language.
- For sinhala, write Sinhala script. For tamil, write Tamil script. For english,
  write English.
- The frontend will render cards/panels from tool results separately.
- Your JSON must not include product/card fields. Product data already lives in
  toolResults and must stay there: id/product_id, name, summary, description,
  price.amount, price.currency, image_url/images, category, url, in_stock, and
  next_cursor.
- If product tools were used, do not include product names, prices, IDs, numbered lists, bullets, or Markdown product options in text.
- If delivery/order/tracking/category tools were used, do not duplicate structured fields in prose.
- text should be short, natural, and point to the rendered cards/panel.
- quickReplies must be 0 to 3 short strings.
- No Markdown. No hidden comments. No extra keys.`,
      prompt: JSON.stringify({
        latestUserMessage: stripOperationalContext(latestText),
        requiredResponseLanguage: visibleLanguage,
        rawAssistantText: sanitized,
        toolSummary: renderableTools.map((toolResult) => ({
          name: toolResult.name,
          summary: summarizeToolResultForContract(toolResult)
        }))
      }),
      temperature: 0
    });

    const structured = parseStructuredAssistantResponse(result.text);
    if (!structured?.text) return fallback;

    return withQuickReplies(
      sanitizeAssistantText(structured.text),
      Array.isArray(structured.quickReplies) ? structured.quickReplies : []
    );
  } catch (error) {
    console.error("Structured response normalization failed", getErrorLogSummary(error, getErrorDetail(error), getErrorStatus(error)));
    return fallback;
  }
}

function parseStructuredAssistantResponse(text: string): StructuredAssistantResponse | null {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : cleaned) as Partial<StructuredAssistantResponse>;
    const responseText = typeof parsed.text === "string" ? parsed.text.trim() : "";
    const quickReplies = Array.isArray(parsed.quickReplies)
      ? parsed.quickReplies.filter((chip): chip is string => typeof chip === "string" && chip.trim().length > 0).slice(0, 3)
      : [];

    return responseText ? { text: responseText, quickReplies } : null;
  } catch {
    return null;
  }
}

function withQuickReplies(text: string, quickReplies: string[]) {
  const clean = text.trim();
  if (!quickReplies.length) return clean;
  return `${clean} <!--QUICK_REPLIES:${JSON.stringify(quickReplies)}-->`;
}

function fallbackStructuredToolText(toolResults: ApiToolResult[], language: VisibleLanguage) {
  const primaryTool = toolResults[0]?.name;
  const text = fallbackToolText(primaryTool, language);
  return withQuickReplies(text, fallbackQuickReplies(primaryTool, language));
}

type VisibleLanguage = "english" | "sinhala" | "tamil";

function getVisibleLanguage(text: string, language: ChatRequest["language"]): VisibleLanguage {
  if (language === "si") return "sinhala";
  if (language === "ta") return "tamil";
  return detectVisibleLanguage(text);
}

function detectVisibleLanguage(text: string): VisibleLanguage {
  const sinhalaCount = Array.from(text.matchAll(/[\u0D80-\u0DFF]/g)).length;
  const tamilCount = Array.from(text.matchAll(/[\u0B80-\u0BFF]/g)).length;
  if (sinhalaCount || tamilCount) return sinhalaCount >= tamilCount ? "sinhala" : "tamil";
  return "english";
}

function fallbackToolText(toolName: string | undefined, language: VisibleLanguage) {
  const copy = {
    english: {
      products: "I found matching options. Pick a card to view details or add it to cart.",
      detail: "Here are the product details.",
      delivery: "I checked delivery for you.",
      order: "Your checkout summary is ready.",
      tracking: "I found the latest order status.",
      categories: "Here are categories you can browse.",
      generic: "I found the latest Kapruka result for you."
    },
    sinhala: {
      products: "ගැලපෙන options ටිකක් හම්බුණා. Details බලන්න හෝ cart එකට add කරන්න card එකක් තෝරන්න.",
      detail: "මෙන්න product details.",
      delivery: "ඔයා වෙනුවෙන් delivery details check කළා.",
      order: "ඔයාගේ checkout summary එක ready.",
      tracking: "Order එකේ latest status එක හම්බුණා.",
      categories: "Browse කරන්න පුළුවන් categories මෙන්න.",
      generic: "Kapruka එකෙන් latest result එක හම්බුණා."
    },
    tamil: {
      products: "பொருந்தும் options கிடைத்திருக்கிறது. Details பார்க்க அல்லது cart-க்கு add செய்ய card ஒன்றைத் தேர்ந்தெடுக்கவும்.",
      detail: "Product details இதோ.",
      delivery: "உங்களுக்காக delivery details check செய்தேன்.",
      order: "உங்கள் checkout summary ready.",
      tracking: "Order-இன் latest status கிடைத்தது.",
      categories: "Browse செய்யக்கூடிய categories இதோ.",
      generic: "Kapruka-வில் latest result கிடைத்தது."
    }
  }[language];

  switch (toolName) {
    case "kapruka_search_products":
      return copy.products;
    case "kapruka_get_product":
      return copy.detail;
    case "kapruka_check_delivery":
      return copy.delivery;
    case "kapruka_create_order":
      return copy.order;
    case "kapruka_track_order":
      return copy.tracking;
    case "kapruka_list_categories":
      return copy.categories;
    default:
      return copy.generic;
  }
}

function fallbackQuickReplies(toolName: string | undefined, language: VisibleLanguage) {
  const replies = {
    english: {
      products: ["View top result", "See similar", "Proceed to checkout"],
      detail: ["Add to cart", "Check delivery", "See similar"],
      delivery: ["Proceed to checkout", "Change date", "Add another item"],
      categories: ["Birthday gifts", "Flowers", "Cakes"],
      generic: ["Browse categories", "Search again", "Proceed to checkout"]
    },
    sinhala: {
      products: ["Top result බලන්න", "Similar බලන්න", "Checkout යන්න"],
      detail: ["Cart එකට add කරන්න", "Delivery check කරන්න", "Similar බලන්න"],
      delivery: ["Checkout යන්න", "Date වෙනස් කරන්න", "තව item එකක් add කරන්න"],
      categories: ["Birthday gifts", "මල්", "කේක්"],
      generic: ["Categories බලන්න", "ආයෙ search කරන්න", "Checkout යන්න"]
    },
    tamil: {
      products: ["Top result பார்க்க", "Similar பார்க்க", "Checkout போக"],
      detail: ["Cart-க்கு add செய்ய", "Delivery check செய்ய", "Similar பார்க்க"],
      delivery: ["Checkout போக", "Date மாற்ற", "இன்னொரு item add செய்ய"],
      categories: ["Birthday gifts", "மலர்கள்", "கேக்"],
      generic: ["Categories பார்க்க", "மீண்டும் search செய்ய", "Checkout போக"]
    }
  }[language];

  switch (toolName) {
    case "kapruka_search_products":
      return replies.products;
    case "kapruka_get_product":
      return replies.detail;
    case "kapruka_check_delivery":
      return replies.delivery;
    case "kapruka_list_categories":
      return replies.categories;
    default:
      return replies.generic;
  }
}

function summarizeToolResultForContract(toolResult: ApiToolResult) {
  const data = typeof toolResult.result === "object" && toolResult.result ? toolResult.result as Record<string, unknown> : {};

  if (toolResult.name === "kapruka_search_products") {
    const results = Array.isArray(data.results) ? data.results : [];
    return {
      count: results.length,
      query: data.query || (isRecord(data.applied_filters) ? data.applied_filters.q : undefined)
    };
  }

  if (toolResult.name === "kapruka_get_product") {
    return { hasProduct: Boolean(data.id || data.product_id || data.name) };
  }

  return { hasResult: Boolean(toolResult.result) };
}

function appendCartContext(messages: CoreMessage[], cart: CartItem[]) {
  if (!messages.length || !cart.length) return messages;

  const latestUserIndex = findLatestUserIndex(messages);
  if (latestUserIndex < 0) return messages;

  const cartContext = cart
    .map((item, index) => {
      const price = Number.isFinite(item.price) ? `${item.currency || "LKR"} ${item.price}` : "price unavailable";
      return `[cart ${index + 1}] product_id=${item.product_id}; name=${item.name}; quantity=${item.quantity}; unit_price=${price}; category=${
        item.category || ""
      }; summary=${item.summary || ""}; url=${item.url || ""}`;
    })
    .join("\n");

  return messages.map<CoreMessage>((message, index) => {
    if (index !== latestUserIndex || message.role !== "user" || typeof message.content !== "string") {
      return message;
    }

    return {
      ...message,
      content: `${message.content}\n\n<!--CART_CONTEXT:\nCurrent cart items selected by the user:\n${cartContext}\nUse these as the checkout cart. Do not ask the user to select or add these products again. If the user says proceed, proceed checkout, checkout, pay, place order, or confirm order, continue toward kapruka_create_order with these cart items. Do not use kapruka_track_order for checkout; only use it when the user wants the status of an existing placed order.\n-->`
    };
  });
}

function appendCheckoutDraftContext(messages: CoreMessage[], draft: CheckoutDraft | null) {
  if (!messages.length || !draft || !hasCheckoutDraftData(draft)) return messages;

  const latestUserIndex = findLatestUserIndex(messages);
  if (latestUserIndex < 0) return messages;

  const lines = checkoutDraftToLines(draft);
  const missing = getMissingCheckoutFields(draft).join(", ") || "none";

  return messages.map<CoreMessage>((message, index) => {
    if (index !== latestUserIndex || message.role !== "user" || typeof message.content !== "string") {
      return message;
    }

    return {
      ...message,
      content: `${message.content}\n\n<!--CHECKOUT_DRAFT:\nCollected checkout details parsed from the conversation:\n${lines.join(
        "\n"
      )}\nMissing checkout fields: ${missing}.\nUse this as the current checkout draft. Do not ask again for fields marked present. If a delivery city is unavailable or unclear, keep every other collected field and ask only for a replacement city/location. Normalize address type synonyms for tools: Home/House -> house, Office -> office, Apartment/Other -> other.\n-->`
    };
  });
}

type ConversationStateInput = {
  messages: CoreMessage[];
  cart: CartItem[];
  checkoutDraft: CheckoutDraft | null;
  conversationId: string;
  language?: ChatRequest["language"];
};

type CheckoutStepInput = {
  latestText: string;
  cart: CartItem[];
  checkoutDraft: CheckoutDraft | null;
  language?: ChatRequest["language"];
};

function getCheckoutStepResponse({ latestText, cart, checkoutDraft, language }: CheckoutStepInput) {
  if (!cart.length) return null;

  const missing = checkoutDraft ? getMissingCheckoutFields(checkoutDraft) : getMissingCheckoutFields({});
  const hasAddress = Boolean(checkoutDraft?.address);
  const isLocalized = language === "si" || language === "ta";

  if (isCheckoutIntent(latestText) && !hasAddress) {
    return { text: getAddressOnlyPrompt(language) };
  }

  if (isLocalized && isConfirmedAddressMessage(latestText) && missing.some((field) => field !== "delivery.address" && field !== "delivery.city")) {
    return { text: getRemainingCheckoutDetailsPrompt(language, checkoutDraft) };
  }

  return null;
}

function getAddressOnlyPrompt(language: ChatRequest["language"]) {
  if (language === "ta") {
    return "உங்கள் ஆர்டரை மூன்று படிகளில் முடிக்கத் தயாராக உள்ளேன். முதலில், உங்கள் விநியோக முகவரியை உறுதிப்படுத்துவோம்! தயவுசெய்து உங்கள் முகவரியை எனக்கு அனுப்புங்கள். ஆங்கிலத்தில் அல்லது ஆங்கில எழுத்துக்களில் முகவரியை அனுப்பினால், அடுத்தடுத்த படிகளைச் செய்வதற்கு வசதியாக இருக்கும் <!--CHECKOUT_ADDRESS_REQUESTED--> <!--QUICK_REPLIES:[\"முகவரி அனுப்பு\",\"English letters\",\"பின்னர் அனுப்புகிறேன்\"]-->";
  }

  if (language === "si") {
    return "ඔබගේ ඇනවුම පියවර තුනකින් සම්පූර්න කිරීමට සුදානම්. මුලින්ම ඇනවුම ලැබිය යුතු ලිපිනය තහවුරු කරගෙන ඉමු! මට ඔයාගේ ලිපිනය එවන්න. කරුණාකර ඉංග්‍රීසි භාෂාවෙන් හෝ ඉංග්‍රීසී අකුරෙන් ලිපිනය එවන්න පුලුවන් නම් ඉතිරි පියවර වලට ලෙහෙසියි <!--CHECKOUT_ADDRESS_REQUESTED--> <!--QUICK_REPLIES:[\"ලිපිනය එවන්න\",\"English letters\",\"පස්සේ එවන්නම්\"]-->";
  }

  return "Great, I can help checkout this order. Please send the delivery details in one message:\n\nDelivery Address:\n\nLocation Type (House/Office/Other):\n\nDelivery Date:\n\nRecipient's Phone Number:\n\nOrder recipient or order sender name:\n\nGift Message (if any):\n\nI will confirm everything with you before creating the checkout link. <!--QUICK_REPLIES:[\"Send details\",\"Use house\",\"Add gift message\"]-->";
}

function getRemainingCheckoutDetailsPrompt(language: ChatRequest["language"], draft: CheckoutDraft | null) {
  const addressLine = draft?.address ? `\n\nConfirmed delivery address:\n${draft.address}${draft.city ? `, ${draft.city}` : ""}` : "";
  const cityLineSi = draft?.city ? "" : "\n\nඩිලිවරි නගරය:";
  const cityLineTa = draft?.city ? "" : "\n\nடெலிவரி நகரம்:";

  if (language === "ta") {
    return `முகவரி உறுதியாகிவிட்டது.${addressLine}\n\nஇப்போது மீதமுள்ள விவரங்களை ஒரே message-ல் அனுப்புங்கள்:${cityLineTa}\n\nஇட வகை (House / Office / Other):\n\nடெலிவரி தேதி:\n\nஆர்டர் பெறுபவரின் தொலைபேசி எண்:\n\nஆர்டர் செய்பவர் அல்லது ஆர்டர் பெறுபவரின் பெயர்:\n\nGift Message இருந்தால்:\n\nஇந்த விவரங்கள் கிடைத்ததும் எல்லாவற்றையும் சேர்த்து checkout உருவாக்குகிறேன். <!--CHECKOUT_DETAILS_REQUESTED--> <!--QUICK_REPLIES:[\"House\",\"Office\",\"Other\"]-->`;
  }

  return `ලිපිනය තහවුරු වුණා.${addressLine}\n\nදැන් ඉතිරි විස්තර ටික එකම message එකකින් එවන්න:${cityLineSi}\n\nලිපිනයේ වර්ගය (House / Office / Other):\n\nඩිලිවරි අවශ්‍ය දිනය (Date):\n\nඇනවුම ලබන්නාගේ දුරකථන අංකය:\n\nඇනවුම් කරන්නාගේ හෝ ඇනවුම ලබන්නාගේ නම:\n\nGift Message එකක් ඇතුළත් කරන්න අවශ්‍ය නම්:\n\nමේ ටික ලැබුණු ගමන් සියල්ල එකතු කරලා checkout එක හදන්නම්. <!--CHECKOUT_DETAILS_REQUESTED--> <!--QUICK_REPLIES:[\"House\",\"Office\",\"Other\"]-->`;
}

function appendConversationStateContext(messages: CoreMessage[], state: string) {
  if (!messages.length || !state) return messages;

  const latestUserIndex = findLatestUserIndex(messages);
  if (latestUserIndex < 0) return messages;

  return messages.map<CoreMessage>((message, index) => {
    if (index !== latestUserIndex || message.role !== "user" || typeof message.content !== "string") {
      return message;
    }

    return {
      ...message,
      content: `${message.content}\n\n<!--CONVERSATION_STATE:\n${state}\n-->`
    };
  });
}

function buildConversationState({ messages, cart, checkoutDraft, conversationId, language }: ConversationStateInput) {
  const recentTurns = messages
    .slice(-8)
    .map((message) => `${message.role}: ${truncateStateLine(stripOperationalContext(messageToText(message)), 180)}`)
    .filter((line) => !/:\s*$/.test(line));
  const latestProductContext = getLatestCapturedContext(messages, PRODUCT_CONTEXT_CAPTURE_REGEX);
  const latestAddressContext = getLatestCapturedContext(messages, ADDRESS_CONFIRMED_CAPTURE_REGEX);
  const cartLines = cart.map((item, index) => {
    const price = Number.isFinite(item.price) ? `${item.currency || "LKR"} ${item.price}` : "price unavailable";
    return `[cart ${index + 1}] product_id=${item.product_id}; name=${item.name}; quantity=${item.quantity}; unit_price=${price}`;
  });
  const checkoutLines = checkoutDraft ? checkoutDraftToLines(checkoutDraft) : [];

  return [
    `conversation.id=${conversationId}`,
    `ui.language=${language || "unknown"}`,
    "Use this state as durable memory when older turns are trimmed. The latest user message remains the active instruction.",
    "Recent visible turns:",
    ...(recentTurns.length ? recentTurns : ["none"]),
    "Current cart:",
    ...(cartLines.length ? cartLines : ["empty"]),
    "Checkout draft:",
    ...(checkoutLines.length ? checkoutLines : ["none"]),
    "Latest product cards context:",
    latestProductContext ? truncateStateBlock(latestProductContext, 1600) : "none",
    "Latest confirmed address:",
    latestAddressContext ? truncateStateBlock(latestAddressContext, 600) : "none"
  ].join("\n");
}

function getLatestCapturedContext(messages: CoreMessage[], regex: RegExp) {
  const matches = Array.from(messages.map(messageToText).join("\n").matchAll(regex), (match) => match[1]?.trim() || "");
  return matches.reverse().find(Boolean) || "";
}

function truncateStateLine(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1).trim()}...`;
}

function truncateStateBlock(value: string, maxLength: number) {
  const cleaned = value.trim();
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 1).trim()}...`;
}

function extractCheckoutDraft(messages: CoreMessage[], cart: CartItem[]): CheckoutDraft | null {
  if (!cart.length) return null;

  const draft: CheckoutDraft = {};
  let awaitingCityClarification = false;

  for (const message of messages) {
    const text = stripOperationalContext(messageToText(message));
    if (!text) continue;

    if (message.role === "assistant") {
      awaitingCityClarification = isCityClarificationPrompt(text);
      continue;
    }

    if (message.role !== "user") continue;

    if (awaitingCityClarification) {
      const city = extractCityCorrection(text);
      if (city) draft.city = city;
      awaitingCityClarification = false;
    }

    const parsed = parseCheckoutDetails(text);
    if (containsLocalizedScript(text) && !isConfirmedAddressMessage(messageToText(message))) {
      delete parsed.address;
      delete parsed.city;
    }
    mergeCheckoutDraft(draft, parsed);
  }

  return hasCheckoutDraftData(draft) ? draft : null;
}

function mergeCheckoutDraft(target: CheckoutDraft, source: CheckoutDraft) {
  for (const [key, value] of Object.entries(source) as Array<[keyof CheckoutDraft, CheckoutDraft[keyof CheckoutDraft]]>) {
    if (value) {
      target[key] = value as never;
    }
  }
}

function parseCheckoutDetails(text: string): CheckoutDraft {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const draft: CheckoutDraft = {};
  const deliveryDate = extractDeliveryDate(normalizedText);
  const phoneMatch = normalizedText.match(/\b(?:\+94|0)\d[\d\s-]{7,11}\b/);
  const phone = phoneMatch?.[0]?.replace(/[\s-]/g, "");
  const addressType = extractAddressType(normalizedText);
  const labeled = parseLabeledCheckoutDetails(normalizedText);
  const messageMatch = normalizedText.match(giftMessageRegex());

  if (deliveryDate) draft.deliveryDate = deliveryDate;
  if (phone) draft.phone = phone;
  if (addressType) {
    draft.addressType = addressType.raw;
    draft.locationType = addressType.normalized;
  }
  mergeCheckoutDraft(draft, labeled);
  if (messageMatch?.[1]) draft.giftMessage = cleanCheckoutValue(messageMatch[1]);

  const sender = extractSenderName(normalizedText, phoneMatch?.[0]);
  if (sender) draft.senderName = sender;

  const beforeDate = deliveryDate
    ? normalizedText.slice(0, Math.max(0, normalizedText.search(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/))).trim()
    : normalizedText;
  if (!draft.recipientName || !draft.address || !draft.city) {
    const recipientAndAddress = parseRecipientAndAddress(cleanCheckoutTextForFallback(beforeDate, {
      addressType: addressType?.raw,
      phone: phoneMatch?.[0],
      giftMessage: draft.giftMessage
    }), addressType?.raw);
    if (!draft.recipientName && recipientAndAddress.recipientName) draft.recipientName = recipientAndAddress.recipientName;
    if (!draft.address && recipientAndAddress.address) draft.address = recipientAndAddress.address;
    if (!draft.city && recipientAndAddress.city) draft.city = recipientAndAddress.city;
  }

  return draft;
}

const CHECKOUT_LABELS_PATTERN =
  "recipient(?:'s)?\\s+name|recipient|delivery\\s+address|address\\s+type|location\\s+type|address|delivery\\s+city|city|delivery\\s+date|date|recipient(?:'s)?\\s+phone(?:\\s+number)?|phone(?:\\s+number)?|number|sender\\s+name|your\\s+name|sender|gift\\s+message|msg|message|messe?ge|masse?ge|massage";

function parseLabeledCheckoutDetails(text: string): CheckoutDraft {
  const draft: CheckoutDraft = {};
  const recipientName = extractLabeledValue(text, "recipient(?:'s)?\\s+name|recipient");
  const ambiguousName = extractLabeledValue(text, "name");
  const senderName = extractLabeledValue(text, "sender\\s+name|your\\s+name|sender");
  const address = extractLabeledValue(text, "delivery\\s+address|address");
  const city = extractLabeledValue(text, "delivery\\s+city|city");
  const deliveryDate = extractLabeledValue(text, "delivery\\s+date|date");
  const phone = extractLabeledValue(text, "recipient(?:'s)?\\s+phone(?:\\s+number)?|phone(?:\\s+number)?|number");
  const giftMessage = extractLabeledValue(text, "gift\\s+message|msg|message|messe?ge|masse?ge|massage");

  if (recipientName || ambiguousName) draft.recipientName = recipientName || ambiguousName;
  if (senderName) draft.senderName = senderName;
  if (deliveryDate) draft.deliveryDate = extractDeliveryDate(deliveryDate) || deliveryDate;
  if (phone) {
    const phoneMatch = phone.match(/\b(?:\+94|0)\d[\d\s-]{7,11}\b/);
    if (phoneMatch?.[0]) draft.phone = phoneMatch[0].replace(/[\s-]/g, "");
  }
  if (giftMessage) draft.giftMessage = giftMessage;

  if (address) {
    if (city) {
      draft.address = address;
    } else {
      const addressParts = splitAddressAndCity(address);
      draft.address = addressParts.address;
      if (addressParts.city) draft.city = addressParts.city;
    }
  }
  if (city) draft.city = normalizeCityName(city);

  return draft;
}

function extractLabeledValue(text: string, labelPattern: string) {
  const regex = new RegExp(
    `\\b(?:${labelPattern})\\b\\s*(?:\\([^)]*\\))?\\s*[:=-]?\\s*([\\s\\S]*?)(?=(?:\\s*[,/;]\\s*)?\\b(?:${CHECKOUT_LABELS_PATTERN})\\b\\s*(?:\\([^)]*\\))?\\s*[:=-]?|$)`,
    "i"
  );
  const match = text.match(regex);
  return match?.[1] ? cleanCheckoutValue(match[1]) : undefined;
}

function splitAddressAndCity(value: string) {
  const parts = value
    .split(",")
    .map((part) => cleanCheckoutValue(part))
    .filter(Boolean);

  if (parts.length < 2) return { address: value };

  return {
    address: parts.slice(0, -1).join(", "),
    city: normalizeCityName(parts.at(-1) || "")
  };
}

function giftMessageRegex() {
  return /\b(?:gift\s*message|msg|message|messe?ge|masse?ge|massage)\b\s*[-:=]?\s*(.+)$/i;
}

function cleanCheckoutValue(value: string) {
  return value.replace(/^[,./\s-]+|[,./\s-]+$/g, "").replace(/\s+/g, " ").trim();
}

function cleanCheckoutTextForFallback(
  text: string,
  known: { addressType?: string; phone?: string; giftMessage?: string }
) {
  let cleaned = text.replace(giftMessageRegex(), " ");
  if (known.phone) cleaned = cleaned.replace(known.phone, " ");
  if (known.addressType) cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(known.addressType)}\\b`, "i"), " ");
  if (known.giftMessage) cleaned = cleaned.replace(known.giftMessage, " ");

  return cleaned
    .replace(/\b(?:address\s+type|location\s+type|phone(?:\s+number)?|number|gift\s+message|msg|message|messe?ge|masse?ge|massage)\b\s*[:=-]?/gi, " ")
    .replace(/\s+[\/;]\s+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/[,.\s-]+$/g, "")
    .trim();
}

function extractDeliveryDate(text: string) {
  const match = text.match(/\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (!match) return undefined;

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function extractAddressType(text: string) {
  const match = text.match(/\b(home|house|office|apartment|other)\b/i);
  if (!match) return undefined;

  const raw = match[1];
  const lower = raw.toLowerCase();
  const normalized = lower === "office" ? "office" : lower === "home" || lower === "house" ? "house" : "other";
  return { raw, normalized: normalized as CheckoutDraft["locationType"] };
}

function extractSenderName(text: string, rawPhone?: string) {
  if (!rawPhone) return undefined;

  const phoneIndex = text.indexOf(rawPhone);
  if (phoneIndex < 0) return undefined;

  const afterPhone = text.slice(phoneIndex + rawPhone.length).trim();
  const sender = afterPhone
    .replace(/\b(?:sender|name)\b\s*[-:]?/gi, "")
    .replace(giftMessageRegex(), "")
    .replace(/^[,.\s-]+|[,.\s-]+$/g, "")
    .trim();

  return sender || undefined;
}

function parseRecipientAndAddress(text: string, addressType?: string) {
  const result: Pick<CheckoutDraft, "recipientName" | "address" | "city"> = {};
  const cleaned = addressType ? text.replace(new RegExp(`\\b${escapeRegExp(addressType)}\\b`, "i"), "").trim() : text;
  const parts = cleaned
    .split(",")
    .map((part) => cleanCheckoutValue(part))
    .filter(Boolean);

  if (parts.length >= 2) {
    result.recipientName = removeCheckoutLabelPrefix(parts[0]);
    const addressParts = parts.slice(1);
    result.address = addressParts.slice(0, -1).join(", ") || addressParts.join(", ");
    result.city = normalizeCityName(addressParts.at(-1) || "");
  }

  return result;
}

function removeCheckoutLabelPrefix(value: string) {
  return value.replace(/^\b(?:recipient(?:'s)?\s+name|recipient|name)\b\s*[:=-]?\s*/i, "").trim();
}

function isCityClarificationPrompt(text: string) {
  return (
    /\b(city|location|deliverable|delivery|Colombo|Kandy)\b/i.test(text) ||
    /නගර|ප්‍රදේශ|ඩිලිවරි|හඳුනාගත|හැකියාවක් නැහැ|ලඟම/.test(text)
  );
}

function extractCityCorrection(text: string) {
  const cleaned = text.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 40) return undefined;
  if (/\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(cleaned)) return undefined;
  if (/\b(?:home|house|office|apartment|other|msg|message)\b/i.test(cleaned)) return undefined;
  return normalizeCityName(cleaned);
}

function normalizeCityName(city: string) {
  const cleaned = city.replace(/^[.\s]+|[.\s]+$/g, "").trim();
  if (!cleaned) return undefined;

  const lower = cleaned.toLowerCase();
  if (/^(කොළඹ|colombo)(?:\s*\d+)?$/i.test(cleaned)) return lower.startsWith("colombo") ? titleCaseCity(cleaned) : "Colombo";
  if (/^(මහනුවර|kandy)$/i.test(cleaned)) return "Kandy";
  return titleCaseCity(cleaned);
}

function titleCaseCity(city: string) {
  return city
    .split(/\s+/)
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join(" ");
}

function checkoutDraftToLines(draft: CheckoutDraft) {
  return [
    draft.recipientName ? `recipient.name=${draft.recipientName}` : "",
    draft.phone ? `recipient.phone=${draft.phone}` : "",
    draft.address ? `delivery.address=${draft.address}` : "",
    draft.city ? `delivery.city=${draft.city}` : "",
    draft.locationType ? `delivery.location_type=${draft.locationType}${draft.addressType ? ` (from "${draft.addressType}")` : ""}` : "",
    draft.deliveryDate ? `delivery.date=${draft.deliveryDate}` : "",
    draft.senderName ? `sender.name=${draft.senderName}` : "",
    draft.giftMessage ? `gift_message=${draft.giftMessage}` : ""
  ].filter(Boolean);
}

function getMissingCheckoutFields(draft: CheckoutDraft) {
  return [
    draft.recipientName ? "" : "recipient.name",
    draft.phone ? "" : "recipient.phone",
    draft.address ? "" : "delivery.address",
    draft.city ? "" : "delivery.city",
    draft.locationType ? "" : "delivery.location_type",
    draft.deliveryDate ? "" : "delivery.date",
    draft.senderName ? "" : "sender.name"
  ].filter(Boolean);
}

function hasCheckoutDraftData(draft: CheckoutDraft) {
  return checkoutDraftToLines(draft).length > 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  return text
    .replace(PRODUCT_CONTEXT_COMMENT_REGEX, "")
    .replace(CART_CONTEXT_COMMENT_REGEX, "")
    .replace(CHECKOUT_DRAFT_CONTEXT_REGEX, "")
    .replace(ADDRESS_CONFIRMED_CONTEXT_REGEX, "")
    .replace(CONVERSATION_STATE_CONTEXT_REGEX, "")
    .replace(CHECKOUT_FLOW_MARKER_REGEX, "")
    .trim();
}

function containsLocalizedScript(text: string) {
  return /[\u0D80-\u0DFF\u0B80-\u0BFF]/.test(text);
}

function isConfirmedAddressMessage(text: string) {
  return /<!--ADDRESS_CONFIRMED:[\s\S]*?-->/i.test(text);
}

type ApiToolResult = {
  name: string;
  result: unknown;
};

type DirectProductSearchRequest = {
  query: string;
  label: string;
  intent: "cakes" | "flowers" | "roses" | "general";
  minPrice?: number;
  maxPrice?: number;
};

type MissingProductSearchInput = {
  latestText: string;
  messages: CoreMessage[];
  toolResults: ApiToolResult[];
  assistantText: string;
  providerConfig: ReturnType<typeof getProviderConfig>;
};

type CanonicalProductSearch = DirectProductSearchRequest & {
  shouldSearch: boolean;
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
  /\broses?\b/i,
  /\bchocolates?\b/i,
  /\bperfumes?\b/i,
  /\bwatches?\b/i,
  /\btoys?\b/i,
  /\bgifts?\b/i,
  /කේක්/i,
  /මල්/i,
  /චොකලට්/i,
  /තෑගි/i,
  /උපන්දින/i,
  /கேக்/i,
  /மலர்/i,
  /சாக்லேட்/i,
  /கிஃப்ட்/i,
  /பிறந்தநாள்/i
];

function shouldForceProductSearchTool(text: string) {
  if (!text || isCheckoutIntent(text)) return false;
  if (isProductPaginationIntent(text)) return false;
  if (/\b(track|tracking|order\s+status|order\s*(no|number|#))\b/i.test(text)) return false;
  if (/\b(view|details?|delivery|add\s+to\s+cart|cart)\b/i.test(text)) return false;
  return PRODUCT_QUERY_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldUseLocalProductRouting(text: string, language: ChatRequest["language"]) {
  if (language === "si" || language === "ta") return false;
  if (containsLocalizedScript(text)) return false;
  return true;
}

async function maybeRunMissingProductSearch({
  latestText,
  messages,
  toolResults,
  assistantText,
  providerConfig
}: MissingProductSearchInput) {
  const cleanLatestText = stripOperationalContext(latestText);
  if (!cleanLatestText || isCheckoutIntent(cleanLatestText)) return null;
  if (hasNonEmptySearchToolResults(toolResults)) return null;
  if (hasSearchToolResults(toolResults) && !containsLocalizedScript(cleanLatestText)) return null;
  if (extractProductDetailRequest(messages, cleanLatestText)) return null;
  if (isProductPaginationIntent(cleanLatestText)) return null;
  if (!shouldAskForCanonicalProductSearch(cleanLatestText, assistantText)) return null;

  const canonical = await getCanonicalProductSearch({
    latestText: cleanLatestText,
    messages,
    assistantText,
    providerConfig
  });
  if (!canonical?.shouldSearch || !canonical.query) return null;

  return runDirectProductSearch({
    query: canonical.query,
    label: canonical.label || canonical.query,
    intent: canonical.intent || "general",
    minPrice: canonical.minPrice,
    maxPrice: canonical.maxPrice
  });
}

function hasSearchToolResults(toolResults: ApiToolResult[]) {
  return toolResults.some((toolResult) => toolResult.name === "kapruka_search_products");
}

function hasNonEmptySearchToolResults(toolResults: ApiToolResult[]) {
  return toolResults.some(
    (toolResult) => toolResult.name === "kapruka_search_products" && hasResults(toolResult.result)
  );
}

function shouldAskForCanonicalProductSearch(latestText: string, assistantText: string) {
  if (containsLocalizedScript(latestText)) return true;
  if (shouldForceProductSearchTool(latestText)) return true;
  return /\b(i\s+found|found these|options?|products?|available|under|below|budget|rs\.?|lkr)\b/i.test(assistantText);
}

async function getCanonicalProductSearch({
  latestText,
  messages,
  assistantText,
  providerConfig
}: Omit<MissingProductSearchInput, "toolResults">): Promise<CanonicalProductSearch | null> {
  const recentTurns = messages
    .slice(-6)
    .map((message) => `${message.role}: ${truncateStateLine(stripOperationalContext(messageToText(message)), 220)}`)
    .join("\n");

  try {
    const result = await generateText({
      model: getActiveModel(messages.length, latestText, providerConfig),
      system: `You convert a shopping chat turn into an English Kapruka product search request.

Return only JSON:
{
  "shouldSearch": true,
  "query": "short English product search query",
  "label": "short English display label",
  "intent": "cakes|flowers|roses|general",
  "minPrice": 0,
  "maxPrice": 5000
}

Rules:
- Understand Sinhala, Tamil, Singlish, Tanglish, and English directly.
- Return shouldSearch true only when the user is asking to find, show, browse,
  compare, or buy product options, or when the assistant claimed it found products
  but no product tool result is present.
- Return shouldSearch false for checkout, delivery-only, order tracking,
  greetings, address confirmation, or general advice without product discovery.
- query must be English/romanized and suitable for kapruka_search_products.
- Extract budget constraints into minPrice/maxPrice as LKR numbers when present.
- Do not translate addresses here. This is product search canonicalization only.
- Use intent "cakes", "flowers", or "roses" only for those exact product families;
  otherwise use "general".
- No Markdown. No extra keys.`,
      prompt: JSON.stringify({
        latestUserMessage: latestText,
        recentConversation: recentTurns,
        assistantText: sanitizeAssistantText(assistantText)
      }),
      temperature: 0
    });

    return parseCanonicalProductSearch(result.text);
  } catch (error) {
    console.error("Product search canonicalization failed", getErrorLogSummary(error, getErrorDetail(error), getErrorStatus(error)));
    return null;
  }
}

function parseCanonicalProductSearch(text: string): CanonicalProductSearch | null {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : cleaned) as Record<string, unknown>;
    const query = cleanProductSearchQuery(typeof parsed.query === "string" ? parsed.query : "");
    const label = typeof parsed.label === "string" && parsed.label.trim() ? parsed.label.trim() : query;
    const intent = parseSearchIntent(parsed.intent);
    const minPrice = readOptionalPositiveNumber(parsed.minPrice);
    const maxPrice = readOptionalPositiveNumber(parsed.maxPrice);

    return {
      shouldSearch: parsed.shouldSearch === true,
      query,
      label,
      intent,
      minPrice,
      maxPrice
    };
  } catch {
    return null;
  }
}

function parseSearchIntent(value: unknown): DirectProductSearchRequest["intent"] {
  return value === "cakes" || value === "flowers" || value === "roses" ? value : "general";
}

function readOptionalPositiveNumber(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function cleanProductSearchQuery(query: string) {
  return query
    .replace(/\b(?:under|below|less than|max(?:imum)?|up to|around|about|approximately|rs\.?|lkr)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:k|thousand)?\b/gi, " ")
    .replace(/\b(?:price|budget|range)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toLowerCase();
}

function getDirectProductSearchRequest(text: string): DirectProductSearchRequest | null {
  const normalized = stripOperationalContext(text).toLowerCase();
  if (!shouldForceProductSearchTool(normalized)) return null;

  const priceRange = extractPriceRange(normalized);

  if (isRoseQuery(normalized)) {
    return { query: "red roses", label: "roses", intent: "roses", ...priceRange };
  }
  if (isBirthdayCakeQuery(normalized)) {
    return { query: "birthday cake", label: "birthday cake", intent: "cakes", ...priceRange };
  }
  if (isCakeQuery(normalized)) return { query: "cake", label: "cake", intent: "cakes", ...priceRange };
  if (isFlowerQuery(normalized)) {
    return { query: "flowers", label: "flowers", intent: "flowers", ...priceRange };
  }
  if (/\bchocolates?\b/.test(normalized)) return { query: "chocolates", label: "chocolates", intent: "general", ...priceRange };
  if (/\bperfumes?\b/.test(normalized)) return { query: "perfume", label: "perfume", intent: "general", ...priceRange };
  if (/\bwatches?\b/.test(normalized)) return { query: "watch", label: "watch", intent: "general", ...priceRange };
  if (/\b(toys?|stuffed|teddy)\b/.test(normalized)) return { query: "toys", label: "toys", intent: "general", ...priceRange };
  if (/\bear\s?phones?\b|\bearbuds?\b|\bbuds\b/.test(normalized)) return { query: "earphones", label: "earphones", intent: "general", ...priceRange };
  if (/\bhead\s?phones?\b/.test(normalized)) return { query: "headphones", label: "headphones", intent: "general", ...priceRange };
  if (/\bspeakers?\b/.test(normalized)) return { query: "speaker", label: "speaker", intent: "general", ...priceRange };
  if (/\bchargers?\b/.test(normalized)) return { query: "charger", label: "charger", intent: "general", ...priceRange };
  if (/\bcables?\b/.test(normalized)) return { query: "cable", label: "cable", intent: "general", ...priceRange };
  if (/\bgifts?\b/.test(normalized)) return { query: "gift", label: "gift", intent: "general", ...priceRange };

  const fallbackQuery = extractProductQuery(normalized);
  return fallbackQuery ? { query: fallbackQuery, label: fallbackQuery, intent: "general", ...priceRange } : null;
}

function isFlowerQuery(text: string) {
  return /\bflowers?\b/i.test(text) || /මල්|පුෂ්ප|මලක්|මල|மலர்|மலர்கள்|பூ|பூக்கள்/i.test(text);
}

function isRoseQuery(text: string) {
  return /\broses?\b/i.test(text) || /රෝස|රෝසමල්|ரோஜா|ரோஜாக்கள்|ரோஸ்/i.test(text);
}

function isCakeQuery(text: string) {
  return /\bcakes?\b/i.test(text) || /කේක්|கேக்/i.test(text);
}

function isBirthdayCakeQuery(text: string) {
  return (
    (/\bbirthday\b/i.test(text) || /උපන්දින|பிறந்தநாள்/i.test(text)) &&
    isCakeQuery(text)
  );
}

async function runDirectProductSearch(request: DirectProductSearchRequest) {
  let result: unknown;
  const query = cleanProductSearchQuery(request.query) || request.query;

  try {
    result = await executeTool("kapruka_search_products", {
      params: {
        q: query,
        limit: needsSearchRelevanceFilter(request.intent) ? 20 : 6,
        currency: "LKR",
        min_price: request.minPrice,
        max_price: request.maxPrice,
        in_stock_only: true,
        sort: "relevance",
        response_format: "json"
      }
    }, { cache: "skip" });
  } catch (error) {
    console.error("Direct Kapruka product search failed", getErrorLogSummary(error, getErrorDetail(error), getErrorStatus(error)));
    const emptyResult = {
      query,
      results: [],
      next_cursor: null,
      applied_filters: {
        q: query,
        in_stock_only: true,
        min_price: request.minPrice,
        max_price: request.maxPrice
      }
    };

    return {
      text: `I could not reach Kapruka product search cleanly for ${request.label} right now. Please try again in a moment. <!--QUICK_REPLIES:["Try again","Browse categories","Try cakes"]-->`,
      toolResult: { name: "kapruka_search_products", result: emptyResult }
    };
  }

  const filteredResult = filterSearchResultForIntent(result, request);

  return {
    text: hasResults(filteredResult)
      ? `I found these ${request.label} options on Kapruka. Pick a card to view details or add it to cart. <!--QUICK_REPLIES:["View top result","See similar","Proceed to checkout"]-->`
      : `I checked Kapruka for ${request.label}, but I could not find matching product cards right now. Try another product type or browse categories. <!--QUICK_REPLIES:["Browse categories","Try flowers","Try cakes"]-->`,
    toolResult: { name: "kapruka_search_products", result: filteredResult }
  };
}

function needsSearchRelevanceFilter(intent: DirectProductSearchRequest["intent"]) {
  return intent === "flowers" || intent === "roses" || intent === "cakes";
}

function filterSearchResultForIntent(result: unknown, request: DirectProductSearchRequest) {
  if (!result || typeof result !== "object" || !needsSearchRelevanceFilter(request.intent)) return result;

  const data = result as Record<string, unknown>;
  if (!Array.isArray(data.results)) return result;

  const filtered = data.results.filter((product) => productMatchesSearchIntent(product, request.intent)).slice(0, 6);

  return {
    ...data,
    results: filtered
  };
}

function productMatchesSearchIntent(product: unknown, intent: DirectProductSearchRequest["intent"]) {
  if (!product || typeof product !== "object") return false;
  const data = product as Record<string, unknown>;
  const id = readProductField(data.id ?? data.product_id ?? data.sku).toUpperCase();
  const name = readProductField(data.name ?? data.title);
  const summary = readProductField(data.summary ?? data.description);
  const haystack = `${id} ${name} ${summary}`.toLowerCase();

  if (intent === "cakes") return id.startsWith("CAKE") || /\bcakes?\b/.test(haystack);
  if (intent === "roses") {
    return (
      id.startsWith("FLOWERS") ||
      id.includes("_FLOW") ||
      /\bflowers?\s*-/.test(haystack) ||
      /\bflowerbouquet\b/.test(haystack)
    ) && /\broses?\b|redroses|pinkroses/.test(haystack);
  }
  if (intent === "flowers") {
    return (
      id.startsWith("FLOWERS") ||
      id.includes("_FLOW") ||
      /\bflowers?\s*-/.test(haystack) ||
      /\bflowerbouquet\b/.test(haystack)
    ) && !/\bcakes?\b|cakeandflower|combopack|chocolates?\b|kitkat/.test(haystack);
  }

  return true;
}

function readProductField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function extractPriceRange(text: string) {
  const rangeMatch = text.match(
    /\b(?:rs\.?|lkr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\s*(?:to|-|and)\s*(?:rs\.?|lkr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\b/i
  );

  if (rangeMatch) {
    return {
      minPrice: normalizePriceAmount(rangeMatch[1], rangeMatch[2]),
      maxPrice: normalizePriceAmount(rangeMatch[3], rangeMatch[4])
    };
  }

  const underMatch = text.match(/\b(?:under|below|less than|max(?:imum)?|up to)\s*(?:rs\.?|lkr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\b/i);
  if (underMatch) return { maxPrice: normalizePriceAmount(underMatch[1], underMatch[2]) };

  const overMatch = text.match(/\b(?:over|above|more than|min(?:imum)?|from)\s*(?:rs\.?|lkr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\b/i);
  if (overMatch) return { minPrice: normalizePriceAmount(overMatch[1], overMatch[2]) };

  return {};
}

function normalizePriceAmount(amount: string, suffix?: string) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return undefined;
  return suffix ? value * 1000 : value;
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
  }, { cache: "skip" });

  return {
    text: hasResults(result)
      ? `I found more ${request.query} options on Kapruka. The cards below are from the live product search, so you can view details or add one to cart. <!--QUICK_REPLIES:["View top result","See similar","Proceed to checkout"]-->`
      : `I checked for more ${request.query} options, but I could not find another page of product cards right now. <!--QUICK_REPLIES:["Search again","Browse categories","Try another budget"]-->`,
    toolResult: { name: "kapruka_search_products", result }
  };
}

async function runDirectProductDetail(productId: string) {
  const result = await executeTool("kapruka_get_product", {
    params: {
      product_id: productId,
      currency: "LKR",
      response_format: "json"
    }
  }, { cache: "skip" });

  return {
    text: `Here are the current details for ${productId}. <!--QUICK_REPLIES:["Add to cart","Check delivery","See similar"]-->`,
    toolResult: { name: "kapruka_get_product", result }
  };
}

function extractProductDetailRequest(messages: CoreMessage[], latestText: string) {
  if (!/\b(view|show|open|get|see)\b/i.test(latestText) || !/\b(details?|product|item|top\s+result)\b/i.test(latestText)) {
    return null;
  }

  const explicitId = latestText.match(/\b(?:for|id|product)\s+([A-Za-z0-9_-]{6,})\b/i)?.[1];
  if (explicitId) return explicitId;

  const directId = latestText.match(/\b([A-Z]{2,}[A-Z0-9_]*[A-Z0-9]{4,})\b/i)?.[1];
  if (directId) return directId;

  if (!/\btop\s+result\b/i.test(latestText)) return null;

  const contexts = Array.from(
    messages
      .map(messageToText)
      .join("\n")
      .matchAll(PRODUCT_CONTEXT_CAPTURE_REGEX),
    (match) => match[1]
  );

  for (const context of contexts.reverse()) {
    const firstCard = context
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("[card 1]"));
    const cardId = firstCard?.match(/\bid=([^;\s]+)/)?.[1]?.trim();
    if (cardId) return cardId;
  }

  return null;
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

function isCheckoutIntent(text: string) {
  return /\b(check\s*out|checkout|proceed|pay|payment|place\s+order|create\s+order|complete\s+order)\b/i.test(
    text
  );
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

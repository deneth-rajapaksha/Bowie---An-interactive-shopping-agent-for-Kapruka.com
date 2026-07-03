import type { ProductSummary, RenderedBlock } from "@/lib/types";

const QUICK_REPLY_REGEX = /<!--QUICK_REPLIES:(\[.*?\])-->/;
const PRODUCT_CONTEXT_COMMENT_REGEX = /<!--PRODUCT_CONTEXT:[\s\S]*?-->/g;
const CHECKOUT_FLOW_COMMENT_REGEX = /<!--CHECKOUT_[A-Z_]+-->/g;
const LEAKED_TOOL_CALL_BLOCK_REGEX = /<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi;
const DANGLING_TOOL_CALL_REGEX = /<tool_call\b[\s\S]*$/i;
const LEAKED_TOOL_JSON_REGEX =
  /\s*\{\s*"name"\s*:\s*"kapruka_[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}\s*/gi;
const LEAKED_PRODUCT_CONTEXT_REGEX =
  /\s*Product cards shown to the user:\s*(?:\[(?:search|card)\s+\d+\][\s\S]*?)(?=(?:Would you|Do you|Pick one|Tell me|I can|$))/i;

export type ToolResult = {
  name: string;
  result: string | Record<string, unknown>;
};

export function extractQuickReplies(text: string): { clean: string; chips: string[] } {
  const sanitized = stripHiddenContext(text);
  const match = sanitized.match(QUICK_REPLY_REGEX);
  if (!match) return { clean: sanitized.trim(), chips: [] };

  try {
    const chips = JSON.parse(match[1]) as string[];
    return {
      clean: stripHiddenContext(sanitized.replace(QUICK_REPLY_REGEX, "")).trim(),
      chips
    };
  } catch {
    return { clean: sanitized.trim(), chips: [] };
  }
}

function stripHiddenContext(text: string) {
  return text
    .replace(PRODUCT_CONTEXT_COMMENT_REGEX, "")
    .replace(CHECKOUT_FLOW_COMMENT_REGEX, "")
    .replace(LEAKED_TOOL_CALL_BLOCK_REGEX, " ")
    .replace(DANGLING_TOOL_CALL_REGEX, " ")
    .replace(LEAKED_TOOL_JSON_REGEX, " ")
    .replace(LEAKED_PRODUCT_CONTEXT_REGEX, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseToolResults(toolResults: ToolResult[] = []): RenderedBlock[] {
  return toolResults.flatMap((tool) => {
    const data = readToolPayload(tool.result);

    switch (tool.name) {
      case "kapruka_search_products":
        return [
          {
            type: "product_list",
            products: readArray(data.results).map(normalizeProductSummary),
            query: readString(data.query ?? data.applied_filters?.q),
            next_cursor: readString(data.next_cursor) || null
          }
        ] as RenderedBlock[];
      case "kapruka_get_product":
        return [{ type: "product_detail", product: normalizeProductSummary(data) }] as RenderedBlock[];
      case "kapruka_check_delivery":
        return [{ type: "delivery_check", delivery: data }] as RenderedBlock[];
      case "kapruka_create_order":
        return [{ type: "order_summary", order: data }] as RenderedBlock[];
      case "kapruka_track_order":
        return [{ type: "order_tracker", tracking: data }] as RenderedBlock[];
      case "kapruka_list_categories":
        return [{ type: "category_grid", categories: readArray(data.categories) }] as RenderedBlock[];
      default:
        return [];
    }
  });
}

function readToolPayload(result: ToolResult["result"]): Record<string, any> {
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
      return {};
    }
  }

  if (result && typeof result === "object") return result as Record<string, any>;
  return {};
}

function readArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeProductSummary(product: Record<string, any>): ProductSummary {
  const name = readString(product.name ?? product.title) || "Kapruka product";
  const category = readCategory(product.category);
  const summary = readString(product.summary ?? product.description) || defaultProductSummary(name, category);
  const price = readPrice(product.price);

  return {
    ...product,
    id: readString(product.id ?? product.product_id ?? product.sku) || name,
    name,
    summary,
    price,
    compare_at_price: product.compare_at_price ?? null,
    in_stock: typeof product.in_stock === "boolean" ? product.in_stock : true,
    stock_level: product.stock_level,
    image_url: readString(product.image_url) || readFirstString(product.images) || null,
    category,
    url: readString(product.url)
  };
}

function readPrice(value: unknown) {
  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>;
    const amount = Number(data.amount);
    return {
      amount: Number.isFinite(amount) ? amount : 0,
      currency: readString(data.currency) || "LKR"
    };
  }

  const amount = Number(value);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    currency: "LKR"
  };
}

function readCategory(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const data = value as Record<string, unknown>;
    return readString(data.name ?? data.title ?? data.slug);
  }
  return "";
}

function readFirstString(value: unknown) {
  return Array.isArray(value) ? value.find((entry) => typeof entry === "string") || "" : "";
}

function defaultProductSummary(name: string, category: string) {
  if (category) return `${category} item available through Kapruka.`;
  return `${name} available through Kapruka.`;
}

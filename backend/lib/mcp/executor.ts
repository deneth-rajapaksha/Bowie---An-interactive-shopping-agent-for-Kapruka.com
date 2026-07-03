import { getCached, incrementCachedCounter, setCached } from "@/lib/cache/redis";
import { getMcpClient } from "@/lib/mcp/client";
import { normalizeToolArgs, toolCacheTtlSeconds } from "@/lib/mcp/definitions";

type ExecuteToolOptions = {
  cache?: "default" | "skip";
};

export async function executeTool(toolName: string, args: unknown, options: ExecuteToolOptions = {}) {
  const normalizedArgs = normalizeToolArgs(toolName, args);
  validateToolPayload(toolName, normalizedArgs);
  const ttlSeconds = toolCacheTtlSeconds(toolName);
  const cacheKey = await buildCacheKey(toolName, normalizedArgs);
  const hotSearchConfig = getHotSearchCacheConfig(toolName);
  const useCache = options.cache !== "skip";

  if (useCache && hotSearchConfig) {
    const hotCached = await getCached(`${cacheKey}:hot`);
    if (hotCached) return hotCached;
  }

  if (useCache && ttlSeconds > 0) {
    const cached = await getCached(cacheKey);
    if (cached) {
      if (hotSearchConfig) {
        await promoteHotSearchIfNeeded(cacheKey, cached, hotSearchConfig);
      }
      return cached;
    }
  }

  const client = await getMcpClient();
  const result = await client.callTool({
    name: toolName,
    arguments: normalizedArgs
  });
  const parsed = compactToolResult(toolName, parseMcpResult(result));

  if (useCache && ttlSeconds > 0) {
    await setCached(cacheKey, parsed, ttlSeconds);
  }

  if (useCache && hotSearchConfig) {
    await promoteHotSearchIfNeeded(cacheKey, parsed, hotSearchConfig);
  }

  return parsed;
}

function validateToolPayload(toolName: string, normalizedArgs: unknown) {
  if (toolName !== "kapruka_create_order") return;

  const params =
    normalizedArgs && typeof normalizedArgs === "object" && "params" in normalizedArgs
      ? (normalizedArgs as { params?: unknown }).params
      : normalizedArgs;

  const localizedFields = findLocalizedCheckoutFields(params);
  if (localizedFields.length) {
    throw new Error(
      `Checkout blocked: kapruka_create_order requires English/romanized checkout fields. Localized script found in ${localizedFields.join(
        ", "
      )}. Confirm/canonicalize the address and romanize names/messages before checkout.`
    );
  }
}

function findLocalizedCheckoutFields(value: unknown, path = "params"): string[] {
  if (typeof value === "string") {
    return /[\u0D80-\u0DFF\u0B80-\u0BFF]/.test(value) ? [path] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findLocalizedCheckoutFields(entry, `${path}[${index}]`));
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      findLocalizedCheckoutFields(entry, `${path}.${key}`)
    );
  }

  return [];
}

type HotSearchCacheConfig = {
  minHits: number;
  windowSeconds: number;
  ttlSeconds: number;
};

function getHotSearchCacheConfig(toolName: string): HotSearchCacheConfig | null {
  if (toolName !== "kapruka_search_products") return null;

  return {
    minHits: readPositiveInt("SEARCH_HOT_CACHE_MIN_HITS", 3),
    windowSeconds: readPositiveInt("SEARCH_HOT_CACHE_WINDOW_SECONDS", 60 * 60),
    ttlSeconds: readPositiveInt("SEARCH_HOT_CACHE_TTL_SECONDS", 6 * 60 * 60)
  };
}

async function promoteHotSearchIfNeeded(
  cacheKey: string,
  result: unknown,
  config: HotSearchCacheConfig
) {
  const hitCount = await incrementCachedCounter(`${cacheKey}:hits`, config.windowSeconds);
  if (hitCount >= config.minHits) {
    await setCached(`${cacheKey}:hot`, result, config.ttlSeconds);
  }
}

function parseMcpResult(result: unknown) {
  if (!result || typeof result !== "object") return result;

  const maybeResult = result as {
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };

  if (maybeResult.structuredContent) {
    return normalizeStructuredContent(maybeResult.structuredContent);
  }

  const text = maybeResult.content
    ?.map((part) => (part.type === "text" ? part.text ?? "" : ""))
    .join("\n")
    .trim();

  if (!text) return result;

  try {
    return JSON.parse(text);
  } catch {
    return { result: text, isError: maybeResult.isError ?? false };
  }
}

function normalizeStructuredContent(structuredContent: unknown) {
  if (!structuredContent || typeof structuredContent !== "object") return structuredContent;
  const data = structuredContent as Record<string, unknown>;

  if (typeof data.result === "string") {
    try {
      const parsed = JSON.parse(data.result);
      return parsed && typeof parsed === "object" ? parsed : structuredContent;
    } catch {
      return structuredContent;
    }
  }

  return structuredContent;
}

function compactToolResult(toolName: string, result: unknown) {
  switch (toolName) {
    case "kapruka_search_products":
      return compactSearchResult(result);
    case "kapruka_get_product":
      return compactProductDetail(result);
    case "kapruka_list_categories":
      return compactCategoryResult(result);
    default:
      return result;
  }
}

function compactSearchResult(result: unknown) {
  if (!result || typeof result !== "object") return result;
  const data = result as Record<string, unknown>;
  const results = Array.isArray(data.results) ? data.results.slice(0, 20) : [];

  return {
    ...pick(data, ["query", "total", "next_cursor", "applied_filters"]),
    results: results.map(compactProductSummary)
  };
}

function compactProductDetail(result: unknown) {
  if (!result || typeof result !== "object") return result;
  const data = result as Record<string, unknown>;
  const images = Array.isArray(data.images) ? data.images.filter(isString).slice(0, 4) : undefined;
  const variants = Array.isArray(data.variants)
    ? data.variants.slice(0, 6).map((variant) => {
        if (!variant || typeof variant !== "object") return variant;
        return pick(variant as Record<string, unknown>, ["id", "name", "price"]);
      })
    : undefined;

  return removeUndefined({
    ...compactProductSummary(data),
    description: truncate(readString(data.description), 500),
    images,
    variants,
    attributes: data.attributes,
    shipping: data.shipping
  });
}

function compactCategoryResult(result: unknown) {
  if (!result || typeof result !== "object") return result;
  const data = result as Record<string, unknown>;
  const categories = Array.isArray(data.categories) ? data.categories.slice(0, 18) : [];

  return {
    categories: categories.map((category) => {
      if (!category || typeof category !== "object") return category;
      const item = category as Record<string, unknown>;
      const children = Array.isArray(item.children) ? item.children.slice(0, 8) : undefined;
      return removeUndefined({
        name: item.name,
        url: item.url,
        children
      });
    })
  };
}

function compactProductSummary(product: unknown): Record<string, unknown> {
  if (!product || typeof product !== "object") return {};
  const data = product as Record<string, unknown>;
  const name = readString(data.name ?? data.title);
  const category = readCategory(data.category);

  return removeUndefined({
    id: data.id ?? data.product_id ?? data.sku,
    product_id: data.product_id,
    name,
    summary: truncate(readString(data.summary ?? data.description), 220) || defaultProductSummary(name, category),
    price: data.price,
    compare_at_price: data.compare_at_price,
    in_stock: data.in_stock,
    stock_level: data.stock_level,
    image_url: data.image_url ?? firstString(data.images),
    category,
    url: data.url
  });
}

function pick(source: Record<string, unknown>, keys: string[]) {
  return removeUndefined(
    Object.fromEntries(keys.map((key) => [key, source[key]]))
  );
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readCategory(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const data = value as Record<string, unknown>;
    return readString(data.name ?? data.title ?? data.slug);
  }
  return "";
}

function defaultProductSummary(name: string, category: string) {
  if (category) return `${category} item available through Kapruka.`;
  if (name) return `${name} available through Kapruka.`;
  return "";
}

function firstString(value: unknown) {
  return Array.isArray(value) ? value.find(isString) : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function readPositiveInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function buildCacheKey(toolName: string, args: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify({ toolName, args }));
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hash = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `kapruka:${toolName}:${hash}`;
}

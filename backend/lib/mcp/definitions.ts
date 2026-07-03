import { z } from "zod";

const currencySchema = z
  .enum(["LKR", "USD", "GBP", "AUD", "CAD", "EUR"])
  .default("LKR");

const responseFormatSchema = z.enum(["markdown", "json"]).default("json");

export const toolDefinitions = {
  kapruka_list_categories: {
    description: "List Kapruka top-level product categories and optional children.",
    schema: z.object({
      depth: z.number().int().min(1).max(2).default(1),
      response_format: responseFormatSchema
    })
  },
  kapruka_search_products: {
    description: "Search Kapruka products by keyword, category, stock, price, currency, and pagination cursor.",
    schema: z.object({
      q: z.string().min(3),
      category: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(20).default(4),
      cursor: z.string().nullable().optional(),
      currency: currencySchema,
      min_price: z.number().nullable().optional(),
      max_price: z.number().nullable().optional(),
      in_stock_only: z.boolean().default(true),
      sort: z
        .enum(["relevance", "price_asc", "price_desc", "newest", "bestseller"])
        .default("relevance"),
      include_stubs: z.boolean().default(false),
      response_format: responseFormatSchema
    })
  },
  kapruka_get_product: {
    description: "Fetch full details for one Kapruka product by product ID.",
    schema: z.object({
      product_id: z.string().min(1),
      currency: currencySchema,
      type: z.string().nullable().optional(),
      response_format: responseFormatSchema
    })
  },
  kapruka_list_delivery_cities: {
    description: "List or search Sri Lankan delivery cities supported by Kapruka.",
    schema: z.object({
      query: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(20).default(10),
      response_format: responseFormatSchema
    })
  },
  kapruka_check_delivery: {
    description: "Check whether Kapruka can deliver to a city and date, optionally for a product.",
    schema: z.object({
      city: z.string().min(1),
      delivery_date: z.string().nullable().optional(),
      product_id: z.string().nullable().optional(),
      response_format: responseFormatSchema
    })
  },
  kapruka_create_order: {
    description: "Create a guest checkout order and return a 60-minute Kapruka payment link.",
    schema: z.object({
      cart: z
        .array(
          z.object({
            product_id: z.string().min(1),
            quantity: z.number().int().min(1).max(30),
            icing_text: z.string().optional()
          })
        )
        .min(1)
        .max(30),
      recipient: z.object({
        name: z.string().min(1),
        phone: z.string().min(7)
      }),
      delivery: z.object({
        address: z.string().min(1),
        city: z.string().min(1),
        location_type: z.string().default("home"),
        date: z.string().min(10),
        instructions: z.string().nullable().optional()
      }),
      sender: z.object({
        name: z.string().min(1),
        anonymous: z.boolean().default(false)
      }),
      gift_message: z.string().nullable().optional(),
      currency: currencySchema,
      response_format: responseFormatSchema
    })
  },
  kapruka_track_order: {
    description: "Track a Kapruka order by order number and return delivery progress.",
    schema: z.object({
      order_number: z.string().min(1),
      response_format: responseFormatSchema
    })
  }
} as const;

type ToolName = keyof typeof toolDefinitions;

export function normalizeToolArgs(toolName: string, args: unknown) {
  const maybeArgs = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const params = maybeArgs.params && typeof maybeArgs.params === "object" ? maybeArgs.params : maybeArgs;
  const definition = toolDefinitions[toolName as ToolName];

  if (!definition) {
    return { params };
  }

  return {
    params: definition.schema.parse(params)
  };
}

export function toolCacheTtlSeconds(toolName: string) {
  switch (toolName) {
    case "kapruka_list_categories":
      return 30 * 60;
    case "kapruka_list_delivery_cities":
      return 24 * 60 * 60;
    case "kapruka_get_product":
      return 60 * 60;
    case "kapruka_search_products":
      return 5 * 60;
    case "kapruka_check_delivery":
      return 60;
    case "kapruka_track_order":
      return 30;
    case "kapruka_create_order":
      return 0;
    default:
      return 0;
  }
}

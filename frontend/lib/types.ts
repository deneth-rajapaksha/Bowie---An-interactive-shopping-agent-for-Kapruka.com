export type Currency = "LKR" | "USD" | "GBP" | "AUD" | "CAD" | "EUR";

export type ProductSummary = {
  id: string;
  name: string;
  summary: string;
  price: Money;
  compare_at_price?: Money | null;
  in_stock: boolean;
  stock_level?: "low" | "medium" | "high";
  image_url: string | null;
  category?: string;
  url: string;
};

export type ProductDetail = ProductSummary & {
  description?: string;
  images?: string[];
  variants?: Array<{ id: string; name: string; price?: Money }>;
  attributes?: Record<string, string>;
  shipping?: Record<string, unknown>;
};

export type Money = {
  amount: number;
  currency: Currency | string;
};

export type Category = {
  name: string;
  url: string;
  children?: Category[];
};

export type DeliveryResult = {
  city: string;
  checked_date: string;
  available: boolean;
  rate: number;
  currency: string;
  reason?: string | null;
  next_available_date?: string | null;
  perishable_warning?: string | null;
};

export type OrderResult = {
  checkout_url: string;
  order_ref: string;
  summary: {
    items_total: number;
    delivery_fee: number;
    addons_total?: number;
    grand_total: number;
    currency: string;
  };
  expires_at: string;
};

export type TrackingResult = {
  order_number: string;
  status: string;
  status_display: string;
  order_date?: string;
  delivery_date?: string;
  shipped_date?: string | null;
  amount?: number;
  recipient?: { name?: string; city?: string };
  progress: Array<{ label: string; timestamp?: string | null; completed?: boolean }>;
  items?: ProductSummary[];
  has_delivery_photo?: boolean;
  has_delivery_video?: boolean;
};

export type AddressCandidate = {
  placeId: string;
  name?: string;
  formattedAddress: string;
  city?: string;
  mcpAddress: string;
  location?: {
    lat: number;
    lng: number;
  };
};

export type ParsedAddressInput = {
  searchQuery: string;
  addressText?: string | null;
  city?: string | null;
  recipientName?: string | null;
  phone?: string | null;
  addressType?: "home" | "office" | "other" | null;
  deliveryDate?: string | null;
  senderName?: string | null;
  giftMessage?: string | null;
};

export type AddressLookupResult = {
  inputLanguage?: "sinhala" | "tamil" | null;
  parsed: ParsedAddressInput;
  candidates: AddressCandidate[];
};

export type RenderedBlock =
  | { type: "text"; content: string }
  | {
      type: "product_list";
      products: ProductSummary[];
      query?: string;
      next_cursor?: string | null;
    }
  | { type: "product_detail"; product: ProductDetail }
  | { type: "delivery_check"; delivery: DeliveryResult }
  | { type: "order_summary"; order: OrderResult }
  | { type: "order_tracker"; tracking: TrackingResult }
  | { type: "category_grid"; categories: Category[] }
  | { type: "address_confirmation"; lookup: AddressLookupResult };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelContent?: string;
  blocks?: RenderedBlock[];
  quickReplies?: string[];
  traceId?: string;
  conversationId?: string;
  feedback?: "liked" | "disliked" | "reason-pending";
};

export type CartItem = {
  product_id: string;
  name: string;
  summary?: string;
  price: number;
  currency: string;
  image_url: string | null;
  quantity: number;
  category?: string;
  url?: string;
  icing_text?: string;
};

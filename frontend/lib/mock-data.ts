import type { Category, DeliveryResult, OrderResult, ProductDetail, ProductSummary, TrackingResult } from "@/lib/types";

export const sampleProducts: ProductSummary[] = [
  {
    id: "cake00ka002034",
    name: "Chocolate Ganache Birthday Cake",
    summary: "Rich chocolate cake with ganache topping, perfect for family birthdays.",
    price: { amount: 6250, currency: "LKR" },
    compare_at_price: { amount: 6900, currency: "LKR" },
    in_stock: true,
    stock_level: "high",
    image_url: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?q=80&w=900&auto=format&fit=crop",
    category: "cakes",
    url: "https://www.kapruka.com/online/cakes"
  },
  {
    id: "flowers00t2075",
    name: "Six Red Rose Bouquet",
    summary: "Elegant red roses wrapped for anniversaries, apologies, and surprises.",
    price: { amount: 5210, currency: "LKR" },
    in_stock: true,
    stock_level: "medium",
    image_url: "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?q=80&w=900&auto=format&fit=crop",
    category: "flowers",
    url: "https://www.kapruka.com/online/flowers"
  },
  {
    id: "choc00giftset",
    name: "Premium Chocolate Gift Box",
    summary: "A neat gift box with assorted imported chocolates.",
    price: { amount: 4850, currency: "LKR" },
    in_stock: true,
    stock_level: "low",
    image_url: "https://images.unsplash.com/photo-1549007994-cb92caebd54b?q=80&w=900&auto=format&fit=crop",
    category: "chocolates",
    url: "https://www.kapruka.com/online/chocolates"
  }
];

export const sampleProductDetail: ProductDetail = {
  ...sampleProducts[0],
  description:
    "A moist chocolate sponge layered with smooth ganache and finished for birthday gifting. Add icing text during checkout.",
  images: [
    sampleProducts[0].image_url || "",
    "https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?q=80&w=900&auto=format&fit=crop"
  ],
  variants: [
    { id: "1kg", name: "1kg", price: { amount: 6250, currency: "LKR" } },
    { id: "2kg", name: "2kg", price: { amount: 9900, currency: "LKR" } }
  ],
  attributes: {
    Occasion: "Birthday",
    Serves: "8-10 people"
  }
};

export const sampleCategories: Category[] = [
  { name: "cakes", url: "https://www.kapruka.com/online/cakes" },
  { name: "flowers", url: "https://www.kapruka.com/online/flowers" },
  { name: "chocolates", url: "https://www.kapruka.com/online/chocolates" },
  { name: "jewellery", url: "https://www.kapruka.com/online/jewellery" },
  { name: "softtoy", url: "https://www.kapruka.com/online/softtoy" },
  { name: "grocery", url: "https://www.kapruka.com/online/grocery" }
];

export const sampleDelivery: DeliveryResult = {
  city: "Colombo",
  checked_date: "2026-06-12",
  available: true,
  rate: 975,
  currency: "LKR",
  perishable_warning: "Cake deliveries are best scheduled for the exact celebration date."
};

export const sampleOrder: OrderResult = {
  checkout_url: "https://www.kapruka.com",
  order_ref: "BOWIE-DEMO-1024",
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  summary: {
    items_total: 6250,
    delivery_fee: 975,
    addons_total: 0,
    grand_total: 7225,
    currency: "LKR"
  }
};

export const sampleTracking: TrackingResult = {
  order_number: "DEMO-ORDER-42",
  status: "out_for_delivery",
  status_display: "Out for delivery",
  delivery_date: "2026-06-12",
  recipient: { name: "Recipient", city: "Colombo" },
  progress: [
    { label: "Received", completed: true, timestamp: "09:05" },
    { label: "Confirmed", completed: true, timestamp: "09:20" },
    { label: "Out for delivery", completed: true, timestamp: "14:15" },
    { label: "Delivered", completed: false, timestamp: null }
  ],
  items: [sampleProducts[0]],
  has_delivery_photo: false,
  has_delivery_video: false
};

import type { Money } from "@/lib/types";

export function formatMoney(money: Money | { amount: number; currency: string }) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency: money.currency || "LKR",
    maximumFractionDigits: 0
  }).format(money.amount || 0);
}

export function clampText(text: string, length = 140) {
  if (text.length <= length) return text;
  return `${text.slice(0, length - 1).trim()}...`;
}

export function safeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

"use client";

import type { Category } from "@/lib/types";

const CATEGORY_LABELS: Record<string, string> = {
  cakes: "Cakes",
  flowers: "Flowers",
  chocolates: "Chocolates",
  jewellery: "Jewellery",
  softtoy: "Soft toys",
  grocery: "Grocery"
};

export function CategoryGrid({ categories, onSelect }: { categories: Category[]; onSelect: (category: Category) => void }) {
  return (
    <div className="category-grid">
      {categories.slice(0, 8).map((category) => (
        <button key={category.name} type="button" onClick={() => onSelect(category)}>
          <span>{CATEGORY_LABELS[category.name.toLowerCase()] || category.name}</span>
        </button>
      ))}
    </div>
  );
}

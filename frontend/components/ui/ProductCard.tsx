"use client";

import Image from "next/image";
import { formatMoney } from "@/lib/format";
import type { ProductSummary } from "@/lib/types";

type ProductCardProps = {
  product: ProductSummary;
  cardNumber: number;
  onView: (id: string) => void;
  onAddToCart: (product: ProductSummary) => void;
};

export function ProductCard({ product, cardNumber, onView, onAddToCart }: ProductCardProps) {
  const stockLabel = !product.in_stock
    ? "Sold out"
    : product.stock_level === "low"
      ? "Low stock"
      : "In stock";

  return (
    <article className="product-card" aria-label={`${product.name}, product card ${cardNumber}`}>
      <button type="button" className="product-image-button" onClick={() => onView(product.id)}>
        {product.image_url ? (
          <Image src={product.image_url} alt={product.name} fill sizes="240px" />
        ) : (
          <span>No image</span>
        )}
        <span className={`stock-badge ${product.in_stock ? product.stock_level || "medium" : "out"}`}>
          {stockLabel}
        </span>
      </button>
      <div className="product-card-body">
        <h3>{product.name}</h3>
        <p>{product.summary}</p>
        <div className="price-row">
          <strong>{formatMoney(product.price)}</strong>
          <span>Per Unit</span>
          {product.compare_at_price ? <del>{formatMoney(product.compare_at_price)}</del> : null}
        </div>
        <div className="product-actions">
          <button type="button" onClick={() => onView(product.id)}>
            Details
          </button>
          <button type="button" disabled={!product.in_stock} onClick={() => onAddToCart(product)}>
            Add to Cart
          </button>
        </div>
      </div>
    </article>
  );
}

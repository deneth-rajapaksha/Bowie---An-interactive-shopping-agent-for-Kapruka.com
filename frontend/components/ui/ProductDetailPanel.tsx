"use client";

import Image from "next/image";
import { clampText, formatMoney } from "@/lib/format";
import type { ProductDetail, ProductSummary } from "@/lib/types";

type ProductDetailPanelProps = {
  product: ProductDetail;
  onAddToCart: (product: ProductSummary) => void;
  onCheckDelivery: (id: string) => void;
};

export function ProductDetailPanel({ product, onAddToCart, onCheckDelivery }: ProductDetailPanelProps) {
  const heroImage = product.images?.[0] || product.image_url;

  return (
    <section className="detail-panel">
      <div className="detail-image">
        {heroImage ? <Image src={heroImage} alt={product.name} fill sizes="520px" /> : <span>No image</span>}
      </div>
      <div className="detail-content">
        <div>
          <span className={`stock-badge ${product.in_stock ? product.stock_level || "medium" : "out"}`}>
            {product.in_stock ? "In stock" : "Sold out"}
          </span>
          <h2>{product.name}</h2>
          <strong className="detail-price">{formatMoney(product.price)}</strong>
        </div>
        {product.description ? <p>{clampText(product.description, 180)}</p> : null}
        {product.variants?.length ? (
          <label className="field-label">
            Variant
            <select>
              {product.variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="detail-actions">
          <button type="button" disabled={!product.in_stock} onClick={() => onAddToCart(product)}>
            Add to cart
          </button>
          <button type="button" onClick={() => onCheckDelivery(product.id)}>
            Check delivery
          </button>
        </div>
      </div>
    </section>
  );
}

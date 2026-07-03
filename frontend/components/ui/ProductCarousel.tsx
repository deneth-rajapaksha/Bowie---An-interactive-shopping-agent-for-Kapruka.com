"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ProductCard } from "@/components/ui/ProductCard";
import type { ProductSummary } from "@/lib/types";

type ProductCarouselProps = {
  products: ProductSummary[];
  query?: string;
  nextCursor?: string | null;
  onView: (id: string) => void;
  onAddToCart: (product: ProductSummary) => void;
  onSeeMore: (query?: string, cursor?: string | null) => void;
};

export function ProductCarousel({
  products,
  query,
  nextCursor,
  onView,
  onAddToCart,
  onSeeMore
}: ProductCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const visibleProducts = useMemo(() => products.slice(0, 6), [products]);
  const seeMoreIndex = visibleProducts.length;

  if (!products.length) return null;

  const maxIndex = seeMoreIndex;
  const currentProduct = visibleProducts[Math.min(activeIndex, visibleProducts.length - 1)];

  function goNext() {
    setActiveIndex((current) => Math.min(current + 1, maxIndex));
  }

  function goPrev() {
    setActiveIndex((current) => Math.max(current - 1, 0));
  }

  function handlePointerEnd(clientX: number) {
    if (dragStart === null) return;
    const delta = clientX - dragStart;
    setDragStart(null);

    if (Math.abs(delta) < 40) return;
    if (delta < 0) {
      goNext();
    } else {
      goPrev();
    }
  }

  return (
    <div className="product-deck" aria-label="Product results">
      <div
        className="deck-stage"
        onPointerDown={(event) => setDragStart(event.clientX)}
        onPointerUp={(event) => handlePointerEnd(event.clientX)}
        onPointerCancel={() => setDragStart(null)}
      >
        <button
          type="button"
          className="deck-arrow deck-arrow-left"
          onClick={goPrev}
          disabled={activeIndex === 0}
          aria-label="Previous product"
        >
          &lsaquo;
        </button>

        <div className="deck-viewport">
          <div className="deck-track" style={{ "--active-index": activeIndex } as CSSProperties}>
            {visibleProducts.map((product, index) => (
              <div key={product.id} className="deck-slide" aria-hidden={index !== activeIndex}>
                <ProductCard
                  product={product}
                  cardNumber={index + 1}
                  onView={onView}
                  onAddToCart={onAddToCart}
                />
              </div>
            ))}

            <div className="deck-slide" aria-hidden={activeIndex !== seeMoreIndex}>
              <article className="product-card see-more-card">
                <div className="see-more-content">
                  <span>More picks</span>
                  <h3>See more products</h3>
                  <p>
                    {currentProduct
                      ? `Keep browsing products related to ${currentProduct.name}.`
                      : "Search for more Kapruka products."}
                  </p>
                  <button type="button" onClick={() => onSeeMore(query, nextCursor)}>
                    See More
                  </button>
                </div>
              </article>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="deck-arrow deck-arrow-right"
          onClick={goNext}
          disabled={activeIndex === maxIndex}
          aria-label="Next product"
        >
          &rsaquo;
        </button>
      </div>

      <div className="deck-dots" aria-label="Carousel position">
        {Array.from({ length: maxIndex + 1 }, (_, index) => (
          <button
            key={index}
            type="button"
            className={index === activeIndex ? "active" : ""}
            onClick={() => setActiveIndex(index)}
            aria-label={
              index === seeMoreIndex
                ? "Go to more products"
                : `Go to product ${index + 1}`
            }
          />
        ))}
      </div>
    </div>
  );
}

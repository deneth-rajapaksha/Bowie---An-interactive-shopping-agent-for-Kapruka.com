"use client";

import Image from "next/image";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { AddressConfirmationCard } from "@/components/ui/AddressConfirmationCard";
import { CategoryGrid } from "@/components/ui/CategoryGrid";
import { DeliveryCard } from "@/components/ui/DeliveryCard";
import { OrderSummaryCard } from "@/components/ui/OrderSummaryCard";
import { OrderTrackerCard } from "@/components/ui/OrderTrackerCard";
import { ProductCarousel } from "@/components/ui/ProductCarousel";
import { ProductDetailPanel } from "@/components/ui/ProductDetailPanel";
import type { AddressCandidate, ChatMessage, ProductSummary } from "@/lib/types";

type MessageBubbleProps = {
  message: ChatMessage;
  onAddToCart: (product: ProductSummary) => void;
  onSendMessage: (message: string) => void;
  onConfirmAddress?: (candidate: AddressCandidate) => void;
  onEditAddress?: () => void;
  onFeedback?: (message: ChatMessage, rating: "like" | "dislike") => void;
};

export function MessageBubble({
  message,
  onAddToCart,
  onSendMessage,
  onConfirmAddress,
  onEditAddress,
  onFeedback
}: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <article className={`message-row ${isUser ? "is-user" : "is-assistant"}`}>
      {!isUser ? (
        <div className="assistant-avatar" aria-hidden="true">
          <Image src="/bowie_ai_mascot_logo.png" alt="" width={34} height={34} />
        </div>
      ) : null}
      <div className="message-content">
        {message.content ? (
          <div className="message-bubble">
            <p>{message.content}</p>
          </div>
        ) : null}
        <div className="message-blocks">
          {message.blocks?.map((block, index) => {
            if (block.type === "product_list") {
              return (
                <ProductCarousel
                  key={`${message.id}-${index}`}
                  products={block.products}
                  query={block.query}
                  nextCursor={block.next_cursor}
                  onAddToCart={onAddToCart}
                  onView={(id) => onSendMessage(`View details for ${id}`)}
                  onSeeMore={(query, cursor) =>
                    onSendMessage(
                      cursor || query
                        ? `Show more products for ${query || "the previous search"}`
                        : "Show more products like the previous product cards"
                    )
                  }
                />
              );
            }

            if (block.type === "product_detail") {
              return (
                <ProductDetailPanel
                  key={`${message.id}-${index}`}
                  product={block.product}
                  onAddToCart={onAddToCart}
                  onCheckDelivery={(id) => onSendMessage(`Check delivery for ${id} to Colombo tomorrow`)}
                />
              );
            }

            if (block.type === "delivery_check") {
              return <DeliveryCard key={`${message.id}-${index}`} delivery={block.delivery} />;
            }

            if (block.type === "order_summary") {
              return <OrderSummaryCard key={`${message.id}-${index}`} order={block.order} />;
            }

            if (block.type === "order_tracker") {
              return <OrderTrackerCard key={`${message.id}-${index}`} tracking={block.tracking} />;
            }

            if (block.type === "category_grid") {
              return (
                <CategoryGrid
                  key={`${message.id}-${index}`}
                  categories={block.categories}
                  onSelect={(category) => onSendMessage(`Show me ${category.name}`)}
                />
              );
            }

            if (block.type === "address_confirmation") {
              return (
                <AddressConfirmationCard
                  key={`${message.id}-${index}`}
                  lookup={block.lookup}
                  onConfirm={(candidate) => onConfirmAddress?.(candidate)}
                  onEdit={() => onEditAddress?.()}
                />
              );
            }

            return null;
          })}
        </div>
        {!isUser && message.traceId ? (
          <div className="feedback-row" aria-label="Response feedback">
            <button
              type="button"
              className={message.feedback === "liked" ? "active" : ""}
              onClick={() => onFeedback?.(message, "like")}
              aria-label="Like this response"
              title="Like this response"
            >
              <ThumbsUp size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={message.feedback === "disliked" || message.feedback === "reason-pending" ? "active" : ""}
              onClick={() => onFeedback?.(message, "dislike")}
              aria-label="Dislike this response"
              title="Dislike this response"
            >
              <ThumbsDown size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

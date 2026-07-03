"use client";

import Image from "next/image";
import { formatMoney } from "@/lib/format";
import type { CartItem } from "@/lib/types";

type CartDrawerProps = {
  open: boolean;
  cart: CartItem[];
  onClose: () => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onCheckout: () => void;
};

export function CartDrawer({ open, cart, onClose, onUpdateQuantity, onCheckout }: CartDrawerProps) {
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const currency = cart[0]?.currency || "LKR";

  return (
    <aside className={`cart-drawer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="cart-header">
        <h2>Cart</h2>
        <button type="button" onClick={onClose} aria-label="Close cart">
          Close
        </button>
      </div>
      <div className="cart-items">
        {cart.length ? (
          cart.map((item) => (
            <article key={item.product_id} className="cart-item">
              <div className="cart-thumb">
                {item.image_url ? <Image src={item.image_url} alt={item.name} fill sizes="64px" /> : null}
              </div>
              <div>
                <h3>{item.name}</h3>
                {item.category ? <span className="cart-item-meta">{item.category}</span> : null}
                <p>{formatMoney({ amount: item.price, currency: item.currency })}</p>
                {item.summary ? <p className="cart-item-summary">{item.summary}</p> : null}
                {item.url ? (
                  <a className="cart-item-link" href={item.url} target="_blank" rel="noreferrer">
                    View product
                  </a>
                ) : null}
                <div className="quantity-row">
                  <button type="button" onClick={() => onUpdateQuantity(item.product_id, item.quantity - 1)}>
                    -
                  </button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => onUpdateQuantity(item.product_id, item.quantity + 1)}>
                    +
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <p className="empty-cart">No items yet.</p>
        )}
      </div>
      <div className="cart-footer">
        <strong>{formatMoney({ amount: total, currency })}</strong>
        <button type="button" disabled={!cart.length} onClick={onCheckout}>
          Proceed to checkout
        </button>
      </div>
    </aside>
  );
}

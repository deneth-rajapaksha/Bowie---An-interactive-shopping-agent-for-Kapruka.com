"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";
import type { OrderResult } from "@/lib/types";

export function OrderSummaryCard({ order }: { order: OrderResult }) {
  const expiresAt = useMemo(() => new Date(order.expires_at).getTime(), [order.expires_at]);
  const [remainingMs, setRemainingMs] = useState(Math.max(0, expiresAt - Date.now()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingMs(Math.max(0, expiresAt - Date.now()));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  const currency = order.summary.currency;

  return (
    <section className="info-card order-card">
      <div className="order-heading">
        <div>
          <span>Checkout ready</span>
          <h3>{order.order_ref}</h3>
        </div>
        <b>
          {minutes}:{seconds.toString().padStart(2, "0")}
        </b>
      </div>
      <dl className="summary-list">
        <div>
          <dt>Items</dt>
          <dd>{formatMoney({ amount: order.summary.items_total, currency })}</dd>
        </div>
        <div>
          <dt>Delivery</dt>
          <dd>{formatMoney({ amount: order.summary.delivery_fee, currency })}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{formatMoney({ amount: order.summary.grand_total, currency })}</dd>
        </div>
      </dl>
      <a className="checkout-button" href={order.checkout_url} target="_blank" rel="noopener noreferrer">
        Complete payment on Kapruka.com
      </a>
    </section>
  );
}

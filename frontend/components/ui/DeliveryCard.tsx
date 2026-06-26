import type { DeliveryResult } from "@/lib/types";
import { formatMoney } from "@/lib/format";

export function DeliveryCard({ delivery }: { delivery: DeliveryResult }) {
  return (
    <section className={`info-card delivery-card ${delivery.available ? "available" : "unavailable"}`}>
      <div>
        <span>{delivery.available ? "Available" : "Unavailable"}</span>
        <h3>
          Delivery to {delivery.city} on {delivery.checked_date}
        </h3>
      </div>
      {delivery.available ? (
        <strong>{formatMoney({ amount: delivery.rate, currency: delivery.currency })}</strong>
      ) : (
        <p>{delivery.reason || "This city or date is not available."}</p>
      )}
      {delivery.next_available_date ? <p>Next available: {delivery.next_available_date}</p> : null}
      {delivery.perishable_warning ? <p className="warning-note">{delivery.perishable_warning}</p> : null}
    </section>
  );
}

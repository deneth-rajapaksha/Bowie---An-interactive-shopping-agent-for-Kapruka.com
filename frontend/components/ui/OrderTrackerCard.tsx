import type { TrackingResult } from "@/lib/types";

export function OrderTrackerCard({ tracking }: { tracking: TrackingResult }) {
  return (
    <section className="info-card tracker-card">
      <span>{tracking.status_display}</span>
      <h3>Order {tracking.order_number}</h3>
      <div className="tracker-steps">
        {tracking.progress.map((step) => (
          <div key={step.label} className={step.completed ? "done" : ""}>
            <i />
            <span>{step.label}</span>
            {step.timestamp ? <small>{step.timestamp}</small> : null}
          </div>
        ))}
      </div>
      {tracking.recipient?.city ? <p>Recipient city: {tracking.recipient.city}</p> : null}
    </section>
  );
}

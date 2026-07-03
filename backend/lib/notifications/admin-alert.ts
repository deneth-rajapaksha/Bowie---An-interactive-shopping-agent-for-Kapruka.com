import type { ConversationFeedback } from "@/lib/observability/langfuse";
import { getLangfuseTraceUrl } from "@/lib/observability/langfuse";

type AlertWebhookKind = "discord" | "slack";

export async function sendUnsatisfiedConversationAlert(feedback: ConversationFeedback) {
  if (!feedback.reason) return { sent: false, skipped: "missing_reason" };
  const webhookUrl = process.env.ADMIN_ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return { sent: false, skipped: "webhook_not_configured" };

  const kind = getWebhookKind(webhookUrl);
  const payload = buildAlertPayload(kind, feedback);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return {
        sent: false,
        skipped: "webhook_send_failed",
        status: response.status,
        detail: await safeReadResponseText(response)
      };
    }
  } catch (error) {
    console.error("Bowie admin alert webhook failed", getWebhookErrorSummary(error));
    return {
      sent: false,
      skipped: "webhook_send_failed",
      error: error instanceof Error ? error.message : "Unknown webhook error"
    };
  }

  return { sent: true, channel: kind };
}

function getWebhookKind(webhookUrl: string): AlertWebhookKind {
  const configuredKind = process.env.ADMIN_ALERT_WEBHOOK_TYPE?.trim().toLowerCase();
  if (configuredKind === "slack" || configuredKind === "discord") return configuredKind;

  return webhookUrl.includes("discord.com/api/webhooks") ? "discord" : "slack";
}

function buildAlertPayload(kind: AlertWebhookKind, feedback: ConversationFeedback) {
  const traceUrl = getLangfuseTraceUrl(feedback.traceId);
  const reason = truncate(feedback.reason ?? "", 1000);
  const context = [
    `Trace: ${traceUrl}`,
    `Trace ID: ${feedback.traceId}`,
    `Conversation ID: ${feedback.conversationId ?? "unknown"}`,
    `Message ID: ${feedback.messageId ?? "unknown"}`,
    `User ID: ${feedback.userId ?? "unknown"}`
  ].join("\n");

  if (kind === "discord") {
    return {
      username: "Bowie Alerts",
      embeds: [
        {
          title: "Unsatisfactory Bowie response",
          description: reason,
          url: traceUrl,
          color: 15158332,
          fields: [
            { name: "Trace ID", value: codeBlock(feedback.traceId), inline: false },
            { name: "Conversation", value: codeBlock(feedback.conversationId ?? "unknown"), inline: true },
            { name: "User", value: codeBlock(feedback.userId ?? "unknown"), inline: true }
          ]
        }
      ]
    };
  }

  return {
    text: "Unsatisfactory Bowie response",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Unsatisfactory Bowie response*\n${reason}`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: context
        }
      }
    ]
  };
}

function codeBlock(value: string) {
  return `\`${truncate(value, 900)}\``;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

async function safeReadResponseText(response: Response) {
  try {
    return truncate(await response.text(), 500);
  } catch {
    return "";
  }
}

function getWebhookErrorSummary(error: unknown) {
  if (!error || typeof error !== "object") {
    return { value: String(error) };
  }

  const data = error as {
    code?: unknown;
    message?: unknown;
  };

  return {
    code: data.code,
    message: typeof data.message === "string" ? data.message : undefined
  };
}

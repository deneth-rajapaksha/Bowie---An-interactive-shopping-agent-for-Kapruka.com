import { LangfuseClient } from "@langfuse/client";

export const NORMAL_TRACE_TTL_DAYS = 14;
export const NORMAL_TRACE_TAG = "bowie-normal";
export const UNSATISFIED_TRACE_TAG = "bowie-unsatisfied";

let langfuseClient: LangfuseClient | null | undefined;

export type ConversationFeedback = {
  traceId: string;
  conversationId?: string;
  messageId?: string;
  userId?: string;
  rating: "like" | "dislike";
  reason?: string;
  conversation?: unknown;
  assistantMessage?: unknown;
};

type TraceUpdate = {
  traceId: string;
  name?: string;
  sessionId?: string;
  userId?: string;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  tags?: string[];
  level?: string;
  statusMessage?: string;
};

export function isLangfuseEnabled() {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

export function getLangfuseClient() {
  if (langfuseClient !== undefined) return langfuseClient;

  if (!isLangfuseEnabled()) {
    langfuseClient = null;
    return langfuseClient;
  }

  langfuseClient = new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com"
  });

  return langfuseClient;
}

export function getTraceRetentionExpiresAt(now = new Date()) {
  return new Date(now.getTime() + NORMAL_TRACE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function getLangfuseTraceUrl(traceId: string) {
  const baseUrl = process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com";
  return `${baseUrl.replace(/\/$/, "")}/trace/${traceId}`;
}

export async function upsertLangfuseTrace(update: TraceUpdate) {
  const client = getLangfuseClient();
  if (!client) return { stored: false };

  await client.api.ingestion.batch({
    batch: [
      {
        id: crypto.randomUUID(),
        type: "trace-create",
        timestamp: new Date().toISOString(),
        body: {
          id: update.traceId,
          timestamp: new Date().toISOString(),
          name: update.name,
          sessionId: update.sessionId,
          userId: update.userId,
          input: update.input,
          output: update.output,
          tags: update.tags,
          environment: process.env.LANGFUSE_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
          metadata: {
            ...(isRecord(update.metadata) ? update.metadata : { metadata: update.metadata }),
            level: update.level,
            statusMessage: update.statusMessage
          }
        }
      }
    ]
  });

  return { stored: true };
}

export async function scoreConversationFeedback(feedback: ConversationFeedback) {
  const client = getLangfuseClient();
  if (!client) return { stored: false };

  const isDislike = feedback.rating === "dislike";

  client.score.create({
    traceId: feedback.traceId,
    name: "user_feedback",
    value: isDislike ? -1 : 1,
    dataType: "NUMERIC",
    comment: getFeedbackComment(feedback),
    metadata: {
      rating: feedback.rating,
      messageId: feedback.messageId,
      userId: feedback.userId,
      conversationId: feedback.conversationId,
      reason: feedback.reason,
      reasonPending: isDislike && !feedback.reason,
      requiresAdminReview: isDislike,
      retentionPolicy: isDislike ? "manual_admin_delete_only" : "auto_delete_after_14_days",
      conversation: isDislike ? feedback.conversation : undefined,
      assistantMessage: isDislike ? feedback.assistantMessage : undefined
    }
  });

  await client.flush();
  return { stored: true };
}

export async function traceHasUnsatisfiedFeedback(traceId: string) {
  const client = getLangfuseClient();
  if (!client) return false;

  const scores = await client.api.scores.getMany({
    traceId,
    name: "user_feedback",
    operator: "<",
    value: 0,
    limit: 1,
    fields: "score"
  });

  return scores.data.length > 0;
}

function getFeedbackComment(feedback: ConversationFeedback) {
  if (feedback.rating === "like") return "User liked this response.";
  if (feedback.reason) return `User disliked this response: ${feedback.reason}`;
  return "User disliked this response; reason pending.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

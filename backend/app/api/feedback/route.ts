import { z } from "zod";

import { scoreConversationFeedback } from "@/lib/observability/langfuse";
import { sendUnsatisfiedConversationAlert } from "@/lib/notifications/admin-alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  traceId: z.string().min(1),
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  userId: z.string().optional(),
  rating: z.enum(["like", "dislike"]),
  reason: z.string().trim().min(1).optional(),
  conversation: z.unknown().optional(),
  assistantMessage: z.unknown().optional()
});

const DISLIKE_REASON_PROMPT =
  "I am sorry that missed the mark. If possible, could you share what went wrong or what you expected instead? Your note goes straight to an admin so we can improve Bowie.";

export async function POST(req: Request) {
  const parsed = feedbackSchema.safeParse(await req.json());

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid feedback payload", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const feedback = parsed.data;
  const scoreResult = await scoreConversationFeedback(feedback);

  if (feedback.rating === "dislike" && !feedback.reason) {
    return Response.json(
      {
        ok: true,
        stored: scoreResult.stored,
        requiresReason: true,
        prompt: DISLIKE_REASON_PROMPT
      },
      { status: 202 }
    );
  }

  const alertResult =
    feedback.rating === "dislike"
      ? await sendUnsatisfiedConversationAlert(feedback)
      : { sent: false };

  return Response.json({
    ok: true,
    stored: scoreResult.stored,
    requiresReason: false,
    adminAlert: alertResult
  });
}

import type { CoreMessage } from "ai";

const DEFAULT_MAX_HISTORY_TOKENS = 900;
const APPROX_CHARS_PER_TOKEN = 4;

export function trimHistory(
  messages: CoreMessage[],
  keepLast = 8,
  maxTokens = DEFAULT_MAX_HISTORY_TOKENS
): CoreMessage[] {
  const sanitized = messages.map(cleanMessage).filter(hasContent);
  const recent = sanitized.slice(-keepLast);
  const selected: CoreMessage[] = [];
  let usedTokens = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const tokens = estimateMessageTokens(message);
    if (selected.length > 0 && usedTokens + tokens > maxTokens) break;

    selected.unshift(message);
    usedTokens += tokens;
  }

  return selected;
}

function cleanMessage(message: CoreMessage): CoreMessage {
  if (typeof message.content === "string") {
    return { ...message, content: message.content.trim() } as CoreMessage;
  }

  if (!Array.isArray(message.content)) return message;

  return {
    ...message,
    content: message.content.filter((part) => {
      if ("text" in part) return part.text.trim().length > 0;
      return true;
    })
  } as CoreMessage;
}

function hasContent(message: CoreMessage) {
  if (typeof message.content === "string") return message.content.length > 0;
  if (!Array.isArray(message.content)) return true;
  return message.content.length > 0;
}

function estimateMessageTokens(message: CoreMessage) {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
          .map((part) => ("text" in part ? part.text : JSON.stringify(part)))
          .join("\n")
        : JSON.stringify(message.content);

  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN) + 8;
}

"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ArrowUp, CirclePlus } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { QuickReplyChips } from "@/components/chat/QuickReplyChips";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { CartDrawer } from "@/components/ui/CartDrawer";
import { parseToolResults, extractQuickReplies } from "@/lib/message-renderer";
import { formatMoney, safeId } from "@/lib/format";
import type { CartItem, ChatMessage, ProductSummary } from "@/lib/types";

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Hi, I am Bowie, your Kapruka shopping guide. Tell me who you are shopping for, the occasion, city, and budget if you have one.",
    quickReplies: ["Birthday cake", "Flowers to Colombo", "Browse categories"]
  }
];

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isWakingModel, setIsWakingModel] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [conversationId, setConversationId] = useState(() => safeId("conversation"));
  const [pendingDislike, setPendingDislike] = useState<{
    traceId: string;
    conversationId?: string;
    messageId: string;
    assistantMessage: ChatMessage;
  } | null>(null);
  const messageScrollRef = useRef<HTMLElement | null>(null);

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const cartCurrency = cart[0]?.currency || "LKR";

  useEffect(() => {
    if (!isSending) {
      setIsWakingModel(false);
      return;
    }

    const timer = window.setTimeout(() => setIsWakingModel(true), 2500);
    return () => window.clearTimeout(timer);
  }, [isSending]);

  useEffect(() => {
    const scrollArea = messageScrollRef.current;
    if (!scrollArea) return;

    scrollArea.scrollTo({
      top: scrollArea.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, isSending]);

  async function sendMessage(rawMessage: string) {
    const message = rawMessage.trim();
    if (!message || isSending) return;

    const userMessage: ChatMessage = {
      id: safeId("user"),
      role: "user",
      content: message
    };

    if (pendingDislike) {
      const snapshot = [...messages, userMessage];
      setMessages((current) => [...current, userMessage]);
      setInput("");
      setIsSending(true);

      try {
        await sendFeedbackRequest({
          rating: "dislike",
          traceId: pendingDislike.traceId,
          conversationId: pendingDislike.conversationId,
          messageId: pendingDislike.messageId,
          reason: message,
          assistantMessage: compactMessage(pendingDislike.assistantMessage),
          conversation: snapshot.map(compactMessage)
        });

        setMessages((current) => [
          ...current.map((chatMessage) =>
            chatMessage.id === pendingDislike.messageId
              ? { ...chatMessage, feedback: "disliked" as const }
              : chatMessage
          ),
          {
            id: safeId("assistant"),
            role: "assistant",
            content: "Thanks for telling me. I flagged that response with your note so an admin can review it."
          }
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            id: safeId("assistant"),
            role: "assistant",
            content:
              error instanceof Error
                ? error.message
                : "I could not send that feedback right now. Please try again in a moment."
          }
        ]);
      } finally {
        setPendingDislike(null);
        setIsSending(false);
      }

      return;
    }

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          messages: buildModelMessages([...messages, userMessage]),
          conversationId,
          cart
        })
      });

      if (!response.ok) {
        const detail = await readErrorDetail(response);
        throw new Error(detail || "Chat request failed.");
      }

      const payload = (await response.json()) as {
        text?: string;
        toolResults?: Parameters<typeof parseToolResults>[0];
        quickReplies?: string[];
        conversationId?: string;
        traceId?: string;
      };

      if (payload.conversationId && payload.conversationId !== conversationId) {
        setConversationId(payload.conversationId);
      }

      const text = payload.text || "I had trouble reading that result. Try asking again in a simpler way.";
      const quickReplyData = extractQuickReplies(text);
      const assistantMessage: ChatMessage = {
        id: safeId("assistant"),
        role: "assistant",
        content: quickReplyData.clean,
        blocks: parseToolResults(payload.toolResults),
        quickReplies: payload.quickReplies ?? quickReplyData.chips,
        traceId: payload.traceId,
        conversationId: payload.conversationId ?? conversationId
      };

      setMessages((current) => [...current, assistantMessage]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: safeId("assistant"),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Something got tangled while I was checking Kapruka. Please try once more, or ask me to browse categories.",
          quickReplies: ["Browse categories", "Search cakes", "Track an order"]
        }
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function addProduct(product: ProductSummary) {
    setCart((current) => {
      const existing = current.find((item) => item.product_id === product.id);
      if (existing) {
        return current.map((item) =>
          item.product_id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }

      return [
        ...current,
        {
          product_id: product.id,
          name: product.name,
          price: product.price.amount,
          currency: product.price.currency,
          image_url: product.image_url,
          quantity: 1
        }
      ];
    });
    setCartOpen(true);
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((current) =>
      quantity <= 0
        ? current.filter((item) => item.product_id !== productId)
        : current.map((item) => (item.product_id === productId ? { ...item, quantity } : item))
    );
  }

  async function handleFeedback(message: ChatMessage, rating: "like" | "dislike") {
    if (!message.traceId || isSending) return;

    const nextFeedback = rating === "like" ? "liked" : "reason-pending";
    setMessages((current) =>
      current.map((chatMessage) =>
        chatMessage.id === message.id ? { ...chatMessage, feedback: nextFeedback } : chatMessage
      )
    );

    try {
      const payload = await sendFeedbackRequest({
        rating,
        traceId: message.traceId,
        conversationId: message.conversationId ?? conversationId,
        messageId: message.id,
        assistantMessage: compactMessage(message),
        conversation: messages.map(compactMessage)
      });

      if (rating === "dislike" && payload.requiresReason) {
        setPendingDislike({
          traceId: message.traceId,
          conversationId: message.conversationId ?? conversationId,
          messageId: message.id,
          assistantMessage: message
        });
        setMessages((current) => [
          ...current,
          {
            id: safeId("assistant"),
            role: "assistant",
            content:
              payload.prompt ||
              "I am sorry that missed the mark. If possible, could you share what went wrong?"
          }
        ]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: safeId("assistant"),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "I could not send that feedback right now. Please try again in a moment."
        }
      ]);
    }
  }

  const latestQuickReplies = messages.at(-1)?.quickReplies ?? [];

  return (
    <main className="chat-shell">
      <aside className="side-rail" aria-label="Bowie navigation">
        <div className="brand-lockup">
          <Image src="/bowie_ai_mascot_logo.png" alt="Bowie mascot" width={34} height={34} priority />
          <div>
            <strong>Bowie</strong>
            <span>Organic Guide</span>
          </div>
        </div>

        <button
          className="new-chat-button"
          type="button"
          onClick={() => {
            setMessages(starterMessages);
            setConversationId(safeId("conversation"));
            setPendingDislike(null);
          }}
        >
          <span aria-hidden="true">+</span>
          Start New Chat
        </button>

        <section className="mini-cart-card" aria-label="Cart summary">
          <div className="mini-cart-title">Your Cart</div>
          <div>
            <span>
              {cartCount || 0} item{cartCount === 1 ? "" : "s"}
            </span>
            <strong>{formatMoney({ amount: cartTotal, currency: cartCurrency })}</strong>
          </div>
          <button type="button" onClick={() => setCartOpen(true)}>
            View Cart
          </button>
        </section>

        <button className="settings-button" type="button">
          Settings
        </button>
      </aside>

      <div className="chat-main">
        <header className="top-bar">
          <div>
            <strong>Bowie</strong>
            <span>Kapruka shopping chat</span>
          </div>
          <button className="cart-button" type="button" onClick={() => setCartOpen(true)} aria-label="Open cart">
            <span aria-hidden="true">Cart</span>
            <b>{cartCount}</b>
          </button>
        </header>

        <section ref={messageScrollRef} className="message-scroll" aria-live="polite">
          <div className="message-stack">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onAddToCart={addProduct}
                onSendMessage={sendMessage}
                onFeedback={handleFeedback}
              />
            ))}
            {isSending ? <TypingIndicator isWaking={isWakingModel} /> : null}
          </div>
        </section>

        <footer className="input-panel">
          <QuickReplyChips chips={latestQuickReplies} onSelect={sendMessage} disabled={isSending} />
          <form className="input-bar" onSubmit={handleSubmit}>
            <button className="input-tool-button" type="button" aria-label="Add more context">
              <CirclePlus size={22} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <label className="sr-only" htmlFor="bowie-input">
              Message Bowie
            </label>
            <input
              id="bowie-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask Bowie anything about your home office..."
              disabled={isSending}
            />
            <button className="input-send-button" type="submit" disabled={isSending || input.trim().length === 0}>
              <ArrowUp size={22} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </form>
        </footer>

        <CartDrawer
          open={cartOpen}
          cart={cart}
          onClose={() => setCartOpen(false)}
          onUpdateQuantity={updateQuantity}
          onCheckout={() => {
            setCartOpen(false);
            void sendMessage("Proceed to checkout");
          }}
        />
      </div>
    </main>
  );
}

function buildModelMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: appendProductCardContext(message)
  }));
}

function appendProductCardContext(message: ChatMessage) {
  const productBlocks = message.blocks?.filter((block) => block.type === "product_list") ?? [];
  if (!productBlocks.length) return message.content;

  const productContext = productBlocks
    .flatMap((block, blockIndex) => {
      const searchContext = `[search ${blockIndex + 1}] query=${block.query || ""}; next_cursor=${
        block.next_cursor || ""
      }`;

      return [
        searchContext,
        ...block.products.map((product, index) => {
          const price = product.price ? formatMoney(product.price) : "price unavailable";
          return `[card ${index + 1}] id=${product.id}; name=${product.name}; price=${price}; stock=${
            product.in_stock ? "in stock" : "sold out"
          }; url=${product.url}`;
        })
      ];
    })
    .join("\n");

  return `${message.content}\n\n<!--PRODUCT_CONTEXT:\nProduct cards shown to the user:\n${productContext}\n-->`;
}

async function readErrorDetail(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: string; error?: string };
      return cleanErrorText(payload.detail || payload.error || "");
    }

    return cleanErrorText(await response.text());
  } catch {
    return "";
  }
}

function cleanErrorText(text: string) {
  if (!text) return "";

  const withoutHtml = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return withoutHtml.length > 400 ? `${withoutHtml.slice(0, 397).trim()}...` : withoutHtml;
}

function compactMessage(message: ChatMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    blocks: message.blocks,
    quickReplies: message.quickReplies,
    traceId: message.traceId,
    conversationId: message.conversationId,
    feedback: message.feedback
  };
}

async function sendFeedbackRequest(payload: {
  rating: "like" | "dislike";
  traceId: string;
  conversationId?: string;
  messageId?: string;
  reason?: string;
  conversation?: unknown;
  assistantMessage?: unknown;
}) {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || "Feedback request failed.");
  }

  return (await response.json()) as { requiresReason?: boolean; prompt?: string };
}

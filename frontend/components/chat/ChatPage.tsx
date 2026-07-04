"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ArrowUp, CirclePlus, GitBranch, Globe2, Settings, X } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { QuickReplyChips } from "@/components/chat/QuickReplyChips";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { CartDrawer } from "@/components/ui/CartDrawer";
import { parseToolResults, extractQuickReplies } from "@/lib/message-renderer";
import { formatMoney, safeId } from "@/lib/format";
import type { AddressCandidate, AddressLookupResult, CartItem, ChatMessage, ProductSummary } from "@/lib/types";

type LanguageCode = "en" | "si" | "ta";

const languageOptions: Array<{ code: LanguageCode; label: string; nativeLabel: string }> = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "si", label: "Sinhala", nativeLabel: "සිංහල" },
  { code: "ta", label: "Tamil", nativeLabel: "தமிழ்" }
];

const starterMessagesByLanguage: Record<LanguageCode, ChatMessage> = {
  en: {
    id: "welcome-en",
    role: "assistant",
    content:
      "Hi! I am Bowie. I can help you pick a great gift from Kapruka. Who are you shopping for? What is the occasion? Tell me the delivery city and your budget too, if you have one.",
    quickReplies: ["Birthday cake", "Flowers to Colombo", "Browse categories"]
  },
  si: {
    id: "welcome-si",
    role: "assistant",
    content:
      "ආයුබෝවන්! මම Bowie. Kapruka එකෙන් හොඳම තෑග්ගක් තෝරගන්න මම ඔයාට උදව් කරන්නම්. කාටද තෑග්ගක් ගන්න හදන්නේ? මොකක්ද අවස්ථාව? ඒ වගේම ඩිලිවරි කරන්න ඕන නගරය සහ ඔයාගේ බජට් එකත් මට කියන්න.",
    quickReplies: ["උපන්දින කේක්", "කොළඹට මල් ඩිලිවරි", "වෙනත් කාණ්ඩ බලන්න"]
  },
  ta: {
    id: "welcome-ta",
    role: "assistant",
    content:
      "வணக்கம்! நான் Bowie. Kapruka-ல சூப்பரான ஒரு கிஃப்ட் செலக்ட் பண்ண நான் உங்களுக்கு ஹெல்ப் பண்றேன். யாருக்கு கிஃப்ட் வாங்க போறீங்க? என்ன விசேஷம்? அப்படியே டெலிவரி பண்ண வேண்டிய சிட்டி, உங்க பட்ஜெட் என்னனு என்கிட்ட சொல்லுங்க.",
    quickReplies: ["பிறந்தநாள் கேக்", "கொழும்புக்கு மலர்கள்", "மற்ற பிரிவுகளைப் பார்க்க"]
  }
};

function createStarterMessages(language: LanguageCode): ChatMessage[] {
  return [{ ...starterMessagesByLanguage[language], id: safeId(`welcome-${language}`) }];
}

function getCheckoutIntentLabel(language: LanguageCode) {
  if (language === "si") return "Checkout යන්න";
  if (language === "ta") return "Checkout போக";
  return "Proceed to checkout";
}

function getAddToCartReply(language: LanguageCode, productName?: string) {
  if (!productName) {
    if (language === "si") return "Add කරන්න product card එකක් තවම හමු වුණේ නැහැ. මුලින් product card එකක් තෝරන්න.";
    if (language === "ta") return "Add செய்ய product card இன்னும் கிடைக்கவில்லை. முதலில் ஒரு product card தேர்ந்தெடுக்கவும்.";
    return "I could not find a product card to add yet. Pick a product card first, then I can add it to your cart.";
  }

  if (language === "si") return `${productName} cart එකට add කළා. තව බලන්න පුළුවන්, නැත්නම් ලෑස්ති නම් checkout යන්න.`;
  if (language === "ta") return `${productName} cart-க்கு add செய்துவிட்டேன். இன்னும் பார்க்கலாம், இல்லையெனில் தயாராக இருந்தால் checkout போகலாம்.`;
  return `Added ${productName} to your cart. You can keep browsing or proceed to checkout when you are ready.`;
}

function getAddToCartQuickReplies(language: LanguageCode, hasProduct: boolean) {
  if (!hasProduct) {
    if (language === "si") return ["Categories බලන්න", "Cakes search කරන්න", "Top result බලන්න"];
    if (language === "ta") return ["Categories பார்க்க", "Cakes search செய்ய", "Top result பார்க்க"];
    return ["Browse categories", "Search cakes", "View top result"];
  }

  if (language === "si") return ["Checkout යන්න", "Similar බලන්න", "තව item එකක් add කරන්න"];
  if (language === "ta") return ["Checkout போக", "Similar பார்க்க", "இன்னொரு item add செய்ய"];
  return ["Proceed to checkout", "See similar", "Add another item"];
}

export function ChatPage() {
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode | null>(null);
  const [chatLanguage, setChatLanguage] = useState<LanguageCode>("en");
  const [messages, setMessages] = useState<ChatMessage[]>(() => createStarterMessages("en"));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isWakingModel, setIsWakingModel] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [conversationId, setConversationId] = useState(() => safeId("conversation"));
  const [pendingAddressLookup, setPendingAddressLookup] = useState<{
    originalMessage: string;
    lookup: AddressLookupResult;
  } | null>(null);
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
  const hasEnteredChat = selectedLanguage !== null;

  useEffect(() => {
    document.documentElement.dataset.theme = "light";
  }, []);

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

  function selectLanguage(language: LanguageCode) {
    setSelectedLanguage(language);
    setChatLanguage(language);
    setMessages(createStarterMessages(language));
    setConversationId(safeId("conversation"));
    setPendingAddressLookup(null);
    setPendingDislike(null);
  }

  function changeChatLanguage(language: LanguageCode) {
    setChatLanguage(language);
    setSelectedLanguage((current) => current ?? language);

    const hasUserMessages = messages.some((message) => message.role === "user");
    if (!hasUserMessages) {
      setMessages(createStarterMessages(language));
    }
  }

  async function sendMessage(
    rawMessage: string,
    options: { displayMessage?: string; skipAddressLookup?: boolean } = {}
  ) {
    const message = rawMessage.trim();
    if (!message || isSending) return;

    const userMessage: ChatMessage = {
      id: safeId("user"),
      role: "user",
      content: options.displayMessage ?? message,
      modelContent: options.displayMessage ? message : undefined
    };

    if (isAddToCartIntent(message)) {
      const product = findProductForAddIntent(messages, message);

      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: safeId("assistant"),
          role: "assistant",
          content: getAddToCartReply(chatLanguage, product?.name),
          quickReplies: getAddToCartQuickReplies(chatLanguage, Boolean(product))
        }
      ]);
      setInput("");

      if (product) {
        addProduct(product);
      }

      return;
    }

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

    if (!options.skipAddressLookup && shouldSaveRomanizedCheckoutAddress(message, chatLanguage, messages, cart)) {
      void sendMessage(buildDirectAddressConfirmedMessage(message), {
        displayMessage: message,
        skipAddressLookup: true
      });
      return;
    }

    if (!options.skipAddressLookup && shouldStartLocalizedAddressLookup(message, chatLanguage, messages, cart)) {
      setMessages((current) => [...current, userMessage]);
      setInput("");
      setIsSending(true);

      try {
        const lookup = await lookupLocalizedAddress(message, chatLanguage);

        if (!lookup.candidates.length) {
          setMessages((current) => [
            ...current,
            {
              id: safeId("assistant"),
              role: "assistant",
              content:
                "I could not find that address in Google Places. Please retype the delivery address with the nearest town or landmark."
            }
          ]);
          return;
        }

        setPendingAddressLookup({ originalMessage: message, lookup });
        setMessages((current) => [
          ...current,
          {
            id: safeId("assistant"),
            role: "assistant",
            content: "I found these matching addresses. Please confirm the correct one before I continue checkout.",
            blocks: [{ type: "address_confirmation", lookup }]
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
                : "I could not confirm that address right now. Please try again in English or include a nearby town."
          }
        ]);
      } finally {
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
          cart,
          language: chatLanguage
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
        modelContent: text,
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

  function sendQuickReply(chip: string) {
    if (chip === getCheckoutIntentLabel(chatLanguage)) {
      void sendMessage("Proceed to checkout", { displayMessage: chip });
      return;
    }

    void sendMessage(chip);
  }

  function confirmLocalizedAddress(candidate: AddressCandidate) {
    if (!pendingAddressLookup) return;

    const confirmedMessage = buildConfirmedAddressMessage(pendingAddressLookup.lookup, candidate);
    setPendingAddressLookup(null);
    void sendMessage(confirmedMessage, {
      displayMessage: `Use this address: ${candidate.mcpAddress || candidate.formattedAddress}`,
      skipAddressLookup: true
    });
  }

  function editLocalizedAddress() {
    setPendingAddressLookup(null);
    setInput(pendingAddressLookup?.originalMessage ?? "");
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
          summary: product.summary,
          price: product.price.amount,
          currency: product.price.currency,
          image_url: product.image_url,
          category: typeof product.category === "string" ? product.category : "",
          url: product.url,
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
    <main className={`experience-frame ${hasEnteredChat ? "show-chat" : ""}`}>
      <section className="intro-screen" aria-label="Choose language">
        <nav className="intro-nav" aria-label="Bowie links">
          <div className="intro-logo">
            <Image src="/bowie_ai_mascot_logo.png" alt="Bowie mascot" width={34} height={34} priority />
            <strong>Bowie</strong>
          </div>
          <div className="intro-links">
            <a
              href="https://github.com/deneth-rajapaksha/Bowie---An-interactive-shopping-agent-for-Kapruka.com"
              target="_blank"
              rel="noreferrer"
            >
              <GitBranch size={17} strokeWidth={2} aria-hidden="true" />
              <span>GitHub Repo</span>
            </a>
            <a href="https://www.denethrajapaksha.com" target="_blank" rel="noreferrer">
              <Globe2 size={17} strokeWidth={2} aria-hidden="true" />
              <span>Portfolio</span>
            </a>
            <button className="intro-settings-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings">
              <Settings size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </nav>

        <div className="intro-hero">
          <div className="intro-media" aria-hidden="true">
            <img className="intro-branch-image" src="/bowie-branch-mascot.png" alt="" />
          </div>

          <div className="intro-copy">
            <p className="intro-kicker">Interactive AI Agentic Shopping Experience</p>
            <h1>
              Your Wish,
              <span>Through Our Branch.</span>
            </h1>
            <p>
              Kapruka is Inspired from a wish granting the Project Bowie is a conversational shopping assistant for
              Kapruka. Inspired by the main branch of a tree, Bowie represents the connection that reaches toward you,
              understands your wishes, and turns them into reality. Click the language you want to continue.
            </p>
            <div className="language-buttons" aria-label="Language choices">
              {languageOptions.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  aria-label={language.label}
                  onClick={() => selectLanguage(language.code)}
                >
                  <span>{language.nativeLabel}</span>
                  {language.nativeLabel !== language.label ? <small>{language.label}</small> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="chat-screen" aria-label="Bowie chat">
        <div className="chat-shell">
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
                setMessages(createStarterMessages(chatLanguage));
                setConversationId(safeId("conversation"));
                setPendingAddressLookup(null);
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

            <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)}>
              <Settings size={17} strokeWidth={2} aria-hidden="true" />
              Settings
            </button>
          </aside>

          <div className="chat-main">
            <header className="top-bar">
              <div>
                <strong>Bowie</strong>
                <span>Kapruka shopping chat</span>
              </div>
              <div className="top-actions">
                <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings">
                  <Settings size={18} strokeWidth={2} aria-hidden="true" />
                </button>
                <button className="cart-button" type="button" onClick={() => setCartOpen(true)} aria-label="Open cart">
                  <span aria-hidden="true">Cart</span>
                  <b>{cartCount}</b>
                </button>
              </div>
            </header>

            <section ref={messageScrollRef} className="message-scroll" aria-live="polite">
              <div className="message-stack">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onAddToCart={addProduct}
                    onSendMessage={sendMessage}
                    onConfirmAddress={confirmLocalizedAddress}
                    onEditAddress={editLocalizedAddress}
                    onFeedback={handleFeedback}
                  />
                ))}
                {isSending ? <TypingIndicator isWaking={isWakingModel} /> : null}
              </div>
            </section>

            <footer className="input-panel">
              <QuickReplyChips chips={latestQuickReplies} onSelect={sendQuickReply} disabled={isSending} />
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
                  placeholder="Ask Bowie anything about Kapruka..."
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
                void sendMessage("Proceed to checkout", {
                  displayMessage: getCheckoutIntentLabel(chatLanguage)
                });
              }}
            />
          </div>
        </div>
      </section>

      <SettingsDialog
        open={settingsOpen}
        language={chatLanguage}
        onClose={() => setSettingsOpen(false)}
        onLanguageChange={changeChatLanguage}
      />
    </main>
  );
}

function SettingsDialog({
  open,
  language,
  onClose,
  onLanguageChange
}: {
  open: boolean;
  language: LanguageCode;
  onClose: () => void;
  onLanguageChange: (language: LanguageCode) => void;
}) {
  if (!open) return null;

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <section className="settings-panel">
        <header className="settings-header">
          <div>
            <h2 id="settings-title">Settings</h2>
            <p>Choose how Bowie looks and speaks.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close settings">
            <X size={19} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        <div className="settings-section">
          <h3>Appearance</h3>
          <div className="segmented-control" role="group" aria-label="Theme mode locked">
            <button type="button" className="active" disabled>
              Light
            </button>
            <button type="button" disabled>
              Dark
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>Language</h3>
          <div className="segmented-control language-control" role="group" aria-label="Chat language">
            {languageOptions.map((option) => (
              <button
                key={option.code}
                type="button"
                className={language === option.code ? "active" : ""}
                onClick={() => onLanguageChange(option.code)}
              >
                <span>{option.nativeLabel}</span>
                {option.nativeLabel !== option.label ? <small>{option.label}</small> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section privacy-note">
          <h3>Privacy Policy</h3>
          <p>
            We do not collect or sell user data. Normal conversations are not used to identify you. If a response is
            marked unsatisfied, that trace and your feedback note may be checked by admins so the answer can be reviewed
            and improved.
          </p>
        </div>
      </section>
    </div>
  );
}

function isAddToCartIntent(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    /\badd\b/.test(normalized) && /\b(cart|it|this|that|card|number|one|two|three|four|1|2|3|4)\b/.test(normalized)
  ) || /\bcart\s+(it|this|that|card|number|\d+)\b/.test(normalized);
}

function findProductForAddIntent(messages: ChatMessage[], request: string): ProductSummary | null {
  const requestedIndex = getRequestedCardIndex(request);

  for (const message of [...messages].reverse()) {
    const blocks = message.blocks ?? [];
    for (const block of [...blocks].reverse()) {
      if (block.type === "product_detail") return block.product;
      if (block.type === "product_list" && block.products.length) {
        return block.products[requestedIndex] ?? block.products[0];
      }
    }
  }

  return null;
}

function getRequestedCardIndex(request: string) {
  const normalized = request.toLowerCase();
  const explicit = normalized.match(/\b(?:card|number|no\.?)\s*(\d+)\b/);
  if (explicit) return Math.max(0, Number(explicit[1]) - 1);

  if (/\b(second|two|2)\b/.test(normalized)) return 1;
  if (/\b(third|three|3)\b/.test(normalized)) return 2;
  if (/\b(fourth|four|4)\b/.test(normalized)) return 3;
  return 0;
}

function buildModelMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: appendProductCardContext(message)
  }));
}

function appendProductCardContext(message: ChatMessage) {
  const content = message.modelContent ?? message.content;
  const productBlocks = message.blocks?.filter((block) => block.type === "product_list") ?? [];
  if (!productBlocks.length) return content;

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

  return `${content}\n\n<!--PRODUCT_CONTEXT:\nProduct cards shown to the user:\n${productContext}\n-->`;
}

function shouldStartLocalizedAddressLookup(message: string, _language: LanguageCode, messages: ChatMessage[], cart: CartItem[]) {
  if (!cart.length || message.includes("<!--ADDRESS_CONFIRMED")) return false;
  if (!isAwaitingCheckoutAddress(messages)) return false;
  if (_language !== "si" && _language !== "ta") return false;
  return containsSinhalaOrTamilScript(message);
}

function shouldSaveRomanizedCheckoutAddress(
  message: string,
  language: LanguageCode,
  messages: ChatMessage[],
  cart: CartItem[]
) {
  if (!cart.length || language === "en") return false;
  if (!isAwaitingCheckoutAddress(messages)) return false;
  if (containsSinhalaOrTamilScript(message)) return false;
  return message.trim().length >= 5;
}

function isAwaitingCheckoutAddress(messages: ChatMessage[]) {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return Boolean(latestAssistant && /<!--CHECKOUT_ADDRESS_REQUESTED-->/.test(latestAssistant.modelContent ?? latestAssistant.content));
}

function containsSinhalaOrTamilScript(value: string) {
  return /[\u0D80-\u0DFF\u0B80-\u0BFF]/.test(value);
}

function detectAddressLanguage(message: string, fallback: LanguageCode) {
  const sinhalaCount = Array.from(message.matchAll(/[\u0D80-\u0DFF]/g)).length;
  const tamilCount = Array.from(message.matchAll(/[\u0B80-\u0BFF]/g)).length;
  if (sinhalaCount || tamilCount) return sinhalaCount >= tamilCount ? "sinhala" : "tamil";
  return fallback === "ta" ? "tamil" : "sinhala";
}

async function lookupLocalizedAddress(message: string, language: LanguageCode) {
  const response = await fetch("/api/address", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: message,
      language: detectAddressLanguage(message, language)
    })
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || "Address lookup failed.");
  }

  return (await response.json()) as AddressLookupResult;
}

function buildConfirmedAddressMessage(lookup: AddressLookupResult, candidate: AddressCandidate) {
  const parsed = lookup.parsed;
  const city = candidate.city || parsed.city || "";
  const address = appendCityToAddress(candidate.mcpAddress || candidate.formattedAddress, city);
  const lines = [
    `Delivery Address: ${address}`,
    city ? `City: ${city}` : ""
  ].filter(Boolean);

  return `${lines.join("\n")}\n\n<!--ADDRESS_CONFIRMED: Google Places place_id=${
    candidate.placeId
  }; use this clean English delivery.address and delivery.city for Kapruka MCP. Ignore any earlier unconfirmed Sinhala/Tamil address text.-->`;
}

function buildDirectAddressConfirmedMessage(address: string) {
  const normalizedAddress = address.replace(/\s+/g, " ").trim();
  const city = extractCityFromRomanizedAddress(normalizedAddress);
  const lines = [
    `Delivery Address: ${normalizedAddress}`,
    city ? `City: ${city}` : ""
  ].filter(Boolean);

  return `${lines.join("\n")}\n\n<!--ADDRESS_CONFIRMED: User provided English/romanized address directly; use this delivery.address${
    city ? " and delivery.city" : ""
  } for Kapruka MCP. Do not run Google Places again for this address.-->`;
}

function appendCityToAddress(address: string, city: string) {
  const cleanAddress = address.replace(/\s+/g, " ").trim();
  const cleanCity = city.replace(/\s+/g, " ").trim();
  if (!cleanCity) return cleanAddress;
  if (new RegExp(`(?:^|,\\s*)${escapeRegExp(cleanCity)}$`, "i").test(cleanAddress)) return cleanAddress;
  return `${cleanAddress}, ${cleanCity}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCityFromRomanizedAddress(address: string) {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  const city = parts.at(-1) || "";
  return /\d/.test(city) && city.length > 20 ? "" : city;
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

  if (/fetch failed|error executing tool kapruka_search_products/i.test(withoutHtml)) {
    return "I could not reach Kapruka product search right now. Please try again in a moment.";
  }

  return withoutHtml.length > 400 ? `${withoutHtml.slice(0, 397).trim()}...` : withoutHtml;
}

function compactMessage(message: ChatMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    modelContent: message.modelContent,
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

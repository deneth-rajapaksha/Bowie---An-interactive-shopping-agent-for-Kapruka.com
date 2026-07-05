# Bowie: Kapruka Agentic Shopping Assistant

Bowie is an interactive shopping agent for Kapruka.com. It is built for real Sri Lankan ecommerce workflows: product discovery, delivery checks, cart-aware checkout, multilingual conversations, order tracking, user feedback, observability, and cached tool execution.

This is not a normal chatbot that only answers from its prompt. Bowie is a tool-using shopping agent. It searches live Kapruka data through MCP tools, confirms checkout details, protects order creation from ambiguous localized text, records response quality through a feedback loop, and uses Redis caching so repeated product and delivery lookups stay fast.

The project is split into two Next.js apps:

- `backend/`: agent API, model routing, Kapruka MCP tool execution, Google Places address lookup, Langfuse feedback/observability, Redis cache, security, and admin review workflows.
- `frontend/`: full-screen chat UI, language selection, product cards, cart drawer, checkout flow, address confirmation cards, feedback controls, and local proxy routes.

## Why Bowie Is Different

Generic chatbots usually answer from conversation context. Generic AI agents can use tools, but they often lack domain guardrails for a real checkout flow. Bowie is narrower and more practical: it is grounded in Kapruka MCP tools, guarded by schema validation, strengthened with Google Places address confirmation, measured through feedback traces, and accelerated with Redis.

### 1. Agent-first shopping, not prompt-only chat

Most shopping chatbots produce recommendations from text alone. Bowie grounds answers in Kapruka tools:

- `kapruka_search_products` for real products, prices, images, stock, and URLs.
- `kapruka_get_product` before answering item-specific questions.
- `kapruka_check_delivery` before promising delivery availability.
- `kapruka_create_order` only after required checkout fields are confirmed.
- `kapruka_track_order` for order status.

The backend validates tool arguments with Zod, compacts large tool results before showing them to the model, and blocks checkout creation if Sinhala or Tamil script leaks into fields that Kapruka expects in English or romanized form.

### 2. Multilingual Sri Lankan checkout with Google Maps address confirmation

Bowie supports English, Sinhala, Tamil, Singlish, Tanglish, and mixed-language chat. The hard part is checkout: translating Unicode addresses directly can reduce address accuracy because road names, localities, landmarks, and house details may be altered by translation.

To avoid that, Bowie uses a dedicated localized address workflow:

1. The frontend detects Sinhala or Tamil script while checkout is waiting for a delivery address.
2. The backend parses the message into a Google Places search query.
3. Google Places Autocomplete and Place Details return accurate Sri Lankan address candidates.
4. The user confirms the correct address in an address confirmation card with a Google Maps preview.
5. Bowie sends only the clean English or romanized `delivery.address` and `delivery.city` to Kapruka MCP.

This keeps the conversation natural for Sinhala and Tamil users while protecting checkout accuracy.

Required backend env:

```env
GOOGLE_PLACES_API_KEY=
# or
GOOGLE_MAPS_API_KEY=
```

### 3. LangChain-style feedback loop for quality control

Bowie includes a human feedback workflow inspired by LangChain/LangSmith-style AI review loops and implemented with Langfuse in this codebase.

Each traced assistant response can be rated from the frontend:

- Like writes a positive `user_feedback` score.
- Dislike writes a negative score.
- If the user dislikes without a reason, the frontend asks what went wrong.
- A disliked response with a reason stores conversation context for review.
- Optional Slack or Discord webhooks notify admins about unsatisfactory answers.
- Normal traces are eligible for cleanup after 14 days, while negative-feedback traces are retained for manual review.

This makes Bowie measurable. The team can see which responses failed, why they failed, and which trace should be inspected instead of guessing from logs.

Required backend env:

```env
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_ENVIRONMENT=development
```

Optional admin alert env:

```env
ADMIN_ALERT_WEBHOOK_URL=
ADMIN_ALERT_WEBHOOK_TYPE=slack
# or discord
```

### 4. Redis-backed tool caching

Kapruka product and delivery tools are network-bound. Bowie wraps safe tool calls with a cache layer that uses Upstash Redis in deployed environments and an in-memory fallback during local development.

Redis helps Bowie by:

- Reducing repeated calls to the Kapruka MCP server.
- Making popular searches feel faster.
- Sharing cache state across serverless instances.
- Keeping volatile data fresh with short TTLs.
- Never caching checkout creation.

Product search also has a hot-cache promotion layer. If the same normalized search is requested often enough inside a time window, Bowie promotes it to a longer-lived hot cache entry.

Required backend env:

```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Optional hot-search tuning:

```env
SEARCH_HOT_CACHE_MIN_HITS=3
SEARCH_HOT_CACHE_WINDOW_SECONDS=3600
SEARCH_HOT_CACHE_TTL_SECONDS=21600
```

## Core Features

- Conversational product discovery for Kapruka categories, budgets, stock, and currencies.
- Real product cards with product IDs, names, prices, stock state, images, and Kapruka URLs.
- Cart state synchronized between frontend and backend.
- Guest checkout flow that collects recipient, phone, delivery address, city, delivery date, address type, sender, and gift message.
- Sinhala and Tamil address confirmation through Google Places before checkout.
- Order tracking through Kapruka MCP.
- Model routing across OpenAI, Anthropic, Gemini, Modal vLLM, and OpenRouter.
- Langfuse traces, feedback scores, retention cleanup, and admin review.
- Upstash Redis cache with local memory fallback.
- Frontend mock responses when no backend URL is configured, useful for UI-only development.

## Architecture

```text
Customer browser
  |
  | /api/chat, /api/address, /api/feedback
  v
Frontend Next.js app
  |
  | proxy with optional BOWIE_API_SECRET
  v
Backend Next.js API
  |
  | model routing + prompt + validation + tracing
  v
AI provider
  |
  | tool calls
  v
Kapruka MCP server
  |
  | product, delivery, checkout, tracking data
  v
Backend response
  |
  | assistant text + tool results + trace id
  v
Frontend renderer
  |
  | cards, checkout panels, address confirmation, feedback
  v
Customer
```

The frontend never talks to Kapruka MCP directly. It calls local frontend API routes, and those routes forward to the backend when `BOWIE_BACKEND_URL` is configured. The backend remains the source of truth for tools, cache, observability, feedback, and order behavior.

## Repository Layout

```text
kapruka/
  backend/
    app/api/
      address/route.ts
      admin/langfuse-retention/route.ts
      chat/route.ts
      feedback/route.ts
      mcp-schema/route.ts
      observability/health/route.ts
      product/[id]/route.ts
    lib/
      ai/
      cache/
      mcp/
      notifications/
      observability/
      security.ts
    modal/
    package.json
    Tooldetails.md
  frontend/
    app/
      api/address/route.ts
      api/chat/route.ts
      api/feedback/route.ts
      layout.tsx
      page.tsx
    components/
      chat/
      ui/
    lib/
    public/
    package.json
```

## Backend

The backend is a Next.js API app named `bowie-agent`.

Main responsibilities:

- Build the Bowie system prompt and pass current Asia/Colombo context.
- Select fast or smart models based on conversation complexity.
- Expose Kapruka MCP tools to the AI SDK.
- Validate and normalize MCP tool arguments.
- Execute and cache eligible MCP tools.
- Parse localized checkout addresses and resolve them through Google Places.
- Create Langfuse traces and score user feedback.
- Retain negative-feedback traces for admin review.
- Protect backend routes with optional `BOWIE_API_SECRET`.

Backend tech stack:

- Next.js `15.5.18`
- React `18.3.1`
- TypeScript `5.8.3`
- Vercel AI SDK
- `@modelcontextprotocol/sdk`
- `zod`
- `@langfuse/client`
- `@upstash/redis`
- OpenAI, Anthropic, Google Gemini, Modal-compatible OpenAI API, and OpenRouter providers

## Frontend

The frontend is a Next.js app named `kapruka-bowie-frontend`. It runs on port `3001` by default.

Main responsibilities:

- Language-first chat entry for English, Sinhala, and Tamil.
- Chat timeline with assistant messages and quick replies.
- Product, delivery, checkout, order, tracking, and category cards.
- Cart drawer and cart-aware chat requests.
- Google Maps address confirmation card for localized checkout addresses.
- Like/dislike feedback controls and dislike-reason collection.
- Proxy routes to backend chat, address, and feedback endpoints.
- Mock local data when `BOWIE_BACKEND_URL` is not set.

Frontend tech stack:

- Next.js `14.2.30`
- React `18.3.1`
- TypeScript `5.8.3`
- `lucide-react`

## API Routes

### Backend `POST /api/chat`

Main agent endpoint. It receives model messages, cart context, language, conversation ID, and user ID. It returns assistant text, structured tool results, a conversation ID, and a Langfuse trace ID when tracing is enabled.

Example request:

```json
{
  "messages": [
    { "role": "user", "content": "Find birthday cakes under 6000 in Colombo" }
  ],
  "responseFormat": "json",
  "conversationId": "conversation_abc123",
  "userId": "optional-user-id",
  "language": "en",
  "cart": []
}
```

Example response:

```json
{
  "text": "I found a few birthday cake options on Kapruka...",
  "toolResults": [
    {
      "name": "kapruka_search_products",
      "result": {
        "results": []
      }
    }
  ],
  "conversationId": "conversation_abc123",
  "traceId": "langfuse-trace-id",
  "feedback": {
    "endpoint": "/api/feedback"
  }
}
```

### Backend `POST /api/address`

Localized checkout address endpoint. It accepts Sinhala or Tamil address text, builds an English Google Places query, fetches candidates, merges user-provided specifics with Google-formatted address data, and returns confirmation options.

Example request:

```json
{
  "text": "localized delivery address message",
  "language": "sinhala"
}
```

Example response:

```json
{
  "inputLanguage": "sinhala",
  "parsed": {
    "searchQuery": "English Google Places query, Sri Lanka",
    "city": "Colombo"
  },
  "candidates": [
    {
      "placeId": "google-place-id",
      "formattedAddress": "Google formatted address",
      "city": "Colombo",
      "mcpAddress": "Clean English address for Kapruka",
      "location": {
        "lat": 6.9271,
        "lng": 79.8612
      }
    }
  ]
}
```

### Backend `POST /api/feedback`

Stores response feedback against a Langfuse trace.

Example request:

```json
{
  "traceId": "langfuse-trace-id",
  "conversationId": "conversation_abc123",
  "messageId": "assistant-message-id",
  "userId": "optional-user-id",
  "rating": "dislike",
  "reason": "The answer showed products outside my budget.",
  "conversation": [],
  "assistantMessage": {}
}
```

Behavior:

- `like` creates score `1`.
- `dislike` creates score `-1`.
- Dislike without `reason` returns `requiresReason: true`.
- Dislike with `reason` can trigger an admin webhook.

### Backend `GET /api/observability/health`

Returns Langfuse configuration status.

### Backend `GET or POST /api/admin/langfuse-retention`

Deletes old normal traces while preserving traces with negative feedback. Protect this route with `BOWIE_RETENTION_CRON_SECRET` or `CRON_SECRET`.

### Backend `GET /api/mcp-schema`

Returns available Kapruka MCP tool definitions, using the live MCP schema when available and local definitions as fallback.

### Backend `GET /api/product/[id]`

Fetches one product through `kapruka_get_product`.

## Kapruka MCP Tools

| Tool | Purpose | Cached |
| --- | --- | --- |
| `kapruka_list_categories` | List Kapruka categories and children. | Yes |
| `kapruka_search_products` | Search products by query, category, price, stock, currency, and cursor. | Yes |
| `kapruka_get_product` | Fetch product details by product ID. | Yes |
| `kapruka_list_delivery_cities` | List or search supported delivery cities. | Yes |
| `kapruka_check_delivery` | Check city/date delivery availability. | Yes |
| `kapruka_create_order` | Create a guest checkout order and payment link. | No |
| `kapruka_track_order` | Track a Kapruka order. | Yes |

Tool cache TTLs:

| Tool | TTL |
| --- | ---: |
| `kapruka_list_categories` | 30 minutes |
| `kapruka_list_delivery_cities` | 24 hours |
| `kapruka_get_product` | 1 hour |
| `kapruka_search_products` | 5 minutes |
| `kapruka_check_delivery` | 60 seconds |
| `kapruka_track_order` | 30 seconds |
| `kapruka_create_order` | Not cached |

## Environment Variables

### Backend `.env`

Minimum OpenAI setup:

```env
BOWIE_AI_PROVIDER=openai
OPENAI_API_KEY=
```

Kapruka MCP:

```env
MCP_SERVER_URL=https://mcp.kapruka.com/mcp
```

Google address lookup:

```env
GOOGLE_PLACES_API_KEY=
# or
GOOGLE_MAPS_API_KEY=
```

Langfuse:

```env
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_ENVIRONMENT=development
LANGFUSE_EXPORT_MODE=immediate
```

Redis:

```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
SEARCH_HOT_CACHE_MIN_HITS=3
SEARCH_HOT_CACHE_WINDOW_SECONDS=3600
SEARCH_HOT_CACHE_TTL_SECONDS=21600
```

Route security:

```env
BOWIE_API_SECRET=
```

Retention cleanup:

```env
BOWIE_RETENTION_CRON_SECRET=
CRON_SECRET=
```

Admin alerts:

```env
ADMIN_ALERT_WEBHOOK_URL=
ADMIN_ALERT_WEBHOOK_TYPE=slack
```

OpenRouter:

```env
BOWIE_AI_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=http://localhost:3001
OPENROUTER_APP_TITLE=Bowie Kapruka Shopping Chat
```

Modal:

```env
BOWIE_AI_PROVIDER=modal
MODAL_OPENAI_BASE_URL=
MODAL_API_KEY=modal-local-dev
MODAL_FAST_MODEL=bowie-modal
MODAL_SMART_MODEL=bowie-modal
```

Model overrides:

```env
BOWIE_FAST_MODEL=
BOWIE_SMART_MODEL=
OPENAI_FAST_MODEL=
OPENAI_SMART_MODEL=
ANTHROPIC_FAST_MODEL=
ANTHROPIC_SMART_MODEL=
GEMINI_FAST_MODEL=
GEMINI_SMART_MODEL=
MODAL_FAST_MODEL=
MODAL_SMART_MODEL=
OPENROUTER_FAST_MODEL=
OPENROUTER_SMART_MODEL=
```

### Frontend `.env`

```env
BOWIE_BACKEND_URL=http://localhost:3000
BOWIE_API_SECRET=
```

`BOWIE_BACKEND_URL` can point to either the backend root or the chat endpoint:

```env
BOWIE_BACKEND_URL=http://localhost:3000
BOWIE_BACKEND_URL=http://localhost:3000/api/chat
```

The frontend derives backend `/api/chat`, `/api/address`, and `/api/feedback` URLs automatically.

## Local Development

Install and run the backend:

```powershell
cd backend
npm install
npm run dev
```

Install and run the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Default local URLs:

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:3001`

Useful scripts:

```powershell
npm run dev
npm run build
npm run start
npm run typecheck
npm run lint
```

Run scripts inside either `backend/` or `frontend/`.

## Verification Checklist

- Backend typecheck passes.
- Frontend typecheck passes.
- Frontend can show mock product cards when `BOWIE_BACKEND_URL` is not set.
- Frontend can reach backend chat when `BOWIE_BACKEND_URL` is set.
- Product search returns real Kapruka product cards.
- Product details render from `kapruka_get_product`.
- Delivery checks render from `kapruka_check_delivery`.
- Cart items are included in later chat requests.
- Checkout is blocked until all required recipient, delivery, sender, and cart details exist.
- Sinhala or Tamil checkout address input opens the Google address confirmation flow.
- Confirmed address is sent to MCP as English or romanized text.
- Like feedback creates a positive Langfuse score.
- Dislike feedback asks for a reason.
- Dislike with a reason creates a negative Langfuse score and triggers an admin alert when configured.
- Retention cleanup deletes old normal traces and preserves negative-feedback traces.

## Troubleshooting

### Frontend returns mock products

Set `frontend/.env`:

```env
BOWIE_BACKEND_URL=http://localhost:3000
```

Restart the frontend server.

### Address lookup fails

Check backend env:

```env
GOOGLE_PLACES_API_KEY=
```

or:

```env
GOOGLE_MAPS_API_KEY=
```

Also confirm the frontend has `BOWIE_BACKEND_URL` pointing to the backend.

### Langfuse is disabled

Check backend env:

```env
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
```

Then call:

```text
GET /api/observability/health
```

### Redis is not being used

Check backend env:

```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Without both values, Bowie uses local memory cache.

### Backend route returns unauthorized

If `BOWIE_API_SECRET` is set in the backend, set the same value in the frontend so proxy routes can send the bearer token.

### MCP tools fail

Check:

```env
MCP_SERVER_URL=https://mcp.kapruka.com/mcp
```

Then call:

```text
GET /api/mcp-schema
```

If the live MCP server cannot be reached, the route returns local fallback tool names and descriptions.

## Privacy and Retention

Bowie stores operational traces only when Langfuse is configured. Normal traces are tagged for automatic deletion after 14 days. Conversations with negative feedback are retained for manual admin review because they identify answers that may be incorrect, unsafe, or unhelpful.

Checkout data should be treated carefully. Bowie collects only the fields required to create a Kapruka checkout link, keeps hidden operational comments out of the visible UI, and blocks localized Unicode checkout fields from being sent directly to the order tool.

## Design Intent

Bowie should feel like a practical Kapruka shopping guide, not a generic chatbot. It should be warm, concise, multilingual, and grounded in real Kapruka tool results. It should never invent product names, prices, stock, delivery availability, checkout links, or tracking states.

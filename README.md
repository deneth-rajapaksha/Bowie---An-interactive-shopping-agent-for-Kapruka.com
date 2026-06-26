# Project Bowie

Project Bowie is a conversational shopping assistant for Kapruka. It is built as two Next.js applications:

- `backend/`: the Bowie agent API, model router, Kapruka MCP tool bridge, Langfuse observability layer, Redis cache layer, and feedback/admin workflows.
- `frontend/`: the full-screen chat interface, shopping cards, cart drawer, feedback controls, and proxy routes that connect the browser to the backend.

The name Bowie is inspired by the main branch of a tree. Kapruka means a wish-granting tree, so Bowie represents the branch that reaches toward the customer, understands the wish, and helps turn it into a real Kapruka order.

## What Bowie Does

Bowie helps Kapruka customers shop conversationally instead of manually browsing many pages. The assistant can:

- Discover Kapruka products by category, search term, budget, stock, and currency.
- Show product cards with real product IDs, names, prices, stock state, images, and Kapruka URLs.
- Fetch product detail before answering detailed questions about a specific item.
- Check delivery availability for Sri Lankan cities and dates.
- Build a guest checkout order and return a payment link.
- Track existing Kapruka orders.
- Keep the cart context synchronized between the frontend and backend.
- Ask for feedback on assistant responses.
- Store traces and feedback in Langfuse.
- Send admin alerts when a user dislikes an answer and explains why.
- Cache Kapruka tool results with Upstash Redis when configured, or in memory during local development.

## Repository Layout

```text
kapruka/
  backend/
    app/api/
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
    modal/
    package.json
    Tooldetails.md
  frontend/
    app/
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

## Architecture

The application is intentionally split into a backend agent service and a frontend user experience.

```text
Customer browser
  |
  | POST /api/chat
  v
Frontend Next.js route
  |
  | forwards messages, cart, conversationId
  v
Backend /api/chat
  |
  | builds prompt, chooses model, exposes Kapruka tools
  v
AI SDK provider
  |
  | optional tool calls
  v
Kapruka MCP server
  |
  | product, delivery, checkout, tracking data
  v
Backend response
  |
  | text + toolResults + conversationId + traceId
  v
Frontend renderer
  |
  | cards, delivery panels, order summaries, quick replies
  v
Customer
```

The frontend never calls the Kapruka MCP server directly. It talks to its own local Next.js API routes, and those routes either forward to the backend or return mock data when `BOWIE_BACKEND_URL` is not configured. The backend is the source of truth for model selection, tool execution, caching, trace creation, feedback scoring, and order-related behavior.

## Backend Specification

The backend is a Next.js 14 API application named `bowie-agent`. It runs on Node.js for the chat, feedback, observability, and admin routes, with Edge runtime used for lightweight schema/product routes.

### Backend Responsibilities

The backend owns:

- AI provider configuration and model selection.
- System prompt construction for Bowie.
- Conversation history trimming.
- Tool schema exposure to the AI SDK.
- MCP client connection to Kapruka.
- Tool argument validation with Zod.
- Tool response compaction before sending data to the model and frontend.
- Redis-backed caching for Kapruka tool results.
- Langfuse trace creation and feedback scoring.
- Trace retention cleanup.
- Admin email alerts for unsatisfactory conversations.
- Backend health and observability metadata.

### Backend Tech Stack

- Next.js `14.2.30`
- React `18.3.1`
- TypeScript `5.8.3`
- Vercel AI SDK `ai`
- AI providers:
  - `@ai-sdk/openai`
  - `@ai-sdk/anthropic`
  - `@ai-sdk/google`
  - OpenAI-compatible Modal vLLM
  - OpenRouter through an OpenAI-compatible client
- MCP client:
  - `@modelcontextprotocol/sdk`
- Validation:
  - `zod`
- Observability:
  - `@langfuse/client`
  - `@langfuse/otel`
  - `@langfuse/tracing`
  - `@opentelemetry/sdk-node`
- Cache:
  - `@upstash/redis`
- Email alerts:
  - `nodemailer`

### Backend API Routes

#### `POST /api/chat`

Main agent endpoint.

Request body:

```json
{
  "messages": [
    { "role": "user", "content": "Find birthday cakes under 6000 in Colombo" }
  ],
  "responseFormat": "json",
  "conversationId": "conversation_abc123",
  "userId": "optional-user-id",
  "cart": [
    {
      "product_id": "cake00ka002034",
      "name": "Chocolate Cake",
      "price": 5500,
      "currency": "LKR",
      "image_url": "https://example.com/image.jpg",
      "quantity": 1,
      "icing_text": "Happy Birthday"
    }
  ]
}
```

Response body:

```json
{
  "text": "I found these birthday cake options on Kapruka...",
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

Important behavior:

- Defaults to JSON responses but can stream when `responseFormat` is `stream`.
- Appends cart context into the latest user message when the frontend sends cart items.
- Chooses a fast or smart model using `lib/ai/router.ts`.
- Uses high-intent routing for checkout, order, payment, tracking, delivery, comparison, and gift-message requests.
- Trims history more aggressively for Modal than for cloud providers.
- Enables AI SDK tool calling with Kapruka MCP tools.
- Creates Langfuse traces when Langfuse credentials are present.
- Returns trace and conversation headers:
  - `x-bowie-conversation-id`
  - `x-bowie-feedback-endpoint`
  - `x-langfuse-trace-id` when tracing is enabled.
- Sanitizes leaked hidden context, leaked tool-call blocks, and dangling tool JSON before responding.
- Runs a grounded product-search fallback when the assistant appears to need real product cards but no useful search result was returned.

#### `POST /api/feedback`

Stores user feedback for a specific assistant response.

Request body:

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

- Validates the payload with Zod.
- Scores feedback in Langfuse as:
  - `1` for `like`
  - `-1` for `dislike`
- If the user dislikes without a reason, the route returns `202` and asks the frontend to collect one.
- If a dislike includes a reason, the backend can send an admin email alert through Gmail SMTP.
- Disliked conversations include metadata for admin review and are excluded from automatic trace deletion.

#### `GET /api/observability/health`

Returns observability configuration status.

Example response:

```json
{
  "langfuseEnabled": true,
  "publicKeyPresent": true,
  "secretKeyPresent": true,
  "baseUrl": "https://cloud.langfuse.com",
  "environment": "development",
  "exportMode": "immediate"
}
```

#### `GET or POST /api/admin/langfuse-retention`

Deletes old normal Langfuse traces after the retention window.

Behavior:

- Uses `BOWIE_RETENTION_CRON_SECRET` or `CRON_SECRET` when configured.
- Finds traces tagged `bowie-normal` older than 14 days.
- Deletes traces without negative feedback.
- Retains traces with unsatisfied feedback for admin review.

#### `GET /api/mcp-schema`

Returns available MCP tools. It first tries to fetch the live MCP schema from the Kapruka MCP server. If that fails, it returns the local tool definitions as a fallback.

#### `GET /api/product/[id]`

Fetches one Kapruka product through `kapruka_get_product` and returns it with cache headers.

## Langfuse Specification

Langfuse is used for observability, feedback, retention, and admin review.

### When Langfuse Is Enabled

Langfuse is enabled only when both of these environment variables exist:

```env
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
```

Optional Langfuse variables:

```env
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_ENVIRONMENT=development
LANGFUSE_EXPORT_MODE=immediate
```

### Trace Creation

Every traced chat turn creates or upserts a Langfuse trace with:

- Trace ID generated by the backend.
- Name: `bowie-chat-turn`.
- Session ID: Bowie `conversationId`.
- Optional user ID.
- Tag: `bowie-normal`.
- Input:
  - Latest user text.
  - Trimmed model messages.
- Output:
  - Assistant text.
  - Tool results.
- Metadata:
  - AI provider.
  - Fast model.
  - Smart model.
  - Token usage when available.
  - Response format.
  - Retention policy.
  - Retention expiry timestamp.

### Feedback Scores

The feedback route writes a Langfuse score named `user_feedback`.

Likes:

- Score value: `1`
- Retention policy: `auto_delete_after_14_days`

Dislikes:

- Score value: `-1`
- Retention policy: `manual_admin_delete_only`
- Metadata can include the reason, conversation snapshot, assistant message, message ID, user ID, and conversation ID.

### Retention Policy

Normal traces are designed to be automatically deleted after 14 days. The backend calculates a `retentionExpiresAt` value and stores it in trace metadata.

The retention cleanup route deletes old normal traces unless they have negative feedback. Negative-feedback traces are retained because they need human review.

## Redis Specification

Redis is used through Upstash Redis. It is optional in local development but recommended for deployed environments.

### When Redis Is Enabled

Redis is enabled when both variables are present:

```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

If those variables are missing, the backend uses an in-memory `Map` cache. This is useful for local development but is not shared across server instances and resets whenever the process restarts.

### Cache API

The backend cache wrapper exposes:

- `getCached(key)`
- `setCached(key, value, ttlSeconds)`
- `incrementCachedCounter(key, ttlSeconds)`

When Redis is configured:

- `getCached` reads from Upstash.
- `setCached` writes to Upstash with an expiry.
- `incrementCachedCounter` increments a Redis counter and applies an expiry.

When Redis is not configured:

- The same functions operate against an in-memory cache record with `expiresAt`.

### Tool Cache TTLs

The backend caches only safe tool calls. Checkout creation is never cached.

| Tool | TTL |
| --- | ---: |
| `kapruka_list_categories` | 30 minutes |
| `kapruka_list_delivery_cities` | 24 hours |
| `kapruka_get_product` | 1 hour |
| `kapruka_search_products` | 5 minutes |
| `kapruka_check_delivery` | 60 seconds |
| `kapruka_track_order` | 30 seconds |
| `kapruka_create_order` | Not cached |

### Hot Search Cache

Product search has a second hot-cache layer.

Environment variables:

```env
SEARCH_HOT_CACHE_MIN_HITS=3
SEARCH_HOT_CACHE_WINDOW_SECONDS=3600
SEARCH_HOT_CACHE_TTL_SECONDS=21600
```

Flow:

1. Bowie builds a stable SHA-256 cache key from the tool name and normalized arguments.
2. For `kapruka_search_products`, it first checks the hot cache.
3. If the normal cache has a value, it returns that value and increments a hit counter.
4. Once the hit counter reaches the configured threshold, the result is promoted to hot cache.
5. Hot cached searches remain available for the configured hot TTL.

This keeps repeated popular searches fast while still allowing normal search results to refresh frequently.

## MCP Tool Specification

Bowie uses a Kapruka MCP server through `@modelcontextprotocol/sdk`.

Default MCP server:

```env
MCP_SERVER_URL=https://mcp.kapruka.com/mcp
```

The backend validates tool arguments locally before sending them to MCP. The available tools are:

| Tool | Purpose | Cached |
| --- | --- | --- |
| `kapruka_list_categories` | List top-level Kapruka categories and optional children. | Yes |
| `kapruka_search_products` | Search products by query, category, stock, price, currency, and cursor. | Yes |
| `kapruka_get_product` | Fetch one product by product ID. | Yes |
| `kapruka_list_delivery_cities` | List or search supported Sri Lankan delivery cities. | Yes |
| `kapruka_check_delivery` | Check delivery availability and rate for a city/date. | Yes |
| `kapruka_create_order` | Create a guest checkout order and payment link. | No |
| `kapruka_track_order` | Track an existing Kapruka order. | Yes |

The backend compacts large tool responses before giving them back to the model or frontend. For example:

- Product searches are limited to the first 4 products.
- Product descriptions are truncated.
- Product images and variants are capped.
- Category lists are capped to keep payloads small.

## AI Provider Specification

The backend supports multiple providers through a single routing layer.

Provider selection:

```env
BOWIE_AI_PROVIDER=openai
```

Fallback variable:

```env
AI_PROVIDER=openai
```

Supported values:

- `openai`
- `anthropic`
- `gemini`
- `modal`
- `openrouter`

Default models:

| Provider | Fast model | Smart model |
| --- | --- | --- |
| `openai` | `gpt-4.1-mini` | `gpt-4.1` |
| `anthropic` | `claude-haiku-4-5` | `claude-sonnet-4-6` |
| `gemini` | `gemini-3.5-flash` | `gemini-3.5-flash` |
| `modal` | `bowie-modal` | `bowie-modal` |
| `openrouter` | `openai/gpt-oss-120b:free` | `openai/gpt-oss-120b:free` |

Model override variables:

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

The router chooses the smart model when:

- The conversation has more than 14 messages.
- The latest user text mentions checkout, order, payment, tracking, delivery, comparison, or gift messages.

Otherwise it uses the fast model.

## Modal vLLM Backend Option

The backend can use an OpenAI-compatible Modal vLLM server.

Set:

```env
BOWIE_AI_PROVIDER=modal
MODAL_OPENAI_BASE_URL=https://<workspace>--bowie-vllm-serve.modal.run/v1
MODAL_API_KEY=modal-local-dev
MODAL_FAST_MODEL=bowie-modal
MODAL_SMART_MODEL=bowie-modal
```

See `backend/modal/README.md` for Modal deployment commands and notes.

## Backend Request Flow

The backend chat route works like this:

1. Parse the request body.
2. Read `messages`, `cart`, `conversationId`, `userId`, and `responseFormat`.
3. Extract the latest user text.
4. Append hidden cart context to the latest user message when cart items are present.
5. Read the provider configuration.
6. Trim history based on the provider.
7. Select the active model.
8. Build the Bowie system prompt with the current Asia/Colombo date.
9. Attach the Kapruka MCP tool set to the AI SDK call.
10. Create a Langfuse trace wrapper when Langfuse is configured.
11. Run `generateText` for JSON responses or `streamText` for streaming responses.
12. Execute MCP tools when the model calls them.
13. Cache eligible tool results through Redis or memory cache.
14. Compact tool results.
15. Optionally run a grounded product-search fallback.
16. Sanitize the assistant text.
17. Update and flush the Langfuse trace.
18. Return text, tool results, conversation ID, trace ID, and feedback instructions.

## Frontend Specification

The frontend is a Next.js 14 application named `kapruka-bowie-frontend`. It runs the user-facing chat interface on port `3001` by default.

### Frontend Responsibilities

The frontend owns:

- The Bowie chat shell.
- The side rail and cart summary.
- The message timeline.
- User input and quick replies.
- Product cards and product detail panels.
- Delivery result cards.
- Checkout summary cards.
- Order tracking cards.
- Category grids.
- Cart drawer state.
- Feedback buttons and dislike reason collection.
- Local proxy routes to the backend.
- Mock fallback behavior when no backend URL is configured.

### Frontend Tech Stack

- Next.js `14.2.30`
- React `18.3.1`
- TypeScript `5.8.3`
- `lucide-react` for icons

### Frontend Chat Flow

1. The page loads `ChatPage`.
2. Bowie starts with a welcome assistant message and starter quick replies.
3. The user sends a message.
4. The frontend appends the user message locally.
5. The frontend sends `messages`, `conversationId`, and `cart` to `/api/chat`.
6. The frontend route forwards the request to the backend when `BOWIE_BACKEND_URL` is configured.
7. If no backend URL exists, the route returns mock Kapruka-like data for local UI development.
8. The frontend receives assistant text, tool results, quick replies, conversation ID, and trace ID.
9. Hidden quick-reply comments are extracted from assistant text.
10. Tool results are converted into renderable blocks.
11. The message timeline renders the assistant bubble plus any product, delivery, order, tracking, or category UI.
12. Product cards can be added to the cart.
13. The cart is sent back to the backend on future messages so checkout can continue without asking the user to reselect items.

### Frontend Proxy Routes

#### `POST /api/chat`

If `BOWIE_BACKEND_URL` exists, the frontend forwards chat traffic to the backend. `BOWIE_BACKEND_URL` can point either to the backend root or directly to `/api/chat`.

If `BOWIE_BACKEND_URL` is missing, the frontend returns mock data from `frontend/lib/mock-data.ts`. This keeps UI development possible without a live model or MCP server.

#### `POST /api/feedback`

If `BOWIE_BACKEND_URL` exists, feedback is forwarded to the backend feedback endpoint.

If `BOWIE_BACKEND_URL` is missing, the route returns a local success payload and asks for a reason when the user dislikes without one.

### Frontend Rendering

The frontend receives backend `toolResults` and converts them in `frontend/lib/message-renderer.ts`.

Tool result to UI mapping:

| Tool | Frontend block |
| --- | --- |
| `kapruka_search_products` | `product_list` |
| `kapruka_get_product` | `product_detail` |
| `kapruka_check_delivery` | `delivery_check` |
| `kapruka_create_order` | `order_summary` |
| `kapruka_track_order` | `order_tracker` |
| `kapruka_list_categories` | `category_grid` |

The renderer also strips hidden operational comments and leaked tool-call artifacts from visible assistant text.

### Cart Behavior

The cart is held in React state inside `ChatPage`.

Each item includes:

```ts
{
  product_id: string;
  name: string;
  price: number;
  currency: string;
  image_url: string | null;
  quantity: number;
  icing_text?: string;
}
```

When a product card is added:

- Existing items increment quantity.
- New products are appended to the cart.
- The cart drawer opens.

When the user clicks checkout:

- The drawer closes.
- The frontend sends `Proceed to checkout`.
- The current cart is included in the chat request.
- The backend uses hidden cart context to continue checkout collection.

### Feedback Behavior

Assistant messages can carry `traceId` and `conversationId`. When a user clicks:

- Like: frontend sends a positive feedback payload.
- Dislike: frontend sends a negative feedback payload.
- Dislike without reason: backend asks for a reason, and the next user message is treated as the reason.

When the reason is submitted, the frontend sends:

- Rating.
- Trace ID.
- Conversation ID.
- Message ID.
- Reason.
- Assistant message snapshot.
- Conversation snapshot.

The backend stores this in Langfuse and optionally emails an admin.

## Environment Variables

### Backend `.env`

Minimum model setup for OpenAI:

```env
BOWIE_AI_PROVIDER=openai
OPENAI_API_KEY=
```

Kapruka MCP:

```env
MCP_SERVER_URL=https://mcp.kapruka.com/mcp
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

Admin retention:

```env
BOWIE_RETENTION_CRON_SECRET=
CRON_SECRET=
```

Admin email alerts:

```env
GMAIL_SMTP_USER=
GMAIL_SMTP_APP_PASSWORD=
GMAIL_SMTP_FROM=
ADMIN_ALERT_EMAIL=
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

### Frontend `.env`

```env
BOWIE_BACKEND_URL=http://localhost:3000
```

`BOWIE_BACKEND_URL` can be:

- Backend root: `http://localhost:3000`
- Chat endpoint: `http://localhost:3000/api/chat`

The frontend automatically derives the feedback endpoint from the backend URL.

## Local Development

Install backend dependencies:

```powershell
cd backend
npm install
```

Run backend:

```powershell
npm run dev
```

Install frontend dependencies:

```powershell
cd frontend
npm install
```

Run frontend:

```powershell
npm run dev
```

Default local URLs:

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:3001`

## Useful Scripts

Backend:

```powershell
npm run dev
npm run build
npm run start
npm run typecheck
npm run lint
```

Frontend:

```powershell
npm run dev
npm run build
npm run start
npm run typecheck
npm run lint
```

## Testing and Verification Checklist

After changes, verify:

- Backend typecheck passes.
- Frontend typecheck passes.
- Frontend can send a message with no backend URL and receive mock cards.
- Frontend can send a message with `BOWIE_BACKEND_URL` set and receive backend data.
- Backend `/api/observability/health` returns the expected Langfuse status.
- Product search returns real `kapruka_search_products` cards.
- Product detail renders from `kapruka_get_product`.
- Delivery check renders from `kapruka_check_delivery`.
- Cart items are included in later chat requests.
- Checkout does not happen until all required recipient, delivery, sender, and cart details exist.
- Like feedback creates a positive Langfuse score.
- Dislike feedback asks for a reason.
- Dislike feedback with a reason creates a negative score and sends an admin alert when SMTP is configured.
- Retention cleanup deletes old normal traces and preserves disliked traces.

## Deployment Notes

Backend deployment should include:

- AI provider credentials.
- MCP server URL.
- Langfuse credentials.
- Upstash Redis credentials.
- Optional SMTP credentials.
- Retention cron secret if the cleanup route is called by a scheduler.

Frontend deployment should include:

- `BOWIE_BACKEND_URL` pointing to the deployed backend.

Because the frontend can mock responses when no backend is configured, confirm production has `BOWIE_BACKEND_URL` set before launch.

## Privacy and Retention

Bowie stores operational traces only when Langfuse is configured. Normal traces are tagged for automatic deletion after 14 days. Conversations with negative feedback are retained for manual admin review because they represent quality and safety issues that need investigation.

Sensitive checkout details should be handled carefully. The backend should only collect the fields needed to create a Kapruka checkout link, and the frontend should avoid displaying hidden cart or product context comments to the user.

## Troubleshooting

### Frontend returns mock products

Set `frontend/.env`:

```env
BOWIE_BACKEND_URL=http://localhost:3000
```

Restart the frontend server.

### Backend says Langfuse is disabled

Check:

```env
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
```

Then call:

```text
GET /api/observability/health
```

### Redis is not being used

Check:

```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Without both values, Bowie uses local memory cache.

### Modal provider fails

Check:

```env
BOWIE_AI_PROVIDER=modal
MODAL_OPENAI_BASE_URL=
MODAL_API_KEY=
```

The backend normalizes `MODAL_OPENAI_BASE_URL` so it may include or omit `/v1`.

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

## Design Intent

Bowie should feel like a practical Kapruka shopping guide rather than a generic chatbot. It should be warm, concise, and grounded in real tool results. It should never invent product names, prices, stock, delivery availability, checkout links, or tracking states. The backend enforces this through tool-first prompting, response sanitization, grounded search fallback, structured tool results, caching, and observability.


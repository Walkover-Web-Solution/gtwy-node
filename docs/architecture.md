# System Architecture

> **For Developers & AI Assistants**: See [`AI_INSTRUCTIONS.md`](./AI_INSTRUCTIONS.md) for comprehensive coding guidelines, naming conventions, and best practices when working on this codebase.

## System Overview

GTWY.AI is an AI middleware platform that helps SaaS products add AI fast—without rebuilding prompt orchestration, tooling, or data-connectivity layers. You can experiment with prompts/models, connect to apps or databases, and ship chatbots/assistants with memory + model switching so the experience stays personalized and cost-efficient as you scale.

**Entry Point – `src/index.js`**

- Bootstraps Express with `express-async-errors`, CORS, JSON parsing, and a `/healthcheck`.
- Connects to MongoDB using `config/config.js` and loads Postgres/Timescale models via `models/index.js`.
- Registers every route module (agents, chat, rag, metrics, utils, etc.) so each feature has a predictable base path.
- Sets up system middleware (`responseMiddleware`, `notFound`, `errorHandler`), initializes cron jobs, model-configuration watchers, cache warmers, and graceful shutdown hooks.

## Request Lifecycle & Middleware

- **Primary auth/context middleware – `src/middlewares/middleware.js`**  
  Handles JWT/proxy tokens, assigns `req.profile`, calculates admin/editor/viewer roles, enforces agent-level access via `checkAgentAccessMiddleware`, and writes helper fields (`req.org_id`, `req.ownerId`, etc.) used throughout controllers and services.
- **Validation middleware – `src/middlewares/validate.middleware.js`**  
  Wraps Joi schemas to fail fast with consistent `ApiError` responses.
- **Chatbot/public guards – `src/middlewares/interfaceMiddlewares.js` & `src/middlewares/agentsMiddlewares.js`**  
  Validate chatbot tokens, optional public tokens, and annotate `req.chatBot`.
- **Embed middleware – `src/middlewares/gtwyEmbedMiddleware.js`**  
  Verifies GTWY embed auth tokens and materializes the user/org context.
- **Response formatting – `src/middlewares/responseMiddleware.js`**  
  Controllers place payloads in `res.locals` and choose `req.statusCode`; this middleware serializes JSON/plain-text consistently before `errorHandler`.
- **Fallbacks – `src/middlewares/notFound.js` + `src/middlewares/errorHandler.js`**  
  Provide uniform 404 + error responses across the platform.

> **Implementation rule of thumb:** Controllers should be `async`, rely on the shared middleware to populate request context, validate input through Joi schemas, write results onto `res.locals`, and never call `res.send` directly.

## Data Persistence & Service Pattern

- **MongoDB (Mongoose models under `src/mongoModel/`)** stores bridge configurations, chatbots, RAG collections, templates, etc. Every controller typically delegates to a `db_services/*` module (e.g., `configuration.service.js`, `chatBot.service.js`) which encapsulates the Mongoose queries and domain rules.
- **Postgres (`models/postgres/*`)** keeps relational history such as conversation logs, orchestrator history, and prompt versioning metadata when SQL-like querying is required.
- **Timescale (`models/timescale/*`)** captures time-series metrics for faster aggregations.
- **Services** wrap business logic that crosses persistence layers (e.g., `src/services/thread.service.js`, `src/services/proxy.service.js`, `src/services/ragParent.service.js`), keeping controllers thin.

Whenever you add a feature, mirror the existing pattern: create/update a service under `db_services/` for persistence, add a thin controller, and reference models only inside the service layer.

## Caching, Rate Limits & Scheduled Jobs

- **Redis client (`src/services/cache.service.js`)** powers caching helpers in `src/cache_service/index.js` for storing computed bridge data, rate-limit counters, and expensive lookups. Use `storeInCache`, `findInCache`, `scanCacheKeys`, and `deleteInCache` instead of talking to Redis directly.
- **Cache invalidation utilities (`src/services/utils/redis.utils.js`)** purge all keys tied to bridges/folders/versions to avoid stale configs. Controllers that materially change agent state should call these helpers.
- **Redis key contracts live in `src/configs/constant.js`**, so reuse the predefined prefixes to stay consistent with background jobs.
- **Cron jobs (`src/cron/*.js`)**:
  - `initializeDailyUpdateCron.js` moves Redis usage tallies into Mongo via `controllers/movedataRedistoMongodb.js`.
  - `monthlyLatencyReport.js` & `weeklyLatencyReport.js` trigger scheduled reports.  
    Add new recurring work as a cron module and register it in `src/index.js`.

## Observability & Startup Tasks

- **Atatus APM – `src/atatus.js`** activates telemetry in production.
- **Centralized logging – `src/logger.js`** uses Winston with environment-aware formatting; prefer `logger` over `console`.
- **Model configuration cache – `src/services/utils/loadModelConfigs.js`** preloads model metadata and schedules change streams for live refresh (critical for `suggestModel`, validation, etc.).
- **Graceful shutdown + health-checks** are centralized in `src/index.js`, so recycle those patterns when adding new long-lived connections.

---

## Project Structure

```
AI-middleware/
├── src/
│   ├── index.js                 # Application entry point
│   ├── atatus.js               # APM telemetry
│   ├── logger.js               # Winston logger configuration
│   ├── controllers/            # Route handlers
│   ├── routes/                 # Express route definitions
│   ├── middlewares/            # Auth, validation, error handling
│   ├── services/               # Business logic layer
│   ├── db_services/            # Database access layer
│   ├── mongoModel/             # Mongoose schemas
│   ├── validation/             # Joi validation schemas
│   ├── cache_service/          # Redis caching utilities
│   ├── configs/                # Configuration constants
│   ├── cron/                   # Scheduled jobs
│   └── utils/                  # Helper utilities
├── models/
│   ├── postgres/               # PostgreSQL models
│   └── timescale/              # TimescaleDB models
├── config/
│   └── config.js               # Database configuration
├── docs/
│   └── architecture.md         # Architecture documentation
├── .env                        # Environment variables (not in git)
├── .env.example                # Environment template
├── package.json                # Dependencies and scripts
└── README.md                   # Project documentation
```

---

## HTTP Surface Map

All HTTP modules follow the same structure: routers live in `src/routes`, controllers in `src/controllers`, and data-access services in `src/db_services`. The paragraphs below highlight what each surface exposes and which controller owns the behavior.

### Conversation Configuration

Endpoints under `/api/v1/config` manage bridge threads, sub-thread history, fine-tune exports, and message status changes. The conversation controller orchestrates pagination + creation flows while the conversation service handles Mongo persistence.

### Threading & Sub-threads

The `/api/thread` surface lets chatbots create plain or AI-generated sub-thread entries and fetch thread history. `combinedAuthWithChatBotAndPublicChatbot` guards the routes and the thread controller wraps all thread-specific logic.

### Agent Configuration

CRUD for bridges, cloning, and metadata updates is hosted at `/api/agent`. The agentConfig controller validates payloads, triggers AI-assisted configuration via `aiCall.utils`, and delegates persistence to `configuration.service`.

### Agent Versioning

Version lifecycle management hangs off `/api/versions`, allowing creation, publication, deletion, discard, bulk publishing, and dependency insights (`/connected-agents`, `/suggest-model`). The agentVersion controller and service keep versions in sync and handle cache invalidation.

Every prompt save (`PUT /api/versions/:version_id` with `configuration.prompt`) writes a row to the Postgres table `system_prompt_versionings`: the parent agent id (`bridge_id`), the version it was saved on (`version_id`), and the prompt text (`system_prompt`; structured prompts are flattened by `convertPromptToString`). `/api/prompt-versions/:bridge_id` lists that history for the org with each entry's `system_prompt`, newest first (`?version_id=`, `page`, `limit` ≤ 100). To restore an entry, send its `system_prompt` back through `PUT /api/versions/:version_id`; that save becomes a new entry.

### ChatBot Management

`/api/chatbot` exposes chatbot CRUD, subscription/login, bridge assignments, UI config updates, and action management. The chatbot controller uses `chatBot.service` plus configuration services and shared token generators to persist changes and issue client tokens.

### Public Agent Execution

Public listings and logins live at `/api/runagents`. The runAgents controller powers anonymous login (`/public/login`), authenticated login (`/login`), listing, and slug lookups while `agentsAuth` protects read operations.

### History

Historical querying uses `/api/history` to fetch recent threads, conversation logs, and recursive agent-call trees. The history controller issues optimized queries through `history.service` to keep pagination and filters fast.

### RAG (Retrieval Augmented Generation)

Knowledge-base management sits at `/api/rag`. The RAG controller brokers embed token generation, chatbot search, collection/resource CRUD, and chunk inspection by coordinating `ragCollection.service`, proxy utilities, and the external Hippocampus API.

### Services (Model Providers)

Routes under `/api/service` list every supported provider/model along with token limits, credit pricing, and capabilities. The service controller simply reads from the cached model configuration document loaded at startup.

### Model Configuration

`/api/models` lets users save or delete their personal model configuration. The modelConfig controller works with the corresponding db service to store preferences per org/user combo.

### Tools / API Calls

Custom tool definitions are exposed via `/api/tools`. The apiCall controller powers CRUD over agent tools (including inbuilt ones) and persists schemas through `apiCall.service`, keeping function-calling contracts consistent.

### API Keys

Provider credential management sits at `/api/apikeys`. After `checkAgentAccessMiddleware` enforces ACLs, the apikey controller lets orgs create, list, update, or delete stored API keys used by agents.

### Embed Tokens & Portal

`/api/embed` handles embed logins, embed creation/update, listing embeds, and fetching the agents available to a specific embed user. The embed controller relies on `GtwyEmbeddecodeToken` for auth context and then uses its db service to store settings.

### Alerting

Alert definitions live at `/api/alerting`, where the alerting controller allows creation, listing, updates, and deletion. Alerts typically trigger webhooks/flows when thresholds defined in the alert documents are met.

### Testcases & QA

`/api/testcases` provides CRUD for bridge-level regression tests plus update + retrieval flows. The testcase controller is also the entry point for AI-generated test cases referenced by `AI_OPERATION_CONFIG.generate_test_cases`.

### Reporting

Usage and performance summaries are exposed at `/api/report`. The report controller supports `POST /monthly` for weekly/monthly stats and `POST /message-data` for granular usage exports.

### Metrics

`/api/metrics` charts high-level and per-agent usage. The metrics controller consumes validated date-range filters to query stored aggregates and return dashboards-ready data.

### Templates

Starter templates are listed at `/api/template`, where the template controller returns the available catalog without requiring write operations.

### Prebuilt Prompt Library

`/api/prebuilt_prompt` houses the curated prompt catalog. The prebuiltPrompt controller lets orgs fetch, update, or reset prompts that plug into AI helper operations.

### Utility & Support APIs

`/api/utils` is the catch-all ops surface: clear/read Redis keys, invoke GTWY AI helper operations, find agents by model, mint org/rag/embed tokens, and fetch org user rosters. The utils controller routes each subtype to the appropriate helper service.

### Authentication & Org Management

The `/api/auth` and `/api/org` paths generate org auth tokens, verify clients, and proxy org details for embeds/agents. The auth controller centralizes those flows so other modules simply rely on the middleware for context.

### User & Org Switching

User/org switching capabilities run under `/api/user`. The userOrgLocal controller issues local tokens (via `loginAuth`), switches org context, updates user metadata, and removes users from an org when requested.

### Internal Verification

`/api/internal` exposes a lightweight `/info` endpoint so integrations such as Viasocket can verify the current org/user context using the shared auth middleware.

---

## Developer Playbook

1. **Identify the surface**
   - Determine the base URL under `src/index.js` that matches your feature.
   - If none fits, add a new router under `src/routes/` and register it in `src/index.js`.
2. **Model + service first**
   - Extend or create a Mongoose schema (`src/mongoModel/*`), SQL model (`models/postgres/*` or `models/timescale/*`), and a matching `db_services/*` module.
   - Encapsulate all DB logic inside the service and export clean functions.
3. **Controller + validation**
   - Add the route handlers in `src/controllers/*.js`.
   - Define Joi schemas in `src/validation/joi_validation/*` and wrap each route with `validate(...)`.
   - Controllers should: read `req.profile`, call the service, place the result in `res.locals`, set `req.statusCode`, and `return next()`.
4. **Middleware & auth**
   - Reuse `middleware` for org-scoped endpoints.
   - For chatbots or embeds, chain the specialized middleware (`combinedAuthWithChatBotAndPublicChatbot`, `GtwyEmbeddecodeToken`, etc.).
   - Add `requireAdminRole`/`checkAgentAccessMiddleware` where necessary.
5. **Cache + async considerations**
   - If the change affects agent configs, hit the helpers in `src/services/utils/redis.utils.js`.
   - For heavy work, publish to RabbitMQ via `queue-utility`.
   - When storing derived usage data, ensure cron jobs or cache movers are aware of new Redis prefixes.
6. **Observability + docs**
   - Log meaningful events with `logger`.
   - Update this document (and any runbooks) whenever you add a new subsystem so future contributors know where to plug in.

Following these conventions keeps the codebase predictable so any engineer can locate the correct controller/service pair and extend the platform without breaking core behaviors.

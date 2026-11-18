---
covers: ["*"]
verified_at: bbbb49db
verified_on: 2026-11-13
---

# Product Vision & Strategic Direction

**GTWY.AI** (platform) is an AI middleware layer that helps SaaS products ship AI-assisted experiences without rebuilding prompt orchestration, tool connectivity, and data layers. **gtwy-node** (this repository) is the **configuration and management backend** for that platform: a Node.js/Express API that owns org-scoped CRUD, auth context, caching, billing hooks, and operational surfaces, while the companion **[gtwy-ai](https://github.com/Walkover-Web-Solution/gtwy-ai)** service handles AI orchestration and real-time inference.

## Authoritative Sources & Status

**Sources used (read 2026-11-13, commit `bbbb49db` on branch `testing`):**

| Source                                            | Role                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| [`README.md`](../README.md)                       | Stated purpose of this repo vs. gtwy-ai; stack overview                  |
| [`docs/architecture.md`](./architecture.md)       | Platform positioning, request lifecycle, HTTP surface map                |
| [`docs/AI_INSTRUCTIONS.md`](./AI_INSTRUCTIONS.md) | Engineering principles and layering conventions                          |
| [`docs/lago-runbook.md`](./lago-runbook.md)       | Billing/wallet behavior and cross-repo contracts with gtwy-ai            |
| [`package.json`](../package.json)                 | Package metadata (note: sparse product description)                      |
| [`src/index.js`](../src/index.js)                 | Registered routes, startup asserts, cron/consumer wiring                 |
| Recent git history                                | In-flight features (billing, embed APIs, model pricing, prompt versions) |

### Approved Direction

From repository-stated purpose (not inferred from incidental code):

- **Platform goal:** Enable SaaS teams to experiment with prompts/models, connect apps and data, and ship chatbots/assistants with memory and model switching at scale (`docs/architecture.md`).
- **This service’s role:** Provide the **management and configuration layer**—agents/bridges, versions, chatbots, RAG collections, API keys, auth/org context, templates, metrics/reporting, and related REST (and limited GraphQL) APIs—so clients and **gtwy-ai** can run configured AI workloads (`README.md`, `docs/architecture.md`).
- **Architectural stance:** Thin controllers, validated inputs (Joi), service-layer persistence, shared auth middleware, consistent error/response handling (`docs/AI_INSTRUCTIONS.md`, `docs/architecture.md`).
- **Ecosystem split:** Real-time AI orchestration and inference live in **gtwy-ai**; this repo must not absorb that runtime responsibility (`README.md`).

### Current Implementation

What the codebase does today (may include legacy or transitional behavior):

- Express app on port `7072` (default) with `/healthcheck` and `/ready`, CORS wide open (`origin: "*"` in `src/index.js`).
- Multi-store persistence: **MongoDB** (configs, chatbots, RAG, etc.), **PostgreSQL** (conversation/prompt history), **TimescaleDB** (time-series metrics), **Redis** (cache, rate limits, billing-related keys per runbooks), **RabbitMQ** consumers for log/metrics queues.
- Broad HTTP surface: agents, versions, chatbots, embed, RAG, tools, history, metrics, reporting, billing/Lago, organization provisioning, observability, analytics, showcase, and internal verification routes (`src/index.js`, `docs/architecture.md`).
- **Billing integration:** Startup asserts for Lago plan codes and Stripe-through-Lago config; wallet/credits flows documented in `docs/lago-runbook.md`; cron reconcile job registered at boot.
- **GraphQL:** Model/service listing at `/api/service/graphql` with folder-aware context (`src/graphql/yoga.js`, `src/routes/service.routes.js`).
- **External dependencies (configured in `.env.example`):** Hippocampus (RAG), MSG91 (org/signup paths per routes/comments), Viasocket (internal verification and historical sync migrations).

### Proposals & Roadmaps

Explicitly planned or recently landed work visible in docs and git (not necessarily complete product direction):

- Wallet/credits billing bootstrap and Lago metric alignment (`docs/lago-runbook.md`, billing routes/controllers).
- Prompt versioning history in Postgres with restore-via-version-save flow (`docs/architecture.md`, recent merges).
- Embed agent listing filters, pagination, and org-specific folder-token restrictions (recent `testing` branch history).
- Model specification updates (batch/priority pricing, embed visibility rules) via Mongo migrations.

### Unknowns & Ambiguities

See **[`docs/OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md)** for decisions an owner has not documented. Do not treat silence as approval.

---

## Target Audience & Ideal Customer Profile (ICP)

### Primary persona

| Attribute           | Stated / inferred from docs                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Role**            | Engineering teams at **SaaS products** integrating AI (`docs/architecture.md` platform overview)                         |
| **Workflow**        | Configure agents/bridges and versions, wire tools and RAG, expose chatbots/embeds, monitor usage, manage org credentials |
| **Technical level** | Backend-capable: REST consumers, JWT/embed/chatbot auth models, environment configuration for Mongo/Postgres/Redis/Lago  |

### Secondary personas

| Persona                            | How they touch this service                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Org admins**                     | Org creation (`/api/organization`), billing checkout/wallet (`/api/billing`, Lago paths), user/org switching (`/api/user`), API keys |
| **Embed / portal builders**        | Embed login and agent listing (`/api/embed`), folder-scoped model visibility, GraphQL model listing                                  |
| **Operators / support**            | Utils, Redis ops (constrained), reports, alerting, blocked-org controls, internal org tooling                                        |
| **Integration partners**           | Viasocket-style verification via `/api/internal`; tool variable sync (migrations)                                                    |
| **Auditors / analytics consumers** | History, metrics, observability, analytics, batch history, scheduled latency reports (cron)                                          |

Not stated: vertical focus, company size, or whether buyers are builders vs. end enterprises — see open questions.

---

## Problems Solved & Value Proposition

| Customer problem                                       | How gtwy-node addresses it                                                           | What sets it apart (per repo statements)                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Rebuilding AI **configuration** APIs for every product | Central CRUD for agents, versions, chatbots, tools, templates, prompts               | Purpose-built management layer paired with **gtwy-ai** orchestration (`README.md`)                                  |
| Fragmented **auth/org** context across surfaces        | Unified middleware: JWT, chatbot, embed, public agent paths (`docs/architecture.md`) | One backend encodes org/agent ACL patterns used across features                                                     |
| Hard to iterate on **prompts and versions**            | Version lifecycle, prompt history in Postgres, prebuilt libraries                    | Version publish/discard flows and prompt-version audit trail (`docs/architecture.md`)                               |
| Connecting **knowledge (RAG)** without custom infra    | RAG routes broker collections/resources via Hippocampus integration                  | RAG management alongside agent config in one API (`docs/architecture.md`, `.env.example`)                           |
| **Cost and usage** visibility                          | Metrics, reports, Timescale aggregates, alerting hooks                               | Time-series + scheduled reports; ties to billing events where Lago is enabled (`README.md`, `docs/lago-runbook.md`) |
| **Commercial** packaging (credits, plans)              | Lago provisioning, billing plans collection, wallet debits coordinated with gtwy-ai  | Documented cross-service billing contract (`docs/lago-runbook.md`)                                                  |

---

## Core Principles & Design Philosophy

| Principle                                                          | Trade-off it accepts                                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System-first, documented coherence**                             | Ask when intent is unclear; update docs with behavior changes — slower short-term edits, fewer silent architectural drifts (`docs/AI_INSTRUCTIONS.md`)                           |
| **Strict layering (controller → service → db_service)**            | Controllers stay thin; more files and indirection — in exchange for predictable extension points (`docs/AI_INSTRUCTIONS.md`, `docs/architecture.md`)                             |
| **Fail consistently at the edge**                                  | Central `express-async-errors` + `ApiError` + Joi validation — less ad-hoc error handling in handlers, uniform client errors                                                     |
| **Auth context is middleware-owned**                               | `req.profile`, `req.org_id`, role checks live in middleware — handlers assume context exists; new routes must compose the right guard chain                                      |
| **Cache with explicit contracts**                                  | Redis key prefixes in `src/configs/constant.js`; invalidation helpers on config changes — avoids stale agent state at cost of disciplined cache updates (`docs/architecture.md`) |
| **Boot-time configuration asserts for critical commercial config** | Process refuses to start if Lago plan/Stripe billing env is incomplete — prevents half-configured billing deploys (`src/index.js`, `docs/lago-runbook.md`)                       |

---

## Strategic Priorities & Success Measures

**Stated priorities (from docs/code, not a formal roadmap):**

1. Keep the **management API complete and stable** for gtwy-ai and GTWY clients (agents, versions, chatbots, RAG, tools, auth).
2. Operate **billing/wallet** correctly where Lago is enabled, including bootstrap and cross-repo pricing parity with gtwy-ai (`docs/lago-runbook.md`).
3. Maintain **observability** (logging, APM hooks, slow-call tracing, metrics/report crons) for production operations.

**Success metrics:** Not stated in repository docs. Not stated: an owner decides (`docs/OPEN_QUESTIONS.md`).

---

## Boundaries & Non-Goals

### Deliberate boundaries

| Boundary                                            | Rationale (source)                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Not the inference/orchestration runtime**         | README assigns real-time AI execution to gtwy-ai                                                                         |
| **Not a generic arbitrary-code execution platform** | Scope is GTWY agent/bridge/chatbot/RAG/tool configuration and platform ops                                               |
| **Not sole owner of all AI provider calls**         | gtwy-ai emits usage/billing events; Node wallet/plan enforcement is coordinated, not duplicated (`docs/lago-runbook.md`) |

### Anti-patterns (break the vision)

- Putting **heavy business logic in controllers** or bypassing `db_services` / Joi validation.
- **Duplicating orchestration** that belongs in gtwy-ai (prompt execution, model routing at inference time).
- **Inventing billing or plan behavior** that contradicts Lago as plan-of-record and documented Redis/cache rules (`docs/lago-runbook.md`).
- **Destructive Redis operations** that wipe non-regenerable `nd_` keys (documented warning against `FLUSHALL` in production).
- **Shipping features without updating** `docs/architecture.md` / runbooks when subsystems or contracts change (`docs/architecture.md` developer playbook).

### Not stated

- Multi-region, on-prem-only, or air-gapped deployment models — owner decides.
- Full public API versioning policy beyond existing route layout — owner decides.

---

## How Future Agents Must Evaluate Requests

1. **Compare the request** to _Approved Direction_, _ICP_, _Principles_, and _Non-Goals_ in this file—not to the request’s own wording.
2. **Clarify** ambiguous requests against `docs/OPEN_QUESTIONS.md` before coding; if VISION is silent, ask the owner rather than assume.
3. **On conflict**, explain which section conflicts and recommend declining or reshaping the request; use `needs_decision` when two valid readings exist.
4. **Deliberate direction changes** require an explicit owner decision and an update to this file in the **same change** as the code (brief delta only—do not rewrite vision to bypass gates).
5. **Read first:** [`docs/AI_INSTRUCTIONS.md`](./AI_INSTRUCTIONS.md) and [`docs/architecture.md`](./architecture.md); use [`docs/lago-runbook.md`](./lago-runbook.md) for billing-touched work.
6. **Cross-service contracts:** When a feature needs backend capabilities that do not exist (especially vs. gtwy-ai or third parties), describe the contract in **[`docs/CONTRACTS.md`](./CONTRACTS.md)** (create or extend). Never fabricate mock endpoints or fake integrations.
7. **Preserve separation:** Management/config in this repo; inference/orchestration in gtwy-ai unless owners explicitly change _Approved Direction_ here.

---

_Draft vision recovered from repository sources only. An owner must review and approve before treating this file as binding for merge._

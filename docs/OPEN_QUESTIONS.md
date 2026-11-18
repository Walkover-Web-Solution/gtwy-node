# Open Questions

Items below are **not stated** in repository docs or code comments in a way that settles product direction. An owner should answer them; until then, agents treat them as decisions, not assumptions.

## Product & audience

1. **Primary ICP beyond “SaaS products”** — Which industries, company sizes, and buyer roles (CTO vs. product vs. solutions engineer) are in scope for GTWY.AI as a platform?
2. **gtwy-node vs. gtwy-ai ownership boundaries** — Which features must live only in the Python orchestration service vs. this Node management API? README draws a line at “real-time inference” vs. “CRUD/management”; is that the full contract?
3. **Success metrics** — What KPIs (revenue, active orgs, inference volume, time-to-first-agent, etc.) define success for the platform and for this service?

## Licensing & naming

4. **License** — `README.md` references an MIT `LICENSE` file, but no `LICENSE` file is in the repo and `package.json` lists `"license": "ISC"`. Which license applies?
5. **Package name `plug-service-v2`** — Is this an internal codename, legacy name, or the intended published package identity?

## Commercial & billing

6. **Billing as product boundary** — Is Lago-backed wallet/credits billing a core product requirement for all environments, or an optional commercial layer (given gtwy-ai “fails open” when `billing_plans` is empty per `docs/lago-runbook.md`)?
7. **Plan tiers and entitlements** — Beyond FREE/PAID plan codes enforced at boot, what feature gates (models, hit fees, embed limits) are authoritative and where is that matrix documented?

## Integrations

8. **MSG91** — What is MSG91’s role in the identity/org model (signup webhooks, embed user emails) and which flows are supported long term?
9. **Hippocampus** — Is Hippocampus the sole RAG backend, or one of several options?
10. **Viasocket** — Is Viasocket a first-class integration partner (tool sync, `/api/internal`) or ancillary?

## Operations & environments

11. **Repository naming** — README clone URL still points at `AI-middleware`; canonical repo is `gtwy-node`. Which name is customer-facing?
12. **GraphQL surface** — `/api/service/graphql` exists alongside REST for model/service listing. Is GraphQL a supported public contract for embed/folder clients or convenience for a specific UI?

## Governance

13. **Vision approval process** — Who approves changes to `docs/VISION.md` and how often should `verified_at` / `verified_on` be refreshed?

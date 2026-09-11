# Lago billing runbook

What runs automatically on deploy, what has to be run by hand, and in what
order. Read this before deploying the wallet/credits feature to a new
environment or re-provisioning an existing one.

## Runs automatically on deploy

**Nothing billing-related.** There is no billing migration: setting an
environment up is one deliberate, manual step — `scripts/bootstrapBilling.js`,
below. A deploy alone never creates plans, never touches Lago and never writes
Redis.

The one thing a deploy does enforce is env: `src/index.js` calls
`assertBillingPlansConfigured()` at startup, which **throws** when a
`LAGO_PLAN_CODE_*` is missing, so the container will not start half-configured.

### If the bootstrap was never run on an environment

`billing_plans` is empty, and gtwy-ai then **fails open** — no plan rules means
every model is allowed. It is not silent: gtwy-ai logs
`billing_plans is EMPTY — plan enforcement is DISABLED` at startup and, throttled
to once a minute, on the request path. If you see that line, the bootstrap has
not been run there.

## Clear the plan cache on the deploy that ships this

One-time, per environment, and only on the deploy that first ships this code.

Node used to write `nd_org_billing_plan_*` with a bare `SET` and **no TTL**,
while gtwy-ai sets a TTL only when it creates the key — it never revalidates one
that already exists. So every key Node ever wrote is immortal, and an org whose
plan changed is wrong forever. Node now DELETES that key on a plan change
instead of writing it, so no new immortal keys appear; these are the ones
already out there.

Do it **after** the old build has stopped and **before** the new one serves
traffic. Any earlier and the still-running old build re-mints them.

```bash
redis-cli -u "$REDIS_URI" --scan --pattern "AIMIDDLEWARE_${ENVIRONMENT}_nd_org_billing_plan_*" \
  | xargs -r redis-cli -u "$REDIS_URI" del
```

Pass `-u "$REDIS_URI"` on **both** halves of that pipe. A bare `redis-cli` talks
to localhost, finds nothing, deletes nothing and exits 0 — it looks like it
worked.

Losing these costs nothing: they are a read-through cache, and gtwy-ai
repopulates each from Lago — with a TTL this time — on the next request for that
org.

`DELETE /api/utils/redis` refuses `nd_` prefixed keys, so this needs redis-cli.

**Do not `FLUSHALL` production to achieve this.** `src/configs/constant.py:67`
splits the keys deliberately: `cd_` is regenerable cache, `nd_` is "source of
truth or cost/metrics accumulator". A flush also takes `nd_gpt_memory_`
(agents' stored memory — user-visible and not rebuildable),
`nd_bridgeusedcost_` / `nd_folderusedcost_` / `nd_apikeyusedcost_` (cost
accumulators), `nd_dailyusedcost_` and `nd_usagealertsent_` (spend-alert buckets
and their de-dupe markers, so alerts re-fire), and `nd_batch_` (in-flight batch
state). The billing keys themselves are safe to lose — the shadow balance
reseeds from Lago and holds release as no-ops — it is the neighbours that hurt.
Flushing a test environment is fine.

## Required env before you deploy

`src/index.js` calls `assertBillingPlansConfigured()` at startup, which
**throws** if a plan code is missing — the container will not start.

| var                                                                | why                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `LAGO_PLAN_CODE_FREE`                                              | boot assert                                                                                         |
| `LAGO_PLAN_CODE_PAID`                                              | boot assert                                                                                         |
| `LAGO_CREDIT_RATE_USD`                                             | `createWallet` refuses without it; gtwy-ai refuses to _start_ without it when `LAGO_API_URL` is set |
| `GTWY_COMMISSION_PCT`                                              | must be **identical** in both repos or background jobs are priced differently from main calls       |
| `LAGO_SIGNUP_GRANT_CREDITS`                                        | unset ⇒ new orgs get 0 credits                                                                      |
| `GTWY_PLATFORM_ORG_ID`                                             | without it, background jobs bill the platform org                                                   |
| `BILLING_API_URL`, `BILLING_API_KEY`                               | Lago client                                                                                         |
| `BILLING_CREDIT_USAGE_EVENT_CODE`, `BILLING_CREDIT_USAGE_PROPERTY` | usage event code + property                                                                         |
| `LAGO_PROVISION_WEBHOOK_TOKEN`                                     | optional; `/api/lago/provision` is unauthenticated until set                                        |

gtwy-ai (Python) has no migrations at all — nothing to run there.

## Manual, once per environment

Two commands, in this order. Nothing billing-related runs on deploy.

### 1. Platform provider keys — nothing works without these

`platform_apikeys` is the **sole** source of the provider keys wallet-billed
traffic runs on. There is no env fallback. An empty collection means every
wallet agent is keyless and wallet traffic cannot run; gtwy-ai logs
`platform_apikeys collection is EMPTY` at startup.

Seed a key for every service the plans allow. The free plan allows `neev_cloud`
and `open_router`, so those two are the minimum for free-plan traffic to work at
all.

```bash
PLATFORM_NEEV_CLOUD_API_KEY='...' PLATFORM_OPEN_ROUTER_API_KEY='...' node scripts/seedPlatformApiKeys.js --dry-run
PLATFORM_NEEV_CLOUD_API_KEY='...' PLATFORM_OPEN_ROUTER_API_KEY='...' node scripts/seedPlatformApiKeys.js
```

Upsert keyed on `service`, so re-running is safe and rotating a key is just
another run. Other providers use `PLATFORM_OPENAI_API_KEY`,
`PLATFORM_ANTHROPIC_API_KEY`, `PLATFORM_GROQ_API_KEY`, … Once seeded, keys are
managed through `GET`/`PUT /api/platform-keys`.

### 2. Bootstrap the environment — the one command

`scripts/bootstrapBilling.js` pre-flights, seeds `billing_plans`, lists every
org on the MSG91 account, gives each one a Lago customer + FREE subscription +
wallet, and drops that org's stale Redis billing keys. Run it by hand, once per
environment, dev first and prod later with the same command.

```bash
node scripts/bootstrapBilling.js --dry-run          # check everything, change nothing
node scripts/bootstrapBilling.js --yes              # do it
node scripts/bootstrapBilling.js --yes --org-id=74145,11643
```

It refuses to run without `--dry-run` or `--yes`, because a full run grants
`LAGO_SIGNUP_GRANT_CREDITS` to every org that has no wallet yet — the dry run
prints that worst-case total before you commit to it. For testing, name the orgs
with `--org-id=` rather than provisioning the whole account.

Re-runs are safe and are the resume mechanism: every write is read-before-write
or upsert-on-insert, so a second run skips what exists and never re-grants. If a
run dies part way through, run it again.

Each real run writes `bootstrapBilling-<env>-<timestamp>.json` in the working
directory, listing the orgs whose wallets were created, the ones skipped, and
any failures with their error — keep it, it is the record of what was granted.

The pre-flight refuses to continue on missing env, an unreachable Lago, a plan
code that does not exist in Lago, or an unusable credit rate, and warns (without
blocking) when step 1 was skipped for a free-plan service.

## Wiping an environment and starting fresh

Only for non-production. Deleting a Lago customer takes its subscriptions,
wallets, events and invoices with it, irreversibly — confirm Lago permits it for
customers with finalized invoices before planning around it.

0. **Confirm this environment's `BILLING_API_URL` is not the one production
   uses.** Lago is hosted, not per-environment by default; deleting customers on
   a shared instance deletes them for every environment pointed at it.
1. `node scripts/bootstrapBilling.js --dry-run` — confirm the org count and the
   worst-case grant total _before_ deleting anything.
2. Delete the Lago customers.
3. **Purge Redis** for any org you will not re-provision immediately. The
   shadow balance is seeded `SET NX` with **no TTL** and is never revalidated
   while the key exists, so a deleted wallet plus a stale key means the
   admission gate hands out credits that no longer exist. `bootstrapBilling`
   clears these per org as it provisions, so orgs you do re-provision are
   covered; this step is for the ones left behind.

   | key pattern                        | why                                                                      |
   | ---------------------------------- | ------------------------------------------------------------------------ |
   | `nd_billing_credit_balance_{org}`  | phantom balance; the gate reads only this                                |
   | `nd_org_billing_plan_{org}`        | stale plan                                                               |
   | `nd_billing_sub_external_id_{org}` | would point at a deleted subscription                                    |
   | `cd_billing_wallet_{org}`          | stale wallet shown by `GET /api/lago/wallet` (60s TTL, so it self-heals) |

   Note the balance key carries a `{hash tag}` and the others do not — that is
   deliberate, the Lua scripts need the balance and its claim key in one cluster
   slot. `bootstrapBilling` builds all four from `redis_keys` so they cannot
   drift from the running code.

   Note `DELETE /api/utils/redis` deliberately refuses `nd_` prefixed keys, so
   this needs redis-cli.

4. `node scripts/bootstrapBilling.js --yes` for real — or
   `--yes --org-id=a,b,c` to bring back only the orgs you actually test with,
   which is usually what you want. It clears each org's Redis keys as it goes,
   so step 3 is belt-and-braces rather than the only guard.
5. Verify: one active wallet per org (two is a real bug — the balance read picks
   whichever Lago returns first), and no `expiration_at` anywhere.

A fresh provision is also the cheapest way to normalise subscription ids. Three
spellings exist in the wild (`11643`, `sub-11643`, `sub_11643`) because earlier
code guessed differently. `walletDebit` now reads the real id from Lago and
caches it, so a wipe is not _required_ for correctness — but it does clean the
history up.

## Verifying an environment

```bash
curl -s "$BASE/api/billing-plans"       -H "Authorization: $JWT"   # plans seeded?
curl -s "$BASE/api/platform-keys"       -H "Authorization: $JWT"   # provider keys present?
curl -s "$BASE/api/lago/plan/<org_id>"  -H "Authorization: $JWT"   # Lago vs Redis plan drift
curl -s "$BASE/api/lago/wallet"         -H "Authorization: $JWT"   # caller's own wallet
```

Auth on the billing routes, since it is not uniform:

| route                           | auth                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/lago/provision`      | **none** — MSG91 webhook; only the optional `LAGO_PROVISION_WEBHOOK_TOKEN` header guards it |
| `GET /api/lago/wallet`          | any signed-in user (own org, from the token)                                                |
| `GET /api/lago/plan/me`         | any signed-in user                                                                          |
| `GET /api/billing-plans/public` | any signed-in user; safe fields only, no `services`                                         |
| everything else                 | `InternalAuth`                                                                              |

`InternalAuth` is an **email allowlist** (see `middlewares/middleware.js`) — a
token for an address outside that list gets 403 regardless of role.

Failed debits are never dropped silently. Lago rejections are stored in
`failed_billing_debits` with status `failed` and are replayable:

```bash
curl -s -X POST "$BASE/api/lago/debits/replay" -H "Authorization: $JWT" -H 'Content-Type: application/json' --data '{"limit":100}'
```

Rows stored as `ambiguous` (no answer from Lago — the event may have landed, and
Lago does not dedup a resend) are left for manual review on purpose:
under-charging beats double-charging.

/**
 * One-shot billing bootstrap for a whole environment. Run it by hand, per env.
 *
 *   node scripts/bootstrapBilling.js --dry-run     # check everything, change nothing
 *   node scripts/bootstrapBilling.js --yes         # do it
 *   node scripts/bootstrapBilling.js --yes --org-id=74145,11643
 *
 * What it does, in order:
 *   1. pre-flight  — required env, Lago reachable, both plan codes exist in Lago,
 *                    platform provider keys present for the free plan's services
 *   2. mongo       — seed billing_plans (free = neev_cloud + open_router, paid = *)
 *   3. orgs        — list every org from the MSG91 account
 *   4. lago        — customer + FREE subscription + wallet for each org
 *   5. redis       — drop that org's stale billing keys
 *   6. report      — write a JSON summary next to the script's cwd
 *
 * Safe to re-run. Every write is read-before-write or upsert-on-insert, so a
 * second run skips what already exists and never re-grants credits. That is also
 * the resume mechanism: if a run dies half way, run it again.
 *
 * MONEY: each org that does NOT already have a wallet is granted
 * LAGO_SIGNUP_GRANT_CREDITS. The dry run prints the worst-case total. A real run
 * refuses to start without --yes.
 */

import dotenv from "dotenv";
import axios from "axios";
import mongoose from "mongoose";

dotenv.config();

const FREE_PLAN_SLUG = "free";
// The free plan allows these services in full. "*" per service, so a model added
// to either one later is included with no edit anywhere.
const FREE_SERVICES = ["neev_cloud", "open_router"];

const REQUIRED_ENV = [
  "MONGODB_CONNECTION_URI",
  "BILLING_API_URL",
  "BILLING_API_KEY",
  "LAGO_PLAN_CODE_FREE",
  "LAGO_PLAN_CODE_PAID",
  "LAGO_CREDIT_RATE_USD",
  "PUBLIC_REFERENCEID",
  "ADMIN_API_KEY"
];

function parseArgs(argv) {
  const args = { dryRun: false, yes: false, orgIds: null, concurrency: 3, delayMs: 150 };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--yes") args.yes = true;
    else if (arg.startsWith("--org-id=")) args.orgIds = arg.split("=")[1].split(",").filter(Boolean);
    else if (arg.startsWith("--concurrency=")) args.concurrency = Number(arg.split("=")[1]);
    else if (arg.startsWith("--delay-ms=")) args.delayMs = Number(arg.split("=")[1]);
    else throw new Error(`unknown argument '${arg}'`);
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const lagoHeaders = () => ({ Authorization: `Bearer ${process.env.BILLING_API_KEY}`, "Content-Type": "application/json" });
const lagoUrl = () => String(process.env.BILLING_API_URL).replace(/\/$/, "");

// ---------------------------------------------------------------- 1. pre-flight

async function preflight(db) {
  const problems = [];

  const missing = REQUIRED_ENV.filter((key) => !process.env[key] || String(process.env[key]).trim() === "");
  if (missing.length) problems.push(`missing env: ${missing.join(", ")}`);
  if (missing.includes("BILLING_API_URL") || missing.includes("BILLING_API_KEY")) return problems;

  // Both plan codes must exist in Lago, or a subscription lands on a plan that
  // is not there and the org cannot be classified.
  try {
    const response = await axios.get(`${lagoUrl()}/plans?per_page=100`, { headers: lagoHeaders(), timeout: 10000 });
    const codes = (response.data?.plans || []).map((plan) => plan.code);
    for (const key of ["LAGO_PLAN_CODE_FREE", "LAGO_PLAN_CODE_PAID"]) {
      const code = process.env[key];
      if (code && !codes.includes(code)) problems.push(`${key}='${code}' does not exist in Lago (has: ${codes.join(", ") || "none"})`);
    }
  } catch (err) {
    problems.push(`Lago unreachable: ${err.message}`);
  }

  // gtwy-ai refuses to start when this is set but unusable, and a wallet cannot
  // be created without it.
  const rate = Number(process.env.LAGO_CREDIT_RATE_USD);
  if (!Number.isFinite(rate) || rate <= 0) problems.push(`LAGO_CREDIT_RATE_USD='${process.env.LAGO_CREDIT_RATE_USD}' is not a positive number`);

  const grant = process.env.LAGO_SIGNUP_GRANT_CREDITS;
  if (grant == null || String(grant).trim() === "") {
    console.warn("  WARN  LAGO_SIGNUP_GRANT_CREDITS is not set — every new wallet gets 0 credits.");
  }

  // Free-plan traffic runs on OUR provider keys. No key for a free service means
  // free-plan agents are dropped as keyless, so the plan is unusable.
  const seeded = (
    await db
      .collection("platform_apikeys")
      .find({}, { projection: { service: 1 } })
      .toArray()
  ).map((doc) => doc.service);
  const keyless = FREE_SERVICES.filter((service) => !seeded.includes(service));
  if (keyless.length) {
    console.warn(
      `  WARN  no platform api key for ${keyless.join(", ")} — the free plan allows those services, so free-plan\n` +
        "        requests will be refused as keyless until you run scripts/seedPlatformApiKeys.js.\n" +
        `        (platform_apikeys currently holds: ${seeded.join(", ") || "nothing"})`
    );
  }

  return problems;
}

// -------------------------------------------------------------------- 2. mongo

// Raw driver on purpose, NOT the Mongoose model: the model defaults credit_grant
// to 0, and a present-but-zero credit_grant makes resolveGrantCredits return 0
// instead of falling back to LAGO_SIGNUP_GRANT_CREDITS — every new org would get
// an empty wallet. Absent is the meaningful state, so the field is omitted.
async function seedBillingPlans(db, { dryRun }) {
  const services = Object.fromEntries(FREE_SERVICES.map((service) => [service, "*"]));
  const now = new Date();
  const seed = [
    { plan_code: FREE_PLAN_SLUG, display_name: "Free", services, status: 1, updated_by: "script:bootstrapBilling" },
    { plan_code: "paid", display_name: "Pro", services: "*", status: 1, updated_by: "script:bootstrapBilling" }
  ];

  const existing = (
    await db
      .collection("billing_plans")
      .find({}, { projection: { plan_code: 1 } })
      .toArray()
  ).map((doc) => doc.plan_code);
  const toInsert = seed.filter((plan) => !existing.includes(plan.plan_code)).map((plan) => plan.plan_code);

  if (dryRun) {
    console.log(`  billing_plans: would insert ${toInsert.join(", ") || "nothing"}; already present: ${existing.join(", ") || "none"}`);
    return;
  }

  await db.collection("billing_plans").createIndex({ plan_code: 1 }, { unique: true });
  // $setOnInsert: an admin edit made through PUT /api/billing-plans is never
  // clobbered by a re-run.
  const result = await db.collection("billing_plans").bulkWrite(
    seed.map((plan) => ({
      updateOne: {
        filter: { plan_code: plan.plan_code },
        update: { $setOnInsert: { ...plan, created_at: now, updated_at: now } },
        upsert: true
      }
    })),
    { ordered: false }
  );
  console.log(`  billing_plans: ${result.upsertedCount} inserted, ${seed.length - result.upsertedCount} already present`);
  console.log(`  free plan allows: ${FREE_SERVICES.join(", ")} (all models). paid plan allows everything.`);
}

// --------------------------------------------------------------------- 3. orgs

async function fetchAllOrgIds() {
  const PAGE_SIZE = 1000;
  const ids = [];
  for (let page = 1; ; page++) {
    const response = await axios.get(
      `https://routes.msg91.com/api/${process.env.PUBLIC_REFERENCEID}/getCompanies?itemsPerPage=${PAGE_SIZE}&pageNo=${page}`,
      { headers: { authkey: process.env.ADMIN_API_KEY }, timeout: 30000 }
    );
    // The array is TWO levels deep: { data: { data: [orgs], totalPageCount } }.
    const payload = response.data?.data;
    const orgs = Array.isArray(payload?.data) ? payload.data : null;
    // Never read an unexpected shape as "no orgs" — that turns a broken call
    // into a successful-looking no-op.
    if (orgs === null) throw new Error(`getCompanies page ${page}: expected data.data to be an array, got ${JSON.stringify(payload).slice(0, 200)}`);
    ids.push(...orgs.map((org) => String(org.id)));
    const totalPages = Number(payload.totalPageCount);
    if (Number.isFinite(totalPages) && totalPages > 0 ? page >= totalPages : orgs.length < PAGE_SIZE) break;
  }
  return ids;
}

// ------------------------------------------------------------ 4 + 5. lago, redis

async function provisionAll(orgIds, { concurrency, delayMs }, deps) {
  const { ensureOrgSubscribed, clearOrgBillingKeys } = deps;
  const summary = { provisioned: [], skipped: [], failed: [] };
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < orgIds.length) {
      const orgId = orgIds[cursor++];
      try {
        const result = await ensureOrgSubscribed(orgId, { plan_slug: FREE_PLAN_SLUG });
        // Lago is the org's new truth, so any leftover Redis billing state for it
        // is stale. The shadow balance in particular is written once with NO
        // expiry and never revalidated, so a stale one lets an org spend credits
        // that no longer exist.
        const cleared = await clearOrgBillingKeys(orgId);
        const walletExisted = Boolean(result.wallet?.skipped);
        (walletExisted ? summary.skipped : summary.provisioned).push(orgId);
        done += 1;
        console.log(
          `  [${done}/${orgIds.length}] org ${orgId}: ${walletExisted ? "already had a wallet" : "WALLET CREATED (granted)"}` +
            `, plan=${result.plan}, redis keys cleared=${cleared}`
        );
      } catch (err) {
        summary.failed.push({ orgId, error: err.response?.data ?? err.message });
        done += 1;
        console.error(`  [${done}/${orgIds.length}] org ${orgId}: FAILED — ${err.message}`);
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return summary;
}

// --------------------------------------------------------------------- runner

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && !args.yes) {
    throw new Error("refusing to run: pass --dry-run to inspect, or --yes to actually provision (it grants real credits)");
  }

  console.log(`\n=== billing bootstrap (${args.dryRun ? "DRY RUN" : "LIVE"}) ===`);
  console.log(`env=${process.env.ENVIRONMENT} db=${String(process.env.MONGODB_CONNECTION_URI).split("/").pop()} lago=${lagoUrl()}\n`);

  await mongoose.connect(process.env.MONGODB_CONNECTION_URI);
  const db = mongoose.connection.db;

  console.log("1. pre-flight");
  const problems = await preflight(db);
  if (problems.length) {
    console.error("\n  BLOCKED:\n" + problems.map((p) => `   - ${p}`).join("\n"));
    throw new Error("pre-flight failed — nothing was changed");
  }
  console.log("  ok");

  console.log("\n2. mongo");
  await seedBillingPlans(db, args);

  console.log("\n3. orgs");
  const orgIds = args.orgIds ?? (await fetchAllOrgIds());
  console.log(`  ${orgIds.length} org(s)${args.orgIds ? " (from --org-id)" : " from the MSG91 account"}`);

  const grant = Number(process.env.LAGO_SIGNUP_GRANT_CREDITS || 0);
  console.log(`  worst case: ${orgIds.length} x ${grant} = ${orgIds.length * grant} credits granted (orgs with a wallet already are skipped)`);

  if (args.dryRun) {
    console.log(`\n  DRY RUN — stopping here. Nothing was written to Mongo, Lago or Redis.`);
    console.log(`  org ids: ${orgIds.slice(0, 20).join(", ")}${orgIds.length > 20 ? `, … (+${orgIds.length - 20})` : ""}`);
    return;
  }

  // Imported here, not at the top: importing lago.service opens a Redis
  // connection as a side effect, and a dry run should not need one.
  const { ensureOrgSubscribed } = await import("../src/services/lago.service.js");
  const { default: redisClient } = await import("../src/services/cache.service.js");
  const { redis_keys } = await import("../src/configs/constant.js");

  const prefix = `AIMIDDLEWARE_${process.env.ENVIRONMENT}_`;
  const clearOrgBillingKeys = async (orgId) => {
    if (!redisClient.isReady) return 0;
    // The balance and applied-claim keys carry a {hash tag}; the others do not.
    // Built from redis_keys so these cannot drift from the running code.
    const keys = [
      `${prefix}${redis_keys.billing_credit_balance_}{${orgId}}`,
      `${prefix}${redis_keys.org_billing_plan_}${orgId}`,
      `${prefix}${redis_keys.billing_sub_external_id_}${orgId}`,
      `${prefix}${redis_keys.billing_wallet_}${orgId}`
    ];
    return redisClient.del(keys).catch(() => 0);
  };

  console.log("\n4. lago + 5. redis");
  const summary = await provisionAll(orgIds, args, { ensureOrgSubscribed, clearOrgBillingKeys });

  console.log("\n6. report");
  const reportPath = `bootstrapBilling-${process.env.ENVIRONMENT}-${Date.now()}.json`;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(reportPath, JSON.stringify({ ran_at: new Date().toISOString(), environment: process.env.ENVIRONMENT, ...summary }, null, 2));

  console.log(`  wallets created : ${summary.provisioned.length}`);
  console.log(`  already had one : ${summary.skipped.length}`);
  console.log(`  failed          : ${summary.failed.length}`);
  console.log(`  credits granted : ~${summary.provisioned.length * grant}`);
  console.log(`  report          : ${reportPath}`);
  if (summary.failed.length) console.log("  re-run the same command to retry the failures — it skips what already exists.");

  await redisClient.quit().catch(() => {});
}

main()
  .then(async () => {
    await mongoose.disconnect().catch(() => {});
    console.log("\ndone.\n");
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`\nFATAL: ${error?.message ?? error}\n`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });

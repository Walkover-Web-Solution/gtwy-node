/**
 * Migration: seed the billing_plans collection
 *
 * billing_plans replaces the per-model `free_tier` boolean as the source of
 * truth for what a plan may spend wallet credits on. One editable document per
 * plan, read live by gtwy-ai through a change stream — so changing a plan no
 * longer needs a migration or a raw Mongo write, which is what it needs today
 * (the live bulk-update endpoint's allowlist omits free_tier, and
 * updateModelConfigs, which allowlists it, has no route).
 *
 * The `free` allowlist is DERIVED from the current free_tier flags so day-one
 * behaviour is identical to before. Services where EVERY active model is
 * free_tier collapse to "*", which is equivalent today and additionally lets
 * future models of that service in automatically (this is how neev_cloud —
 * self-hosted, near-zero marginal cost — becomes "*"). Services where only
 * some models qualify stay enumerated, so "all of OpenRouter" can never
 * accidentally hand free orgs a frontier model on the platform wallet.
 *
 * plan_code is the wire slug shared with gtwy-ai and Redis and must stay
 * "free"/"paid": billing_utils.get_org_plan hardcodes that tuple and coerces
 * anything else to "free", so a new slug would silently restrict paying orgs.
 * "Pro" is display_name only.
 *
 * Neither plan sets credit_grant: the signup grant is still undecided, so it
 * comes from LAGO_SIGNUP_GRANT_CREDITS until someone puts a number on a plan.
 *
 * $setOnInsert throughout: re-running must never clobber a deliberate admin
 * edit. (Contrast 20260831120000-add_free_tier_flag.js, whose $set re-forces
 * every value on every run.)
 *
 * free_tier is deliberately left on the model documents — nothing reads it after
 * this, but keeping it makes the change reversible and leaves dashboards intact.
 * A follow-up migration drops it.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

const PLAN_CODES = ["free", "paid"];

export const up = async (db) => {
  const plans = db.collection("billing_plans");
  await plans.createIndex({ plan_code: 1 }, { unique: true });

  // Per service: how many active models exist, and how many are free_tier.
  const rows = await db
    .collection("modelconfigurations")
    .aggregate([
      { $match: { status: 1 } },
      {
        $group: {
          _id: "$service",
          total: { $sum: 1 },
          free_models: { $push: { $cond: [{ $eq: ["$free_tier", true] }, "$model_name", "$$REMOVE"] } }
        }
      }
    ])
    .toArray();

  const services = {};
  for (const row of rows) {
    if (!row._id || row.free_models.length === 0) continue;
    services[row._id] = row.free_models.length === row.total ? "*" : row.free_models.sort();
  }

  // Nothing flagged free_tier means 20260831120000-add_free_tier_flag.js never
  // ran in this environment (verified: on AI_Middleware-test the field is absent
  // from every document and the migration is not in the changelog). Transcribing
  // that would seed a free plan allowing NOTHING, which gtwy-ai rejects — it
  // would keep its previous registry and log an error, and enforcement would
  // never come up. So fall back to the same INTENT that migration encoded:
  // every neev_cloud model (self-hosted, near-zero marginal cost) plus
  // OpenRouter's ":free" models. Same collapse rule as above, so a service whose
  // every active model qualifies becomes "*".
  if (Object.keys(services).length === 0) {
    console.log("No free_tier flags found — deriving the free allowlist from the add_free_tier_flag rule instead.");
    const fallback = await db
      .collection("modelconfigurations")
      .aggregate([
        { $match: { status: 1, $or: [{ service: "neev_cloud" }, { service: "open_router", model_name: { $regex: /:free$/ } }] } },
        { $group: { _id: "$service", models: { $addToSet: "$model_name" } } }
      ])
      .toArray();
    const totals = Object.fromEntries(rows.map((r) => [r._id, r.total]));
    for (const row of fallback) {
      if (!row._id || row.models.length === 0) continue;
      services[row._id] = row.models.length === totals[row._id] ? "*" : row.models.sort();
    }
  }

  const now = new Date();
  const seed = [
    {
      plan_code: "free",
      display_name: "Free",
      services,
      // credit_grant deliberately OMITTED. The signup grant is still being
      // decided, so it is governed by LAGO_SIGNUP_GRANT_CREDITS for now and
      // one env change moves it. Adding credit_grant to a plan document
      // overrides the env for that plan — the mechanism is already in
      // lago.service.resolveGrantCredits, so switching to per-plan grants later
      // needs no code change.
      status: 1,
      updated_by: "migration:20260904120000"
    },
    {
      plan_code: "paid",
      display_name: "Pro",
      services: "*",
      status: 1,
      updated_by: "migration:20260904120000"
    }
  ];

  const result = await plans.bulkWrite(
    seed.map((plan) => ({
      updateOne: {
        filter: { plan_code: plan.plan_code },
        update: { $setOnInsert: { ...plan, created_at: now, updated_at: now } },
        upsert: true
      }
    })),
    { ordered: false }
  );

  const summary = Object.entries(services)
    .map(([svc, models]) => `${svc}=${models === "*" ? "*" : models.length}`)
    .join(", ");
  console.log(
    `Seeded billing_plans: ${result.upsertedCount} inserted, ${seed.length - result.upsertedCount} already present. ` +
      `free allowlist derived from free_tier: ${summary || "(none — free plan allows nothing, CHECK THIS)"}`
  );
  if (Object.keys(services).length === 0) {
    console.warn(
      "WARNING: no free_tier models found, so the free plan allows nothing. " +
        "gtwy-ai rejects a plan that allows nothing and keeps its previous registry — " +
        "fix the allowlist via PUT /api/billing-plans before relying on enforcement."
    );
  }
};

export const down = async (db) => {
  await db.collection("billing_plans").deleteMany({ plan_code: { $in: PLAN_CODES } });
};

import axios from "axios";
import mongoose from "mongoose";
import models from "../../models/index.js";
import ApikeyCredential from "../mongoModel/Api.model.js";

// Platform-key usage, merged from two sources:
//   DB side  — timescale.daily_data for every row whose apikey_id is NOT a
//              known BYOK ObjectId (gtwy-ai writes NULL / sentinel for platform
//              traffic). Gives requests, tokens, model cost.
//   Lago side — GET /events filtered by the usage metric. Every usage debit
//              carries { external_subscription_id = org_id, properties: { service,
//              bridge_id, model, credits, ... } }. BYOK never debits the wallet,
//              so these events are platform-key by construction.
// Rows are joined on (service, org_id, bridge_id) and returned side by side.

const ALLOWED_GROUP_COLS = new Set(["service", "org_id", "bridge_id", "apikey_id"]);
const GROUP_ALIASES = {
  service: "service",
  org: "org_id",
  org_id: "org_id",
  bridge: "bridge_id",
  bridge_id: "bridge_id",
  agent: "bridge_id",
  apikey_id: "apikey_id",
  apikey: "apikey_id"
};

// Platform-key cost per agent (bridge_id). Pulls from both sources and returns
// a flat list: bridge_id, cost_usd (from daily_data), credits (from Lago),
// requests, total_tokens, services used. Nothing else — matches the "just the
// agent and what it cost" question.
export async function getPlatformKeyCostByAgent({ days = 7, limit = 1000, service = null } = {}) {
  const sequelize = models.timescale?.sequelize;
  if (!sequelize) throw new Error("timescale DB not configured");
  const window_days = Number(days) || 7;
  const safeLimit = Math.min(Number(limit) || 1000, 5000);

  const byok = await fetchByokIds();

  const where = ["created_at >= NOW() - (:window)::interval", "bridge_id IS NOT NULL AND bridge_id <> ''"];
  const replacements = { window: `${window_days} days`, limit: safeLimit };
  if (service) {
    where.push("service = :service");
    replacements.service = service;
  }
  if (byok.size === 0) {
    where.push("(apikey_id IS NULL OR apikey_id = '')");
  } else {
    where.push("(apikey_id IS NULL OR apikey_id = '' OR apikey_id NOT IN (:byokIds))");
    replacements.byokIds = [...byok];
  }

  // Per (bridge, service, model) from the DB — the finest grain we need.
  const [dbRows] = await sequelize.query(
    `SELECT bridge_id,
            service,
            model,
            MIN(org_id)                                 AS org_id,
            COALESCE(SUM(record_count),      0)::bigint AS requests,
            COALESCE(SUM(total_token_count), 0)::bigint AS total_tokens,
            COALESCE(SUM(cost_sum),          0)::float  AS cost_usd,
            COALESCE(SUM(success_count),     0)::bigint AS successes
       FROM daily_data
      WHERE ${where.join(" AND ")}
      GROUP BY bridge_id, service, model
      ORDER BY cost_usd DESC NULLS LAST
      LIMIT :limit`,
    { replacements }
  );

  // Per (bridge, service, model) from Lago, keyed to the same grain.
  const { byKey: lagoByKey, warning } = await queryLagoEvents({ days: window_days, service });
  const lagoAtGrain = new Map(); // `${bridge}|${service}|${model}` -> {credits, events}
  for (const [, lagoRow] of lagoByKey) {
    if (!lagoRow.bridge_id) continue;
    for (const m of lagoRow.lago_models.size ? lagoRow.lago_models : [null]) {
      const k = `${lagoRow.bridge_id}|${lagoRow.service ?? ""}|${m ?? ""}`;
      const cur = lagoAtGrain.get(k) || { lago_credits: 0, lago_events: 0 };
      // lagoRow.lago_credits/events are per (service,org,bridge) — split across models evenly.
      const share = lagoRow.lago_models.size ? 1 / lagoRow.lago_models.size : 1;
      cur.lago_credits += lagoRow.lago_credits * share;
      cur.lago_events += lagoRow.lago_events * share;
      lagoAtGrain.set(k, cur);
    }
  }

  // Group by bridge: each bridge gets a breakdown list.
  const byBridge = new Map();
  for (const r of dbRows) {
    const bridge = byBridge.get(r.bridge_id) || {
      bridge_id: r.bridge_id,
      org_id: r.org_id,
      total_cost_usd: 0,
      total_requests: 0,
      total_tokens: 0,
      total_lago_credits: 0,
      total_lago_events: 0,
      breakdown: []
    };
    const k = `${r.bridge_id}|${r.service ?? ""}|${r.model ?? ""}`;
    const lago = lagoAtGrain.get(k) || { lago_credits: 0, lago_events: 0 };
    lagoAtGrain.delete(k);
    const row = {
      service: r.service,
      model: r.model,
      requests: Number(r.requests || 0),
      total_tokens: Number(r.total_tokens || 0),
      successes: Number(r.successes || 0),
      cost_usd: Number(r.cost_usd || 0),
      lago_credits: lago.lago_credits,
      lago_events: lago.lago_events
    };
    bridge.breakdown.push(row);
    bridge.total_cost_usd += row.cost_usd;
    bridge.total_requests += row.requests;
    bridge.total_tokens += row.total_tokens;
    bridge.total_lago_credits += row.lago_credits;
    bridge.total_lago_events += row.lago_events;
    byBridge.set(r.bridge_id, bridge);
  }

  // Lago-only (service,model) pairs — the DB didn't see them, show anyway.
  for (const [k, lago] of lagoAtGrain) {
    const [bridge_id, svc, model] = k.split("|");
    if (!bridge_id) continue;
    const bridge = byBridge.get(bridge_id) || {
      bridge_id,
      org_id: null,
      total_cost_usd: 0,
      total_requests: 0,
      total_tokens: 0,
      total_lago_credits: 0,
      total_lago_events: 0,
      breakdown: []
    };
    bridge.breakdown.push({
      service: svc || null,
      model: model || null,
      requests: 0,
      total_tokens: 0,
      successes: 0,
      cost_usd: 0,
      lago_credits: lago.lago_credits,
      lago_events: lago.lago_events
    });
    bridge.total_lago_credits += lago.lago_credits;
    bridge.total_lago_events += lago.lago_events;
    byBridge.set(bridge_id, bridge);
  }

  const rows = [...byBridge.values()];
  for (const b of rows) b.breakdown.sort((a, b2) => b2.cost_usd - a.cost_usd || b2.lago_credits - a.lago_credits);
  rows.sort((a, b) => b.total_cost_usd - a.total_cost_usd || b.total_lago_credits - a.total_lago_credits);

  const totals = rows.reduce(
    (acc, r) => ({
      cost_usd: acc.cost_usd + r.total_cost_usd,
      requests: acc.requests + r.total_requests,
      lago_credits: acc.lago_credits + r.total_lago_credits
    }),
    { cost_usd: 0, requests: 0, lago_credits: 0 }
  );

  return { window_days, service: service || null, totals, rows, ...(warning ? { lago_warning: warning } : {}) };
}

export function parseGroupBy(spec) {
  const cols = String(spec || "service,org_id,bridge_id")
    .split(",")
    .map((s) => s.trim())
    .map((s) => GROUP_ALIASES[s] || s)
    .filter((s) => ALLOWED_GROUP_COLS.has(s));
  if (!cols.length) throw new Error("invalid group_by. Use service, org, bridge, apikey_id (comma-separated).");
  return [...new Set(cols)];
}

// Every BYOK apikey id in Mongo, across every org. Not scoped to a user/org.
async function fetchByokIds() {
  const byok = new Set();
  try {
    const direct = await ApikeyCredential.find({}, { _id: 1 }).lean();
    for (const d of direct) if (d?._id) byok.add(String(d._id));
  } catch {
    /* model is subdocument-only — ignore */
  }
  try {
    const cursor = mongoose.connection.db
      .collection("apikeycredentials")
      .find({ "apikey_object.apikey_credentials._id": { $exists: true } }, { projection: { "apikey_object.apikey_credentials._id": 1 } });
    for await (const doc of cursor) {
      const list = doc?.apikey_object?.apikey_credentials || [];
      for (const sub of list) if (sub?._id) byok.add(String(sub._id));
    }
  } catch {
    /* collection shape differs — ignore */
  }
  return byok;
}

async function queryDailyData({ sequelize, days, groupCols, service, mode, byok }) {
  const where = ["created_at >= NOW() - (:window)::interval"];
  const replacements = { window: `${days} days` };
  if (service) {
    where.push("service = :service");
    replacements.service = service;
  }
  if (mode === "platform") {
    if (byok.size === 0) {
      where.push("(apikey_id IS NULL OR apikey_id = '')");
    } else {
      where.push("(apikey_id IS NULL OR apikey_id = '' OR apikey_id NOT IN (:byokIds))");
      replacements.byokIds = [...byok];
    }
  } else if (mode === "byok") {
    if (byok.size === 0) return [];
    where.push("apikey_id IN (:byokIds)");
    replacements.byokIds = [...byok];
  }

  const groupSql = groupCols.join(", ");
  const sql = `
    SELECT ${groupSql},
           COALESCE(SUM(record_count),      0)::bigint AS requests,
           COALESCE(SUM(total_token_count), 0)::bigint AS total_tokens,
           COALESCE(SUM(cost_sum),          0)::float  AS cost_usd,
           COALESCE(SUM(success_count),     0)::bigint AS successes,
           COALESCE(SUM(record_count) - SUM(success_count), 0)::bigint AS failures
      FROM daily_data
     WHERE ${where.join(" AND ")}
     GROUP BY ${groupSql}
     ORDER BY cost_usd DESC NULLS LAST
  `;
  const [rows] = await sequelize.query(sql, { replacements });
  return rows;
}

// Pull every usage event Lago has in the window, aggregated by
// (service, org_id, bridge_id). Paginates until Lago runs out or the safety
// cap is hit — a very busy account can have more events than one request
// should ever burn through.
async function queryLagoEvents({ days, service }) {
  const base = process.env.BILLING_API_URL;
  const key = process.env.BILLING_API_KEY;
  const code = process.env.BILLING_CREDIT_USAGE_EVENT_CODE;
  if (!base || !key || !code) return { byKey: new Map(), warning: "lago not configured" };

  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const from_date = new Date(Date.now() - days * 86400000).toISOString();
  const credits_property = process.env.BILLING_CREDIT_USAGE_PROPERTY || "credits";

  const byKey = new Map(); // `${service}|${org_id}|${bridge_id}` -> { credits, events, models:Set }
  const per_page = 100;
  const MAX_PAGES = 100;
  let warning = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let data;
    try {
      ({ data } = await axios.get(`${base}/events`, { headers, params: { code, from_date, per_page, page }, timeout: 20000 }));
    } catch (err) {
      warning = `lago fetch failed on page ${page}: ${err.message}`;
      break;
    }
    const events = data?.events || [];
    for (const ev of events) {
      const p = ev?.properties || {};
      const evService = p.service || null;
      if (service && evService !== service) continue;
      const org_id = ev.external_customer_id ?? ev.external_subscription_id ?? null;
      const bridge_id = p.bridge_id || null;
      const k = `${evService ?? ""}|${org_id ?? ""}|${bridge_id ?? ""}`;
      const cur = byKey.get(k) || { service: evService, org_id, bridge_id, lago_credits: 0, lago_events: 0, lago_models: new Set() };
      const credits = Number(p[credits_property]);
      if (Number.isFinite(credits)) cur.lago_credits += credits;
      cur.lago_events += 1;
      if (p.model) cur.lago_models.add(String(p.model));
      byKey.set(k, cur);
    }
    if (events.length < per_page) break;
    if (page === MAX_PAGES) warning = `lago safety cap reached at ${MAX_PAGES * per_page} events — results truncated`;
  }
  return { byKey, warning };
}

function joinKey(row, groupCols) {
  return groupCols.map((c) => row[c] ?? "").join("|");
}

export async function getPlatformKeyUsage({
  days = 7,
  groupBy = "service,org_id,bridge_id",
  service = null,
  limit = 1000,
  mode = "platform", // "platform" | "all" | "byok" | "distinct_apikeys" | "combined"
  sources = "both" // "db" | "lago" | "both"
} = {}) {
  const sequelize = models.timescale?.sequelize;
  if (!sequelize) throw new Error("timescale DB not configured");

  const groupCols = parseGroupBy(groupBy);
  const window_days = Number(days) || 7;
  const safeLimit = Math.min(Number(limit) || 1000, 5000);

  // Diagnostic: list every distinct apikey_id with its row count in the window.
  if (mode === "distinct_apikeys") {
    const [rows] = await sequelize.query(
      `SELECT apikey_id,
              COALESCE(SUM(record_count), 0)::bigint AS requests,
              COALESCE(SUM(cost_sum),     0)::float  AS cost_usd
         FROM daily_data
        WHERE created_at >= NOW() - (:window)::interval
          ${service ? "AND service = :service" : ""}
        GROUP BY apikey_id
        ORDER BY requests DESC
        LIMIT :limit`,
      { replacements: { window: `${window_days} days`, limit: safeLimit, ...(service ? { service } : {}) } }
    );
    return { window_days, mode, service, rows };
  }

  const effectiveMode = mode === "combined" ? "platform" : mode;
  const needsBYOK = effectiveMode === "platform" || effectiveMode === "byok";
  const byok = needsBYOK ? await fetchByokIds() : new Set();

  const wantDb = sources === "db" || sources === "both";
  const wantLago = (sources === "lago" || sources === "both") && (mode === "platform" || mode === "combined" || mode === "all");

  const [dbRows, lagoResult] = await Promise.all([
    wantDb ? queryDailyData({ sequelize, days: window_days, groupCols, service, mode: effectiveMode, byok }) : Promise.resolve([]),
    wantLago ? queryLagoEvents({ days: window_days, service }) : Promise.resolve({ byKey: new Map(), warning: null })
  ]);

  // Merge: key by whatever groupCols the caller asked for. If a group col is
  // missing on one side (e.g. apikey_id doesn't exist in Lago), that side
  // contributes nothing for that col — it still shows up under its own key.
  const merged = new Map();
  for (const row of dbRows) {
    const k = joinKey(row, groupCols);
    const base = { ...Object.fromEntries(groupCols.map((c) => [c, row[c] ?? null])) };
    merged.set(k, {
      ...base,
      db_requests: Number(row.requests || 0),
      db_total_tokens: Number(row.total_tokens || 0),
      db_cost_usd: Number(row.cost_usd || 0),
      db_successes: Number(row.successes || 0),
      db_failures: Number(row.failures || 0),
      lago_credits: 0,
      lago_events: 0,
      lago_models: []
    });
  }
  for (const [, lagoRow] of lagoResult.byKey) {
    const row = { service: lagoRow.service, org_id: lagoRow.org_id, bridge_id: lagoRow.bridge_id, apikey_id: null };
    const k = joinKey(row, groupCols);
    const existing = merged.get(k) || {
      ...Object.fromEntries(groupCols.map((c) => [c, row[c] ?? null])),
      db_requests: 0,
      db_total_tokens: 0,
      db_cost_usd: 0,
      db_successes: 0,
      db_failures: 0,
      lago_credits: 0,
      lago_events: 0,
      lago_models: []
    };
    existing.lago_credits += lagoRow.lago_credits;
    existing.lago_events += lagoRow.lago_events;
    const models_set = new Set([...(existing.lago_models || []), ...lagoRow.lago_models]);
    existing.lago_models = [...models_set];
    merged.set(k, existing);
  }

  const rows = [...merged.values()].sort((a, b) => b.db_cost_usd - a.db_cost_usd || b.lago_credits - a.lago_credits).slice(0, safeLimit);

  const totals = rows.reduce(
    (acc, r) => ({
      db_requests: acc.db_requests + r.db_requests,
      db_total_tokens: acc.db_total_tokens + r.db_total_tokens,
      db_cost_usd: acc.db_cost_usd + r.db_cost_usd,
      lago_credits: acc.lago_credits + r.lago_credits,
      lago_events: acc.lago_events + r.lago_events
    }),
    { db_requests: 0, db_total_tokens: 0, db_cost_usd: 0, lago_credits: 0, lago_events: 0 }
  );

  return {
    window_days,
    group_by: groupCols,
    service: service || null,
    mode,
    sources,
    totals,
    rows,
    ...(lagoResult.warning ? { lago_warning: lagoResult.warning } : {})
  };
}

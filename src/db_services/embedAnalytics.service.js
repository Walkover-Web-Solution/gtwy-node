/**
 * Embed-folder analytics — isolated from agent analytics (analytics.service.js).
 *
 * Scope: agents with Configuration.folder_id = embed folder.
 * User identity: bridge.user_id (agent owner) → proxy user details.
 *
 * Query plan (per request, all fired in parallel):
 *   1. PG  `conversation_logs` — one pass producing per-bridge range AND lifetime
 *      counters (requests / success / failures / latency / feedback / threads).
 *      The range + lifetime summaries are folded up from these rows in JS, so we
 *      no longer run separate summary / per-bridge / lifetime scans.
 *   2. PG  `conversation_logs` — one pass producing the bucketed time series;
 *      request counts and latency percentiles share a single GROUP BY.
 *   3. Timescale `daily_data` + `fifteen_minute_data` — cost and token totals.
 *      These are pre-aggregated rollups, so cost no longer means parsing the
 *      `tokens` JSONB of every conversation row. PG stays as the fallback when
 *      Timescale is unreachable (it is optional in local/dev).
 */
import Sequelize from "sequelize";
import models from "../../models/index.js";
import logger from "../logger.js";

const QueryTypes = Sequelize.QueryTypes;

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

async function pgSelect(query, replacements = {}) {
  return models.pg.sequelize.query(query, { type: QueryTypes.SELECT, replacements });
}

function timescaleSequelize() {
  return models.timescale?.sequelize || null;
}

async function timescaleSelect(query) {
  const sequelize = timescaleSequelize();
  if (!sequelize) throw new Error("timescale connection is not initialised");
  return sequelize.query(query, { type: QueryTypes.SELECT });
}

function toIso(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inList(ids) {
  const cleaned = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
  if (!cleaned.length) return "NULL";
  return cleaned.map(lit).join(", ");
}

function bucketExpr(bucket) {
  if (typeof bucket === "string" && /^([0-9]+)h$/.test(bucket)) {
    const hours = parseInt(bucket.match(/^([0-9]+)h$/)[1], 10);
    if (hours === 1) return "date_trunc('hour', created_at)";
    if (hours === 24) return "date_trunc('day', created_at)";
    const seconds = hours * 3600;
    return `to_timestamp(floor(extract(epoch from created_at) / ${seconds}) * ${seconds}) AT TIME ZONE 'UTC'`;
  }
  const unit = bucket === "hour" ? "hour" : "day";
  return `date_trunc('${unit}', created_at)`;
}

// Fallback cost/token extraction from the conversation_logs `tokens` JSONB.
// Only used when Timescale is unavailable — Timescale is the source of truth.
const COST_SQL = `COALESCE(
  (tokens->>'expected_cost')::double precision,
  (tokens->>'total_cost')::double precision,
  (tokens->'cost'->>'total')::double precision,
  0
)`;

const TOKENS_SQL = `COALESCE(
  (tokens->>'total_tokens')::double precision,
  COALESCE((tokens->>'input_tokens')::double precision, 0)
    + COALESCE((tokens->>'output_tokens')::double precision, 0)
)`;

const USERS_DEFAULT_PAGE_SIZE = 5;

// Where cost/token totals come from. Timescale's pre-aggregated rollups are the
// default; set EMBED_ANALYTICS_COST_SOURCE=conversation_logs to fall back to the
// per-row `tokens` JSONB without a deploy (the two do not currently agree — the
// Timescale rollups cover fewer requests than conversation_logs).
const costSourcePreference = () => (process.env.EMBED_ANALYTICS_COST_SOURCE === "conversation_logs" ? "conversation_logs" : "timescale");

function emptyEmbedSummary() {
  return {
    total_requests: 0,
    success_rate: 0,
    avg_response: 0,
    failed_runs: 0,
    total_tokens: 0,
    est_cost: 0,
    positive_feedback: 0,
    negative_feedback: 0,
    unique_users: 0,
    active_agents: 0
  };
}

function emptyBridgeStats() {
  return {
    total_requests: 0,
    success_count: 0,
    failed_runs: 0,
    latency_sum: 0,
    latency_count: 0,
    total_tokens: 0,
    est_cost: 0,
    positive_feedback: 0,
    negative_feedback: 0,
    thread_count: 0,
    last_active: null
  };
}

function addBridgeStats(target, row) {
  target.total_requests += Number(row.total_requests) || 0;
  target.success_count += Number(row.success_count) || 0;
  target.failed_runs += Number(row.failed_runs) || 0;
  target.latency_sum += Number(row.latency_sum) || 0;
  target.latency_count += Number(row.latency_count) || 0;
  target.total_tokens += Number(row.total_tokens) || 0;
  target.est_cost += Number(row.est_cost) || 0;
  target.positive_feedback += Number(row.positive_feedback) || 0;
  target.negative_feedback += Number(row.negative_feedback) || 0;
  target.thread_count += Number(row.thread_count) || 0;
  if (row.last_active && (!target.last_active || new Date(row.last_active) > new Date(target.last_active))) {
    target.last_active = row.last_active;
  }
  return target;
}

function statsToSummary(stats) {
  const total = stats.total_requests || 0;
  return {
    total_requests: total,
    success_rate: total ? Number(((stats.success_count / total) * 100).toFixed(1)) : 0,
    avg_response: stats.latency_count ? Math.round(stats.latency_sum / stats.latency_count) : 0,
    failed_runs: stats.failed_runs || 0,
    total_tokens: Math.round(stats.total_tokens || 0),
    est_cost: Number(Number(stats.est_cost || 0).toFixed(6)),
    positive_feedback: stats.positive_feedback || 0,
    negative_feedback: stats.negative_feedback || 0
  };
}

// Scope shared by both conversation_logs passes. `org_id` stays in the predicate
// because idx_conv_logs_org_bridge_updated / idx_conv_logs_org_bridge_created are
// keyed on (org_id, bridge_id, …) — dropping it would cost us the index.
function scopeSql({ bridge_ids, org_id, start, end }) {
  const parts = [`bridge_id IN (${inList(bridge_ids)})`];
  if (org_id != null && org_id !== "") {
    parts.push(`org_id::text = ${lit(String(org_id))}`);
  }
  const startIso = toIso(start);
  const endIso = toIso(end);
  if (startIso && endIso) {
    parts.push(`created_at >= ${lit(startIso)}::timestamptz`);
    parts.push(`created_at <= ${lit(endIso)}::timestamptz`);
  }
  return parts.join(" AND ");
}

function inRangeSql(start, end) {
  const startIso = toIso(start);
  const endIso = toIso(end);
  if (!startIso || !endIso) return "TRUE";
  return `(created_at >= ${lit(startIso)}::timestamptz AND created_at <= ${lit(endIso)}::timestamptz)`;
}

/**
 * One conversation_logs pass → per-bridge counters for the selected range and for
 * all time. Lifetime is unbounded by definition, so the scan has to touch every
 * row for these bridges anyway; computing the ranged numbers with FILTER in the
 * same pass makes the ranged summary and the per-bridge table free.
 */
async function getBridgeCounters(bridge_ids, { org_id, start, end } = {}) {
  if (!bridge_ids?.length) return [];
  // No time predicate here — the range is applied per-aggregate via `in_range`.
  const where = scopeSql({ bridge_ids, org_id });
  const inRange = inRangeSql(start, end);
  const query = `
    SELECT
      bridge_id,
      COUNT(*) FILTER (WHERE in_range)::int                                   AS total_requests,
      COUNT(*) FILTER (WHERE in_range AND status IS TRUE)::int                AS success_count,
      COUNT(*) FILTER (WHERE in_range AND status IS FALSE)::int               AS failed_runs,
      COALESCE(SUM(lat) FILTER (WHERE in_range AND status IS TRUE), 0)        AS latency_sum,
      COUNT(lat) FILTER (WHERE in_range AND status IS TRUE)::int              AS latency_count,
      COALESCE(SUM(tokens_total) FILTER (WHERE in_range), 0)                  AS total_tokens,
      COALESCE(SUM(cost) FILTER (WHERE in_range), 0)                          AS est_cost,
      COUNT(*) FILTER (WHERE in_range AND user_feedback = 1)::int             AS positive_feedback,
      COUNT(*) FILTER (WHERE in_range AND user_feedback = 2)::int             AS negative_feedback,
      COUNT(DISTINCT thread_id) FILTER (WHERE in_range)::int                  AS thread_count,
      MAX(created_at) FILTER (WHERE in_range)                                 AS last_active,
      COUNT(*)::int                                                           AS lt_total_requests,
      COUNT(*) FILTER (WHERE status IS TRUE)::int                             AS lt_success_count,
      COUNT(*) FILTER (WHERE status IS FALSE)::int                            AS lt_failed_runs,
      COALESCE(SUM(lat) FILTER (WHERE status IS TRUE), 0)                     AS lt_latency_sum,
      COUNT(lat) FILTER (WHERE status IS TRUE)::int                           AS lt_latency_count,
      COALESCE(SUM(tokens_total), 0)                                          AS lt_total_tokens,
      COALESCE(SUM(cost), 0)                                                  AS lt_est_cost,
      COUNT(*) FILTER (WHERE user_feedback = 1)::int                          AS lt_positive_feedback,
      COUNT(*) FILTER (WHERE user_feedback = 2)::int                          AS lt_negative_feedback
    FROM (
      SELECT
        bridge_id::text AS bridge_id,
        status,
        user_feedback,
        thread_id,
        created_at,
        (latency->>'over_all_time')::double precision AS lat,
        ${TOKENS_SQL} AS tokens_total,
        ${COST_SQL}   AS cost,
        ${inRange}    AS in_range
      FROM conversation_logs
      WHERE ${where}
    ) s
    GROUP BY bridge_id`;
  return pgSelect(query);
}

/**
 * One conversation_logs pass → the bucketed series. Request counts and latency
 * percentiles previously ran as two identical GROUP BY scans; they share one now.
 */
async function getTimeSeries(bridge_ids, { start, end, bucket, org_id } = {}) {
  if (!bridge_ids?.length || !toIso(start) || !toIso(end)) return [];
  const where = scopeSql({ bridge_ids, org_id, start, end });
  const query = `
    SELECT
      ${bucketExpr(bucket)} AS t,
      COUNT(*) FILTER (WHERE status IS TRUE)::int  AS success,
      COUNT(*) FILTER (WHERE status IS FALSE)::int AS failed,
      COUNT(lat)::int                              AS latency_samples,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY lat) AS typical,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY lat) AS slow,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY lat) AS worst
    FROM (
      SELECT created_at, status, (latency->>'over_all_time')::double precision AS lat
      FROM conversation_logs
      WHERE ${where}
    ) s
    GROUP BY 1 ORDER BY 1 ASC`;
  return pgSelect(query);
}

/**
 * Cost + tokens per bridge, from the Timescale rollups instead of the
 * conversation_logs `tokens` JSONB.
 *
 * `daily_data` holds one row per (bridge, version, thread, model, …) per UTC day
 * and is retained for a year; `fifteen_minute_data` holds the last 24h at finer
 * grain. The daily transfer job only appends buckets newer than daily_data's own
 * MAX(created_at), so that watermark is exactly the seam between the two tables —
 * reading `daily_data` below it and `fifteen_minute_data` above it covers the
 * timeline once, with no gap and no double counting.
 *
 * Note: below the seam the resolution is one UTC day, so a range boundary that
 * falls mid-day snaps out to the containing day for the daily rows.
 */
async function getCostAndTokens(bridge_ids, { org_id, start, end } = {}) {
  if (!bridge_ids?.length) return [];
  const ids = inList(bridge_ids);
  const startIso = toIso(start);
  const endIso = toIso(end);

  // `alias` keeps the two UNION branches unambiguous against the `seam` CTE.
  const orgClause = (alias) => (org_id != null && org_id !== "" ? ` AND ${alias}.org_id::text = ${lit(String(org_id))}` : "");
  // Daily buckets are day-aligned, so the daily branch widens the lower bound to
  // the containing day rather than dropping the first partial day of the window.
  const rangeClause = (alias, dayAligned) => {
    if (!startIso || !endIso) return "TRUE";
    const lower = dayAligned ? `date_trunc('day', ${lit(startIso)}::timestamptz)` : `${lit(startIso)}::timestamptz`;
    return `(${alias}.created_at >= ${lower} AND ${alias}.created_at <= ${lit(endIso)}::timestamptz)`;
  };

  const query = `
    WITH seam AS (
      SELECT COALESCE(MAX(created_at) + INTERVAL '1 day', '-infinity'::timestamptz) AS cutoff
      FROM daily_data
    ),
    rollup AS (
      SELECT d.bridge_id::text AS bridge_id, d.cost_sum, d.total_token_count,
             ${rangeClause("d", true)} AS in_range
      FROM daily_data d, seam
      WHERE d.bridge_id IN (${ids})${orgClause("d")}
        AND d.created_at < seam.cutoff
      UNION ALL
      SELECT f.bridge_id::text AS bridge_id, f.cost_sum, f.total_token_count,
             ${rangeClause("f", false)} AS in_range
      FROM fifteen_minute_data f, seam
      WHERE f.bridge_id IN (${ids})${orgClause("f")}
        AND f.created_at >= seam.cutoff
    )
    SELECT
      bridge_id,
      COALESCE(SUM(cost_sum)          FILTER (WHERE in_range), 0) AS est_cost,
      COALESCE(SUM(total_token_count) FILTER (WHERE in_range), 0) AS total_tokens,
      COALESCE(SUM(cost_sum), 0)          AS lt_est_cost,
      COALESCE(SUM(total_token_count), 0) AS lt_total_tokens
    FROM rollup
    GROUP BY bridge_id`;
  return timescaleSelect(query);
}

function extractExternalUserId(email, org_id) {
  if (!email || typeof email !== "string") return null;
  let cleaned = email;
  if (org_id && cleaned.startsWith(String(org_id))) {
    cleaned = cleaned.slice(String(org_id).length);
  }
  cleaned = cleaned.replace(/@gtwy\.ai$/i, "");
  return cleaned || null;
}

/** Fold the flat per-bridge rows onto their parent agent (versions roll up into their bridge). */
function foldByParent(rows, idToParent, prefix = "") {
  const out = {};
  for (const r of rows || []) {
    const parent = idToParent[String(r.bridge_id)] || String(r.bridge_id);
    if (!out[parent]) out[parent] = emptyBridgeStats();
    addBridgeStats(out[parent], {
      total_requests: r[`${prefix}total_requests`],
      success_count: r[`${prefix}success_count`],
      failed_runs: r[`${prefix}failed_runs`],
      latency_sum: r[`${prefix}latency_sum`],
      latency_count: r[`${prefix}latency_count`],
      total_tokens: r[`${prefix}total_tokens`],
      est_cost: r[`${prefix}est_cost`],
      positive_feedback: r[`${prefix}positive_feedback`],
      negative_feedback: r[`${prefix}negative_feedback`],
      thread_count: r[`${prefix}thread_count`],
      last_active: prefix ? null : r.last_active
    });
  }
  return out;
}

/** Overwrite the PG-derived cost/token figures with the Timescale rollup totals. */
function applyTimescaleCost(statsByParent, lifetimeByParent, costRows, idToParent) {
  const range = {};
  const lifetime = {};
  for (const r of costRows || []) {
    const parent = idToParent[String(r.bridge_id)] || String(r.bridge_id);
    range[parent] = range[parent] || { est_cost: 0, total_tokens: 0 };
    lifetime[parent] = lifetime[parent] || { est_cost: 0, total_tokens: 0 };
    range[parent].est_cost += Number(r.est_cost) || 0;
    range[parent].total_tokens += Number(r.total_tokens) || 0;
    lifetime[parent].est_cost += Number(r.lt_est_cost) || 0;
    lifetime[parent].total_tokens += Number(r.lt_total_tokens) || 0;
  }
  for (const [target, source] of [
    [statsByParent, range],
    [lifetimeByParent, lifetime]
  ]) {
    for (const parent of Object.keys(target)) {
      target[parent].est_cost = source[parent]?.est_cost || 0;
      target[parent].total_tokens = source[parent]?.total_tokens || 0;
    }
    // Bridges that only ever show up in Timescale still contribute to the totals.
    for (const parent of Object.keys(source)) {
      if (!target[parent]) {
        target[parent] = { ...emptyBridgeStats(), ...source[parent] };
      }
    }
  }
}

async function getEmbedAnalytics({ org_id, window, agents, userMap, userMapPromise, userSearch, userPage, userLimit }) {
  const idToParent = {};
  const queryIds = [];
  for (const agent of agents) {
    const parent = String(agent.bridge_id);
    idToParent[parent] = parent;
    queryIds.push(parent);
    for (const vid of agent.version_ids || []) {
      const v = String(vid);
      if (!v) continue;
      idToParent[v] = parent;
      queryIds.push(v);
    }
  }
  const uniqueQueryIds = [...new Set(queryIds)];

  if (!uniqueQueryIds.length) {
    return {
      summary: emptyEmbedSummary(),
      lifetime_summary: emptyEmbedSummary(),
      requests_over_time: [],
      response_time: [],
      agents: [],
      users: [],
      users_pagination: { page: 1, limit: USERS_DEFAULT_PAGE_SIZE, total: 0, total_pages: 1, search: "" },
      meta: { queried_bridge_ids: 0, lifetime_requests: 0, range_requests: 0, cost_source: "none" }
    };
  }

  const scope = { org_id, start: window.start, end: window.end, bucket: window.bucket };

  let counterRows = [];
  let seriesRows = [];
  let costRows = null;
  let costSource = costSourcePreference();

  try {
    [counterRows, seriesRows, costRows] = await Promise.all([
      getBridgeCounters(uniqueQueryIds, scope),
      getTimeSeries(uniqueQueryIds, scope),
      costSource === "timescale"
        ? getCostAndTokens(uniqueQueryIds, scope).catch((error) => {
            logger.warn(`embed analytics: Timescale cost lookup failed (${error.message}); falling back to conversation_logs tokens`);
            costSource = "conversation_logs";
            return null;
          })
        : null
    ]);

    const rangeCount = counterRows.reduce((n, r) => n + (Number(r.total_requests) || 0), 0);
    const lifeCount = counterRows.reduce((n, r) => n + (Number(r.lt_total_requests) || 0), 0);

    // conversation_logs.org_id is not always stored in the same shape as the
    // profile org id. The bridge ids are already org-scoped (they came from a
    // Configuration query filtered by org), so retrying without the org
    // predicate is safe — it only loses the index assist.
    if (rangeCount === 0) {
      logger.warn(`embed analytics: 0 ranged rows with org_id=${org_id} (lifetime=${lifeCount}); retrying without org filter`);
      const noOrg = { ...scope, org_id: null };
      // Timescale only gets a second round-trip if its org filter also came up empty.
      const retryCost = costSource === "timescale" && !costRows?.length;
      const [retriedCounters, retriedSeries, retriedCost] = await Promise.all([
        getBridgeCounters(uniqueQueryIds, noOrg),
        getTimeSeries(uniqueQueryIds, noOrg),
        retryCost ? getCostAndTokens(uniqueQueryIds, noOrg).catch(() => null) : null
      ]);
      if (retriedCounters.some((r) => (Number(r.total_requests) || 0) > 0 || (Number(r.lt_total_requests) || 0) > 0)) {
        counterRows = retriedCounters;
        seriesRows = retriedSeries;
        if (retriedCost) costRows = retriedCost;
      }
    }
  } catch (error) {
    logger.error(`embed analytics aggregation failed: ${error.message}`);
    throw error;
  }

  const statsByParent = foldByParent(counterRows, idToParent);
  const lifetimeByParent = foldByParent(counterRows, idToParent, "lt_");

  if (costRows) {
    applyTimescaleCost(statsByParent, lifetimeByParent, costRows, idToParent);
  } else {
    costSource = "conversation_logs";
  }

  const requests_over_time = seriesRows.map((r) => ({ t: r.t, success: Number(r.success) || 0, failed: Number(r.failed) || 0 }));
  const response_time = seriesRows
    .filter((r) => (Number(r.latency_samples) || 0) > 0)
    .map((r) => ({ t: r.t, typical: r.typical, slow: r.slow, worst: r.worst }));

  const agentsOut = agents.map((agent) => {
    const bid = String(agent.bridge_id);
    const row = statsByParent[bid] || emptyBridgeStats();
    const total = row.total_requests || 0;
    return {
      bridge_id: bid,
      name: agent.name || "Untitled",
      user_id: agent.user_id != null ? String(agent.user_id) : null,
      service: agent.service || null,
      model: agent.model || null,
      total_requests: total,
      success_count: row.success_count,
      success_rate: total ? Number(((row.success_count / total) * 100).toFixed(1)) : 0,
      failed_runs: row.failed_runs,
      avg_response: row.latency_count ? Math.round(row.latency_sum / row.latency_count) : 0,
      total_tokens: Math.round(row.total_tokens || 0),
      est_cost: Number(Number(row.est_cost || 0).toFixed(6)),
      positive_feedback: row.positive_feedback,
      negative_feedback: row.negative_feedback,
      thread_count: row.thread_count,
      last_active: row.last_active || null
    };
  });

  const userAgg = {};
  for (const agent of agentsOut) {
    const uid = agent.user_id || "unknown";
    if (!userAgg[uid]) {
      userAgg[uid] = {
        user_id: uid === "unknown" ? null : uid,
        agent_count: 0,
        total_requests: 0,
        success_count: 0,
        failed_runs: 0,
        total_tokens: 0,
        est_cost: 0,
        positive_feedback: 0,
        negative_feedback: 0,
        thread_count: 0,
        last_active: null,
        agents: []
      };
    }
    const u = userAgg[uid];
    u.agent_count += 1;
    u.total_requests += agent.total_requests;
    u.success_count += agent.success_count;
    u.failed_runs += agent.failed_runs;
    u.total_tokens += agent.total_tokens;
    u.est_cost += agent.est_cost;
    u.positive_feedback += agent.positive_feedback;
    u.negative_feedback += agent.negative_feedback;
    u.thread_count += agent.thread_count;
    if (agent.last_active && (!u.last_active || new Date(agent.last_active) > new Date(u.last_active))) {
      u.last_active = agent.last_active;
    }
    u.agents.push({
      bridge_id: agent.bridge_id,
      name: agent.name,
      total_requests: agent.total_requests,
      est_cost: agent.est_cost
    });
  }

  // The proxy user lookup runs concurrently with the aggregation above; join it here.
  const resolvedUserMap = (userMapPromise ? await userMapPromise : userMap) || {};

  const users = Object.values(userAgg)
    .map((u) => {
      const info = u.user_id ? resolvedUserMap[String(u.user_id)] : null;
      const email = info?.email || null;
      return {
        user_id: u.user_id,
        name: info?.name || (u.user_id ? "Unknown user" : "Unassigned"),
        email,
        external_user_id: extractExternalUserId(email, org_id),
        agent_count: u.agent_count,
        total_requests: u.total_requests,
        success_rate: u.total_requests ? Number(((u.success_count / u.total_requests) * 100).toFixed(1)) : 0,
        failed_runs: u.failed_runs,
        total_tokens: u.total_tokens,
        est_cost: Number(u.est_cost.toFixed(6)),
        positive_feedback: u.positive_feedback,
        negative_feedback: u.negative_feedback,
        thread_count: u.thread_count,
        last_active: u.last_active,
        agents: u.agents
      };
    })
    .sort((a, b) => b.total_requests - a.total_requests || String(b.last_active || "").localeCompare(String(a.last_active || "")));

  const rangeTotals = Object.values(statsByParent).reduce((acc, s) => addBridgeStats(acc, s), emptyBridgeStats());
  const lifetimeTotals = Object.values(lifetimeByParent).reduce((acc, s) => addBridgeStats(acc, s), emptyBridgeStats());

  const summary = {
    ...statsToSummary(rangeTotals),
    unique_users: users.filter((u) => u.user_id && u.total_requests > 0).length,
    active_agents: agentsOut.filter((a) => a.total_requests > 0).length
  };
  const lifetime = statsToSummary(lifetimeTotals);

  // Search + paginate the full user list (not the current page) so matches on
  // page 2+ still surface. KPI `summary` above stays based on the unfiltered set.
  const term = String(userSearch || "")
    .trim()
    .toLowerCase();
  const matchedUsers = term
    ? users.filter((u) => {
        const emailLocal = u.email && String(u.email).includes("@") ? String(u.email).split("@")[0] : u.email;
        const agentNames = (u.agents || []).map((a) => a.name).join(" ");
        return [u.name, u.email, emailLocal, u.external_user_id, u.user_id, agentNames].some((field) =>
          String(field || "")
            .toLowerCase()
            .includes(term)
        );
      })
    : users;

  const pageSize = Math.min(Math.max(1, Number(userLimit) || USERS_DEFAULT_PAGE_SIZE), 100);
  const totalPages = Math.max(1, Math.ceil(matchedUsers.length / pageSize));
  const currentPage = Math.min(Math.max(1, Number(userPage) || 1), totalPages);

  return {
    summary,
    lifetime_summary: lifetime,
    requests_over_time,
    response_time,
    agents: agentsOut.sort((a, b) => b.total_requests - a.total_requests),
    users: matchedUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    users_pagination: {
      page: currentPage,
      limit: pageSize,
      total: matchedUsers.length,
      total_pages: totalPages,
      search: term
    },
    meta: {
      queried_bridge_ids: uniqueQueryIds.length,
      lifetime_requests: lifetime.total_requests,
      range_requests: summary.total_requests,
      cost_source: costSource
    }
  };
}

export default {
  getEmbedAnalytics
};

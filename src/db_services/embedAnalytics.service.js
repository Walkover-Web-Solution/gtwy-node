/**
 * Embed-folder analytics — isolated from agent analytics (analytics.service.js).
 *
 * Scope: agents with Configuration.folder_id = embed folder.
 * User identity: bridge.user_id (agent owner) → proxy user details.
 */
import Sequelize from "sequelize";
import models from "../../models/index.js";
import logger from "../logger.js";

const QueryTypes = Sequelize.QueryTypes;

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

async function pgSelect(query, replacements = {}) {
  return models.pg.sequelize.query(query, { type: QueryTypes.SELECT, replacements });
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

function rowToSummary(row = {}) {
  const total = Number(row.total_requests) || 0;
  const success_count = Number(row.success_count) || 0;
  return {
    total_requests: total,
    success_rate: total ? Number(((success_count / total) * 100).toFixed(1)) : 0,
    avg_response: Math.round(Number(row.avg_response) || 0),
    failed_runs: Number(row.failed_runs) || 0,
    total_tokens: Math.round(Number(row.total_tokens) || 0),
    est_cost: Number(Number(row.est_cost || 0).toFixed(6)),
    positive_feedback: Number(row.positive_feedback) || 0,
    negative_feedback: Number(row.negative_feedback) || 0
  };
}

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

async function getSummaryForBridges(bridge_ids, opts = {}) {
  if (!bridge_ids?.length) return {};
  const where = scopeSql({ bridge_ids, ...opts });
  const query = `
    SELECT
      COUNT(*)::int AS total_requests,
      COUNT(*) FILTER (WHERE status IS TRUE)::int  AS success_count,
      COUNT(*) FILTER (WHERE status IS FALSE)::int AS failed_runs,
      COALESCE(AVG((latency->>'over_all_time')::double precision) FILTER (WHERE status IS TRUE), 0) AS avg_response,
      COALESCE(SUM(${TOKENS_SQL}), 0) AS total_tokens,
      COALESCE(SUM(${COST_SQL}), 0) AS est_cost,
      COUNT(*) FILTER (WHERE user_feedback = 1)::int AS positive_feedback,
      COUNT(*) FILTER (WHERE user_feedback = 2)::int AS negative_feedback
    FROM conversation_logs
    WHERE ${where}`;
  const rows = await pgSelect(query);
  return rows[0] || {};
}

async function getRequestsOverTimeForBridges(bridge_ids, { start, end, bucket, org_id } = {}) {
  if (!bridge_ids?.length || !toIso(start) || !toIso(end)) return [];
  const where = scopeSql({ bridge_ids, org_id, start, end });
  const query = `
    SELECT
      ${bucketExpr(bucket)} AS t,
      COUNT(*) FILTER (WHERE status IS TRUE)::int  AS success,
      COUNT(*) FILTER (WHERE status IS FALSE)::int AS failed
    FROM conversation_logs
    WHERE ${where}
    GROUP BY 1 ORDER BY 1 ASC`;
  return pgSelect(query);
}

async function getResponseTimeForBridges(bridge_ids, { start, end, bucket, org_id } = {}) {
  if (!bridge_ids?.length || !toIso(start) || !toIso(end)) return [];
  const where = scopeSql({ bridge_ids, org_id, start, end });
  const query = `
    SELECT
      ${bucketExpr(bucket)} AS t,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY (latency->>'over_all_time')::double precision) AS typical,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY (latency->>'over_all_time')::double precision) AS slow,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY (latency->>'over_all_time')::double precision) AS worst
    FROM conversation_logs
    WHERE ${where}
      AND (latency->>'over_all_time') IS NOT NULL
    GROUP BY 1 ORDER BY 1 ASC`;
  return pgSelect(query);
}

async function getPerBridgeStats(bridge_ids, opts = {}) {
  if (!bridge_ids?.length) return [];
  const where = scopeSql({ bridge_ids, ...opts });
  const query = `
    SELECT
      bridge_id::text AS bridge_id,
      COUNT(*)::int AS total_requests,
      COUNT(*) FILTER (WHERE status IS TRUE)::int  AS success_count,
      COUNT(*) FILTER (WHERE status IS FALSE)::int AS failed_runs,
      COALESCE(AVG((latency->>'over_all_time')::double precision) FILTER (WHERE status IS TRUE), 0) AS avg_response,
      COALESCE(SUM(${TOKENS_SQL}), 0) AS total_tokens,
      COALESCE(SUM(${COST_SQL}), 0) AS est_cost,
      COUNT(*) FILTER (WHERE user_feedback = 1)::int AS positive_feedback,
      COUNT(*) FILTER (WHERE user_feedback = 2)::int AS negative_feedback,
      COUNT(DISTINCT thread_id)::int AS thread_count,
      MAX(created_at) AS last_active
    FROM conversation_logs
    WHERE ${where}
    GROUP BY bridge_id::text`;
  return pgSelect(query);
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

async function getEmbedAnalytics({ org_id, window, agents, userMap, userSearch, userPage, userLimit }) {
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
      meta: { queried_bridge_ids: 0, lifetime_requests: 0, range_requests: 0 }
    };
  }

  const rangeOpts = { start: window.start, end: window.end, bucket: window.bucket, org_id };
  const lifetimeOpts = { org_id };

  let summaryRow = {};
  let requests_over_time = [];
  let response_time = [];
  let perBridge = [];
  let lifetimeRow = {};

  try {
    [summaryRow, requests_over_time, response_time, perBridge, lifetimeRow] = await Promise.all([
      getSummaryForBridges(uniqueQueryIds, rangeOpts),
      getRequestsOverTimeForBridges(uniqueQueryIds, rangeOpts),
      getResponseTimeForBridges(uniqueQueryIds, rangeOpts),
      getPerBridgeStats(uniqueQueryIds, rangeOpts),
      getSummaryForBridges(uniqueQueryIds, lifetimeOpts)
    ]);

    const rangeCount = Number(summaryRow?.total_requests) || 0;
    const lifeCount = Number(lifetimeRow?.total_requests) || 0;

    if (rangeCount === 0 && lifeCount > 0) {
      logger.warn(`embed analytics: 0 ranged rows with org_id=${org_id} but lifetime=${lifeCount}; retrying without org filter`);
      const noOrg = { start: window.start, end: window.end, bucket: window.bucket, org_id: null };
      [summaryRow, requests_over_time, response_time, perBridge] = await Promise.all([
        getSummaryForBridges(uniqueQueryIds, noOrg),
        getRequestsOverTimeForBridges(uniqueQueryIds, noOrg),
        getResponseTimeForBridges(uniqueQueryIds, noOrg),
        getPerBridgeStats(uniqueQueryIds, noOrg)
      ]);
    } else if (rangeCount === 0 && lifeCount === 0) {
      const lifeNoOrg = await getSummaryForBridges(uniqueQueryIds, { org_id: null });
      if ((Number(lifeNoOrg?.total_requests) || 0) > 0) {
        logger.warn(`embed analytics: lifetime with org=0 but without org=${lifeNoOrg.total_requests}; using no-org range`);
        lifetimeRow = lifeNoOrg;
        const noOrg = { start: window.start, end: window.end, bucket: window.bucket, org_id: null };
        [summaryRow, requests_over_time, response_time, perBridge] = await Promise.all([
          getSummaryForBridges(uniqueQueryIds, noOrg),
          getRequestsOverTimeForBridges(uniqueQueryIds, noOrg),
          getResponseTimeForBridges(uniqueQueryIds, noOrg),
          getPerBridgeStats(uniqueQueryIds, noOrg)
        ]);
      }
    }
  } catch (error) {
    logger.error(`embed analytics PG aggregation failed: ${error.message}`);
    throw error;
  }

  const statsByParent = {};
  for (const r of perBridge || []) {
    const parent = idToParent[String(r.bridge_id)] || String(r.bridge_id);
    if (!statsByParent[parent]) {
      statsByParent[parent] = {
        total_requests: 0,
        success_count: 0,
        failed_runs: 0,
        avg_response_weighted: 0,
        total_tokens: 0,
        est_cost: 0,
        positive_feedback: 0,
        negative_feedback: 0,
        thread_count: 0,
        last_active: null
      };
    }
    const s = statsByParent[parent];
    const req = Number(r.total_requests) || 0;
    s.total_requests += req;
    s.success_count += Number(r.success_count) || 0;
    s.failed_runs += Number(r.failed_runs) || 0;
    s.avg_response_weighted += (Number(r.avg_response) || 0) * req;
    s.total_tokens += Number(r.total_tokens) || 0;
    s.est_cost += Number(r.est_cost) || 0;
    s.positive_feedback += Number(r.positive_feedback) || 0;
    s.negative_feedback += Number(r.negative_feedback) || 0;
    s.thread_count += Number(r.thread_count) || 0;
    if (r.last_active && (!s.last_active || new Date(r.last_active) > new Date(s.last_active))) {
      s.last_active = r.last_active;
    }
  }

  const agentsOut = agents.map((agent) => {
    const bid = String(agent.bridge_id);
    const row = statsByParent[bid] || {};
    const total = Number(row.total_requests) || 0;
    const success = Number(row.success_count) || 0;
    return {
      bridge_id: bid,
      name: agent.name || "Untitled",
      user_id: agent.user_id != null ? String(agent.user_id) : null,
      service: agent.service || null,
      model: agent.model || null,
      total_requests: total,
      success_count: success,
      success_rate: total ? Number(((success / total) * 100).toFixed(1)) : 0,
      failed_runs: Number(row.failed_runs) || 0,
      avg_response: total ? Math.round((row.avg_response_weighted || 0) / total) : 0,
      total_tokens: Math.round(Number(row.total_tokens) || 0),
      est_cost: Number(Number(row.est_cost || 0).toFixed(6)),
      positive_feedback: Number(row.positive_feedback) || 0,
      negative_feedback: Number(row.negative_feedback) || 0,
      thread_count: Number(row.thread_count) || 0,
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

  const users = Object.values(userAgg)
    .map((u) => {
      const info = u.user_id ? userMap[String(u.user_id)] : null;
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

  const summary = {
    ...rowToSummary(summaryRow),
    unique_users: users.filter((u) => u.user_id && u.total_requests > 0).length,
    active_agents: agentsOut.filter((a) => a.total_requests > 0).length
  };
  const lifetime = rowToSummary(lifetimeRow);

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
    requests_over_time: requests_over_time || [],
    response_time: response_time || [],
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
      range_requests: summary.total_requests
    }
  };
}

export default {
  getEmbedAnalytics
};

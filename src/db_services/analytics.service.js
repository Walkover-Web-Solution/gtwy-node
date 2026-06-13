import models from "../../models/index.js";
import Sequelize from "sequelize";

/**
 * Agent analytics queries over conversation_logs.
 *
 * Every query is scoped to a single agent: org_id + bridge_id, plus the active
 * dashboard filters (time range, tools, latency, reviewer failures, error history,
 * keyword/field search). The filter builder returns a SQL fragment + replacements
 * so all four queries share identical WHERE semantics.
 */

const LATENCY_EXPR = `("conversation_logs"."latency"->>'over_all_time')::float`;

/**
 * Build the shared WHERE clause (string) + replacements object from filters.
 * @param {Object} f - { org_id, agent_id, start, end, tools, latency, reviewer_failures, error_history, keyword }
 * @param {Object} [opts] - { previous: true } shifts the window back by one equal period (for deltas)
 */
function buildWhere(f, opts = {}) {
  const clauses = [`"org_id" = :org_id`, `"bridge_id" = :agent_id`];
  const replacements = { org_id: f.org_id, agent_id: f.agent_id };

  // Time window. For the "previous" window we shift [start,end] back by its own length.
  let start = f.start;
  let end = f.end;
  if (opts.previous && start && end) {
    const span = new Date(end).getTime() - new Date(start).getTime();
    end = new Date(start);
    start = new Date(new Date(start).getTime() - span);
  }
  if (start) {
    clauses.push(`"created_at" >= :start`);
    replacements.start = start;
  }
  if (end) {
    clauses.push(`"created_at" <= :end`);
    replacements.end = end;
  }

  // Tool filter — recursive name search handles both {flow_hit_id:{name}} and {name} shapes.
  if (Array.isArray(f.tools) && f.tools.length > 0) {
    const toolClauses = f.tools.map((tool, i) => {
      replacements[`tool_${i}`] = tool;
      return `jsonb_path_exists("conversation_logs"."tools_call_data", ('$.**.name ? (@ like_regex "' || :${`tool_${i}`} || '" flag "i")')::jsonpath)`;
    });
    clauses.push(`(${toolClauses.join(" OR ")})`);
  }

  if (f.latency && f.latency !== "any") {
    replacements.latency_threshold = Number(f.latency);
    clauses.push(`${LATENCY_EXPR} > :latency_threshold`);
  }

  if (Array.isArray(f.model) && f.model.length > 0) {
    replacements.model = f.model;
    clauses.push(`"model" IN (:model)`);
  }

  if (Array.isArray(f.service) && f.service.length > 0) {
    replacements.service = f.service;
    clauses.push(`"service" IN (:service)`);
  }

  // Variables filter — match rows that HAVE a particular variable key/value ("with"),
  // or every other row ("without"). jsonb_exists() is used instead of the `?` operator
  // to avoid clashing with Sequelize positional-replacement parsing.
  if (f.variables && f.variables.key) {
    const mode = f.variables.mode === "without" ? "without" : "with";
    replacements.var_key = f.variables.key;
    const hasValue = f.variables.value !== undefined && f.variables.value !== null && f.variables.value !== "";
    if (hasValue) replacements.var_val = String(f.variables.value);

    let clause;
    if (mode === "with") {
      clause = hasValue ? `"variables"->>:var_key = :var_val` : `jsonb_exists(COALESCE("variables", '{}'::jsonb), :var_key)`;
    } else {
      clause = hasValue ? `("variables"->>:var_key IS DISTINCT FROM :var_val)` : `(NOT jsonb_exists(COALESCE("variables", '{}'::jsonb), :var_key))`;
    }
    clauses.push(clause);
  }

  if (f.reviewer_failures) {
    clauses.push(`"conversation_logs"."AiConfig"->'review_meta'->>'passed' = 'false'`);
  }

  if (f.error_history) {
    clauses.push(`("error" IS NOT NULL AND "error" <> '')`);
  }

  if (f.keyword && f.keyword.trim() !== "") {
    replacements.keyword = `%${f.keyword.trim()}%`;
    clauses.push(
      `("user" ILIKE :keyword OR "llm_message" ILIKE :keyword OR "chatbot_message" ILIKE :keyword OR "updated_llm_message" ILIKE :keyword OR "sub_thread_id" ILIKE :keyword OR "thread_id" ILIKE :keyword)`
    );
  }

  return { where: clauses.join(" AND "), replacements };
}

async function runQuery(sql, replacements) {
  return models.pg.sequelize.query(sql, {
    type: Sequelize.QueryTypes.SELECT,
    replacements
  });
}

/**
 * 1. Sub-thread list (the execution-history panel / always-first chunk).
 * Returns { sub_thread_id, thread_id, display_name, created_at } newest-first, paged.
 */
async function getSubThreadList(filters, { limit = 50, offset = 0 } = {}) {
  const { where, replacements } = buildWhere(filters);
  const sql = `
    SELECT "sub_thread_id",
           "thread_id",
           COALESCE(MAX("display_name"), "sub_thread_id") AS display_name,
           MAX("created_at") AS created_at
    FROM "conversation_logs"
    WHERE ${where}
    GROUP BY "thread_id", "sub_thread_id"
    ORDER BY MAX("created_at") DESC
    LIMIT :limit OFFSET :offset`;
  return runQuery(sql, { ...replacements, limit, offset });
}

/**
 * 2. KPI aggregates for one window. Returns a single row of raw numbers.
 */
async function getKpiRow(filters, opts = {}) {
  const { where, replacements } = buildWhere(filters, opts);
  const sql = `
    SELECT
      COUNT(*)::int AS total_requests,
      COALESCE(AVG(CASE WHEN "status" = true THEN 1.0 ELSE 0.0 END) * 100, 0) AS success_rate,
      COALESCE(AVG(${LATENCY_EXPR}) * 1000, 0) AS avg_response_ms,
      COUNT(*) FILTER (WHERE "status" = false OR ("error" IS NOT NULL AND "error" <> ''))::int AS failed_runs,
      COALESCE(SUM(COALESCE(("tokens"->>'input_tokens')::numeric, 0) + COALESCE(("tokens"->>'output_tokens')::numeric, 0)), 0) AS token_usage,
      COALESCE(SUM(("tokens"->>'expected_cost')::numeric), 0) AS est_cost,
      COUNT(*) FILTER (WHERE "user_feedback" = 1)::int AS positive,
      COUNT(*) FILTER (WHERE "user_feedback" = 2)::int AS negative
    FROM "conversation_logs"
    WHERE ${where}`;
  const [row] = await runQuery(sql, replacements);
  return row;
}

/**
 * KPI cards with delta vs the previous equal-length window.
 */
async function getKpis(filters) {
  const [current, previous] = await Promise.all([getKpiRow(filters), getKpiRow(filters, { previous: true })]);

  const delta = (cur, prev) => {
    const c = Number(cur) || 0;
    const p = Number(prev) || 0;
    if (p === 0) return c === 0 ? 0 : 100;
    return ((c - p) / p) * 100;
  };

  const card = (key) => ({ value: Number(current?.[key]) || 0, delta: delta(current?.[key], previous?.[key]) });

  return {
    total_requests: card("total_requests"),
    success_rate: card("success_rate"),
    avg_response_ms: card("avg_response_ms"),
    failed_runs: card("failed_runs"),
    token_usage: card("token_usage"),
    est_cost: card("est_cost"),
    positive: card("positive"),
    negative: card("negative")
  };
}

/**
 * 3. Requests over time — success vs failed per time bucket.
 * @param {string} bucket - 'hour' | 'day'
 */
async function getRequestsOverTime(filters, bucket = "hour") {
  const { where, replacements } = buildWhere(filters);
  const sql = `
    SELECT date_trunc(:bucket, "created_at") AS bucket,
           COUNT(*) FILTER (WHERE "status" = true)::int AS success,
           COUNT(*) FILTER (WHERE "status" = false OR ("error" IS NOT NULL AND "error" <> ''))::int AS failed
    FROM "conversation_logs"
    WHERE ${where}
    GROUP BY date_trunc(:bucket, "created_at")
    ORDER BY bucket ASC`;
  return runQuery(sql, { ...replacements, bucket });
}

/**
 * 4. Response time percentiles per bucket — typical(p50)/slow(p90)/worst(p99).
 */
async function getResponseTime(filters, bucket = "hour") {
  const { where, replacements } = buildWhere(filters);
  const sql = `
    SELECT date_trunc(:bucket, "created_at") AS bucket,
           COALESCE(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ${LATENCY_EXPR}) * 1000, 0) AS typical,
           COALESCE(percentile_cont(0.9)  WITHIN GROUP (ORDER BY ${LATENCY_EXPR}) * 1000, 0) AS slow,
           COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY ${LATENCY_EXPR}) * 1000, 0) AS worst
    FROM "conversation_logs"
    WHERE ${where} AND "latency" IS NOT NULL
    GROUP BY date_trunc(:bucket, "created_at")
    ORDER BY bucket ASC`;
  return runQuery(sql, { ...replacements, bucket });
}

export { buildWhere, getSubThreadList, getKpis, getRequestsOverTime, getResponseTime };

// Shared conversation_logs filter builder.
//
// Returns a single SQL boolean expression (no leading AND), fully inline-escaped
// — no bind params — so the SAME string is reusable in both:
//   • raw aggregation queries:  ` AND (${expr})`
//   • Sequelize queries:        `Sequelize.literal(expr)` inside Op.and
//
// Column refs are fully qualified as "conversation_logs"."col" which is valid in
// both the aliased Sequelize query and the `FROM conversation_logs` raw queries.
// Escaping mirrors the existing threads code (single-quote doubling).

const T = '"conversation_logs"';
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const like = (v) => `'%${String(v).replace(/'/g, "''")}%'`;
const toArray = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
const clean = (v) =>
  toArray(v)
    .map((x) => String(x).trim())
    .filter(Boolean);
const SEARCHABLE = ["message_id", "thread_id", "sub_thread_id", "llm_message", "user", "chatbot_message", "updated_llm_message"];
const varsObj = `COALESCE(${T}."variables", '{}'::jsonb)`;
const varsIsObj = `jsonb_typeof(COALESCE(${T}."variables", 'null'::jsonb)) = 'object'`;

export function buildConversationFilterSql(filters = {}) {
  const { user_feedback, error, version_id, testcase_id, keyword } = filters;
  const filter_by = filters.filter_by && typeof filters.filter_by === "object" ? filters.filter_by : null;
  const and = [];

  // Multi-select facets: each accepts one or many values and matches ANY (IN-list).
  const models = clean(filters.model);
  const services = clean(filters.service);
  const toolIds = clean(filters.tool_id);

  // ---- AND facets ----
  if (models.length) and.push(`${T}."model" IN (${models.map(lit).join(", ")})`);
  if (services.length) and.push(`${T}."service" IN (${services.map(lit).join(", ")})`);
  if (user_feedback != null && user_feedback !== "all") and.push(`${T}."user_feedback" = ${Number(user_feedback)}`);
  if (version_id) and.push(`${T}."version_id" = ${lit(version_id)}`);
  if (testcase_id) and.push(`${T}."testcase_id" = ${lit(testcase_id)}`);
  if (error === "true" || error === true) and.push(`(${T}."error" IS NOT NULL AND ${T}."error" <> '')`);
  if (toolIds.length) {
    // tools_call_data is `[ { "fc_..": { "id": <tool_id>, ... } } ]`. Match rows
    // where ANY of the requested tool ids was called. CASE guard avoids
    // jsonb_array_elements erroring on non-array rows.
    const idList = toolIds.map(lit).join(", ");
    and.push(
      `EXISTS (SELECT 1 FROM jsonb_array_elements(` +
        `CASE WHEN jsonb_typeof(${T}."tools_call_data") = 'array' THEN ${T}."tools_call_data" ELSE '[]'::jsonb END` +
        `) AS elem, jsonb_each(elem) AS kv WHERE kv.value->>'id' IN (${idList}))`
    );
  }

  // variables_absent (sibling key under filter_by): match rows where NONE of the
  // named variable keys exist.
  const absentRaw = filter_by?.variables_absent;
  const absent = (Array.isArray(absentRaw) ? absentRaw : absentRaw ? [absentRaw] : []).map((v) => String(v).trim()).filter(Boolean);
  if (absent.length) {
    const inList = absent.map(lit).join(", ");
    and.push(`NOT EXISTS (SELECT 1 FROM jsonb_each_text(${varsObj}) AS kv WHERE ${varsIsObj} AND kv.key IN (${inList}))`);
  }

  // ---- OR group: filter_by entries, else keyword (filter_by wins, like threads) ----
  const or = [];
  if (filter_by && Object.keys(filter_by).length) {
    for (const [col, val] of Object.entries(filter_by)) {
      if (col === "variables_absent") continue; // facet, handled above
      if (col === "variables") {
        if (!val) continue;
        if (typeof val === "string" && val.trim()) {
          or.push(`EXISTS (SELECT 1 FROM jsonb_each_text(${varsObj}) AS kv WHERE ${varsIsObj} AND kv.value ILIKE ${like(val.trim())})`);
        } else if (typeof val === "object") {
          for (const [vn, vv] of Object.entries(val)) {
            const k = String(vn).trim();
            if (!k) continue;
            const tv = typeof vv === "string" ? vv.trim() : "";
            or.push(
              tv
                ? `EXISTS (SELECT 1 FROM jsonb_each_text(${varsObj}) AS kv WHERE ${varsIsObj} AND kv.key = ${lit(k)} AND kv.value = ${lit(tv)})`
                : `EXISTS (SELECT 1 FROM jsonb_each_text(${varsObj}) AS kv WHERE ${varsIsObj} AND kv.key = ${lit(k)})`
            );
          }
        }
      } else if (col === "batch_id") {
        if (val) or.push(`${T}."batch_data"->>'batch_id' ILIKE ${like(val)}`);
      } else if (SEARCHABLE.includes(col) && val) {
        or.push(`${T}."${col}" ILIKE ${like(val)}`);
      }
    }
  } else if (keyword && String(keyword).length) {
    for (const col of SEARCHABLE) or.push(`${T}."${col}" ILIKE ${like(keyword)}`);
    or.push(`EXISTS (SELECT 1 FROM jsonb_each_text(${varsObj}) AS kv WHERE ${varsIsObj} AND kv.value ILIKE ${like(keyword)})`);
    or.push(`${T}."batch_data"->>'batch_id' ILIKE ${like(keyword)}`);
  }
  if (or.length) and.push(`(${or.join(" OR ")})`);

  return and.join(" AND ");
}

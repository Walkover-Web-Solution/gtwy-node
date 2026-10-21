/**
 * Report usage of the platform's own provider keys, broken down by
 * service / org / agent (bridge).
 *
 * The signal: every request logged into timescale.raw_data carries the
 * ApikeyCredentials ObjectId it ran on, OR null when the request ran on the
 * platform's shared key from platform_apikeys (gtwy-ai sets apikey_id only for
 * BYOK). So `apikey_id IS NULL` = platform-key traffic.
 *
 * For cross-check: those same requests produce a Lago wallet-debit event
 * (walletDebit in src/services/lago.service.js) — BYOK traffic never debits the
 * wallet. Pass --lago to pull the per-org charge totals from Lago for the same
 * window.
 *
 * Usage:
 *   node scripts/platformKeyUsage.js                    # last 7d, grouped by service+org+bridge
 *   node scripts/platformKeyUsage.js --days=30          # custom window
 *   node scripts/platformKeyUsage.js --group=service    # service | org | bridge | service,org | service,org,bridge (default)
 *   node scripts/platformKeyUsage.js --service=openai   # restrict to one provider
 *   node scripts/platformKeyUsage.js --lago             # also fetch wallet-debit totals from Lago
 *   node scripts/platformKeyUsage.js --json             # machine-readable output
 */

import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

function parseArgs() {
  const out = { days: 7, group: "service,org,bridge", service: null, lago: false, json: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--lago") out.lago = true;
    else if (arg === "--json") out.json = true;
    else if (arg.startsWith("--days=")) out.days = Number(arg.split("=")[1]) || 7;
    else if (arg.startsWith("--group=")) out.group = arg.split("=")[1];
    else if (arg.startsWith("--service=")) out.service = arg.split("=")[1];
  }
  return out;
}

const ALLOWED_GROUPS = new Set(["service", "org_id", "bridge_id"]);
function parseGroupBy(spec) {
  const map = { service: "service", org: "org_id", bridge: "bridge_id", agent: "bridge_id" };
  const cols = spec
    .split(",")
    .map((s) => s.trim())
    .map((s) => map[s] || s)
    .filter((s) => ALLOWED_GROUPS.has(s));
  if (!cols.length) throw new Error(`invalid --group='${spec}'. Use service, org, bridge (comma-separated).`);
  return cols;
}

async function queryTimescale({ days, groupCols, service }) {
  const { default: models } = await import("../models/index.js");
  const sequelize = models.timescale?.sequelize;
  if (!sequelize) throw new Error("timescale DB not configured (TIMESCALE_SERVICE_URL)");

  const groupSql = groupCols.join(", ");
  const where = ["apikey_id IS NULL", "created_at >= NOW() - INTERVAL :window"];
  const replacements = { window: `${days} days` };
  if (service) {
    where.push("service = :service");
    replacements.service = service;
  }

  const sql = `
    SELECT ${groupSql},
           COUNT(*)                                   AS requests,
           COALESCE(SUM(input_tokens),  0)::bigint    AS input_tokens,
           COALESCE(SUM(output_tokens), 0)::bigint    AS output_tokens,
           COALESCE(SUM(total_tokens),  0)::bigint    AS total_tokens,
           COALESCE(SUM(cost),          0)::float     AS cost_usd,
           SUM(CASE WHEN success THEN 1 ELSE 0 END)   AS successes,
           SUM(CASE WHEN success THEN 0 ELSE 1 END)   AS failures
      FROM raw_data
     WHERE ${where.join(" AND ")}
     GROUP BY ${groupSql}
     ORDER BY cost_usd DESC NULLS LAST
     LIMIT 5000
  `;
  const [rows] = await sequelize.query(sql, { replacements });
  return rows;
}

async function queryLagoWalletDebits({ days, perOrg }) {
  const base = process.env.BILLING_API_URL;
  const key = process.env.BILLING_API_KEY;
  if (!base || !key) throw new Error("BILLING_API_URL / BILLING_API_KEY not configured");

  // Lago GET /events supports filtering by code (metric) and date range.
  const code = process.env.BILLING_CREDIT_USAGE_EVENT_CODE;
  if (!code) throw new Error("BILLING_CREDIT_USAGE_EVENT_CODE not configured");

  const from = new Date(Date.now() - days * 86400000).toISOString();
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const byOrg = new Map();
  let page = 1;
  const per_page = 100;
  // Lago paginates; stop after a safety cap of 50 pages (5000 events) per run.
  for (; page <= 50; page++) {
    const { data } = await axios.get(`${base}/events`, {
      headers,
      params: { code, from_date: from, per_page, page },
      timeout: 20000
    });
    const events = data?.events || [];
    for (const ev of events) {
      const org = String(ev.external_customer_id ?? ev.external_subscription_id ?? "unknown");
      const creditsProp = Number(ev?.properties?.credits ?? ev?.properties?.[process.env.BILLING_CREDIT_USAGE_PROPERTY ?? "credits"] ?? 0);
      const cur = byOrg.get(org) || { credits: 0, events: 0 };
      cur.credits += Number.isFinite(creditsProp) ? creditsProp : 0;
      cur.events += 1;
      byOrg.set(org, cur);
    }
    if (events.length < per_page) break;
  }

  if (perOrg) return byOrg;
  const total = { credits: 0, events: 0 };
  for (const v of byOrg.values()) {
    total.credits += v.credits;
    total.events += v.events;
  }
  return total;
}

function printTable(rows, groupCols) {
  if (!rows.length) {
    console.log("(no platform-key usage found in the window)");
    return;
  }
  const cols = [...groupCols, "requests", "input_tokens", "output_tokens", "total_tokens", "cost_usd", "successes", "failures"];
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (vals) => vals.map((v, i) => String(v ?? "").padEnd(widths[i])).join("  ");
  console.log(line(cols));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(cols.map((c) => (c === "cost_usd" ? Number(r[c]).toFixed(4) : r[c]))));
}

async function main() {
  const args = parseArgs();
  const groupCols = parseGroupBy(args.group);

  const rows = await queryTimescale({ days: args.days, groupCols, service: args.service });

  let lago = null;
  if (args.lago) {
    try {
      // Per-org map when we grouped by org, otherwise a single total.
      lago = await queryLagoWalletDebits({ days: args.days, perOrg: groupCols.includes("org_id") });
    } catch (err) {
      console.error(`[warn] lago reconciliation failed: ${err.message}`);
    }
  }

  if (args.json) {
    const out = { window_days: args.days, group_by: groupCols, service: args.service, rows };
    if (lago instanceof Map) out.lago_by_org = Object.fromEntries(lago);
    else if (lago) out.lago_total = lago;
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`Platform-key usage — last ${args.days}d, grouped by ${groupCols.join(" + ")}${args.service ? ` (service=${args.service})` : ""}`);
    console.log();
    printTable(rows, groupCols);
    const totals = rows.reduce(
      (acc, r) => ({
        requests: acc.requests + Number(r.requests || 0),
        cost_usd: acc.cost_usd + Number(r.cost_usd || 0),
        total_tokens: acc.total_tokens + Number(r.total_tokens || 0)
      }),
      { requests: 0, cost_usd: 0, total_tokens: 0 }
    );
    console.log();
    console.log(`TOTAL  requests=${totals.requests}  tokens=${totals.total_tokens}  cost_usd=${totals.cost_usd.toFixed(4)}`);
    if (lago instanceof Map) {
      console.log();
      console.log(`Lago wallet-debit credits (per org):`);
      for (const [org, v] of lago) console.log(`  ${org.padEnd(16)} credits=${v.credits.toFixed(4)}  events=${v.events}`);
    } else if (lago) {
      console.log(`Lago wallet-debit totals: credits=${lago.credits.toFixed(4)}  events=${lago.events}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err?.message || err);
  process.exit(1);
});

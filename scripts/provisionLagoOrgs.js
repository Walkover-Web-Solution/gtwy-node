/**
 * Bulk-provisions Lago customers/subscriptions for every org.
 *
 * Fetches all orgs the same way report.controller.js does (via the MSG91
 * getCompanies API) and calls POST /api/lago/provision/admin for each org_id.
 *
 * !! MONEY WARNING !!
 * Provisioning creates each org's wallet with LAGO_SIGNUP_GRANT_CREDITS
 * (default 1000) granted credits. Run over N orgs = N x grant of real credit.
 * Run --dry-run first, check the org count, and confirm the grant is intended.
 * Re-runs are safe: already-provisioned orgs are skipped (409/422 handled).
 *
 * The provision route is gated by InternalAuth, which only allows a
 * hardcoded list of admin emails (see middlewares/middleware.js). Since we
 * have SecretKey in .env, we just sign our own short-lived token locally
 * instead of needing someone to paste a real login token.
 *
 * Usage:
 *   node scripts/provisionLagoOrgs.js                  # provision all orgs
 *   node scripts/provisionLagoOrgs.js --dry-run         # list orgs, call nothing
 *   node scripts/provisionLagoOrgs.js --org-id=70371    # provision a single org
 *   node scripts/provisionLagoOrgs.js --concurrency=5 --delay-ms=200
 *
 * Env vars (all optional, read from .env):
 *   LAGO_API_BASE_URL      base URL of this API, default http://localhost:7072
 *   LAGO_SCRIPT_ADMIN_EMAIL email used in the signed token, must be in
 *                          InternalAuth's allowedEmailList, default husain@whozzat.com
 */

import dotenv from "dotenv";
import axios from "axios";
import jwt from "jsonwebtoken";

dotenv.config();

const BASE_URL = process.env.LAGO_API_BASE_URL || "http://localhost:7072";
const ADMIN_EMAIL = process.env.LAGO_SCRIPT_ADMIN_EMAIL || "husain@whozzat.com";

function parseArgs(argv) {
  const args = { dryRun: false, orgId: null, concurrency: 3, delayMs: 150 };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--org-id=")) args.orgId = arg.split("=")[1];
    else if (arg.startsWith("--concurrency=")) args.concurrency = Number(arg.split("=")[1]);
    else if (arg.startsWith("--delay-ms=")) args.delayMs = Number(arg.split("=")[1]);
  }
  return args;
}

function buildInternalAuthToken() {
  if (!process.env.SecretKey) {
    throw new Error("SecretKey is not set in .env — cannot sign an internal auth token");
  }
  return jwt.sign({ user: { email: ADMIN_EMAIL } }, process.env.SecretKey, { expiresIn: "10m" });
}

async function fetchAllOrgIds() {
  // Page through getCompanies instead of one magic-number request — orgs past
  // a hardcoded itemsPerPage were silently skipped before.
  const PAGE_SIZE = 1000;
  const ids = [];
  for (let page = 1; ; page++) {
    const response = await axios.get(
      `https://routes.msg91.com/api/${process.env.PUBLIC_REFERENCEID}/getCompanies?itemsPerPage=${PAGE_SIZE}&pageNo=${page}`,
      { headers: { authkey: process.env.ADMIN_API_KEY } }
    );
    const orgs = Array.isArray(response.data?.data) ? response.data.data : [];
    ids.push(...orgs.map((org) => String(org.id)));
    if (orgs.length < PAGE_SIZE) break;
  }
  return ids;
}

async function provisionOrg(orgId, token) {
  const response = await axios.post(
    `${BASE_URL}/api/lago/provision/admin`,
    { org_id: orgId },
    { headers: { Authorization: token, "Content-Type": "application/json" } }
  );
  return response.data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, next));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const orgIds = args.orgId ? [args.orgId] : await fetchAllOrgIds();
  console.log(`Found ${orgIds.length} org(s) to provision.`);

  if (args.dryRun) {
    console.log(orgIds);
    return;
  }

  const token = buildInternalAuthToken();
  const summary = { succeeded: [], failed: [] };

  await runWithConcurrency(orgIds, args.concurrency, async (orgId) => {
    try {
      const result = await provisionOrg(orgId, token);
      summary.succeeded.push(orgId);
      console.log(`[ok] org ${orgId}:`, result?.message ?? result);
    } catch (error) {
      summary.failed.push({ orgId, error: error.response?.data ?? error.message });
      console.error(`[fail] org ${orgId}:`, error.response?.data ?? error.message);
    }
    if (args.delayMs > 0) await sleep(args.delayMs);
  });

  console.log("\n--- Summary ---");
  console.log(`Succeeded: ${summary.succeeded.length}`);
  console.log(`Failed: ${summary.failed.length}`);
  if (summary.failed.length) console.log(summary.failed);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

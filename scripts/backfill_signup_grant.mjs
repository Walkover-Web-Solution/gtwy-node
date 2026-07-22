// One-time backfill: give the 1000-credit signup grant to orgs that existed
// BEFORE the wallet feature shipped (docs/billing-idempotency-outbox-credit-system.md §4).
//
// Design: for pre-existing orgs (which have no wallet yet), createWallet()
// provisions the wallet WITH granted_credits atomically — so this script simply
// calls createWallet() per org. It is idempotent: Lago rejects a second active
// wallet for the same customer, so re-running (or overlap with an org that has
// since been provisioned by the live provision webhook) is a safe no-op, never
// a double-grant. Because the grant rides on wallet creation (not a separate
// transaction), there is no double-grant risk against the going-forward path.
//
// Org source is an EXPLICIT reviewed list, not an implicit "all orgs" query —
// this grants money, so the input should be auditable. Provide a JSON file:
//   node scripts/backfill_signup_grant.mjs ./org_ids.json
// where org_ids.json is either ["org1","org2",...] or [{"org_id":"org1"},...].

import fs from "fs";

import { createWallet } from "../src/services/lago.service.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node scripts/backfill_signup_grant.mjs <org_ids.json>");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const orgIds = raw.map((entry) => (typeof entry === "string" ? entry : entry.org_id)).filter(Boolean);

console.log(`backfill_signup_grant: ${orgIds.length} org(s) from ${inputPath}`);

let granted = 0;
let skipped = 0;
let failed = 0;

for (const org_id of orgIds) {
  try {
    await createWallet(String(org_id));
    granted += 1;
    console.log(`granted   ${org_id}`);
  } catch (err) {
    const alreadyExists = err?.response?.status === 422 || err?.response?.status === 400;
    if (alreadyExists) {
      skipped += 1;
      console.log(`skipped   ${org_id} (wallet already exists)`);
    } else {
      failed += 1;
      console.error(`FAILED    ${org_id}: ${err?.message || err}`);
    }
  }
}

console.log(`\ndone — granted=${granted} skipped=${skipped} failed=${failed}`);
console.log("re-run is safe: already-granted orgs are skipped.");
process.exit(failed ? 1 : 0);

/**
 * Migration: strip expiration_at from every active Lago wallet.
 *
 * WHY. createWallet used to set wallet.expiration_at from
 * LAGO_SIGNUP_GRANT_EXPIRY_DAYS (90), meaning to expire the unused SIGNUP
 * GRANT. But in Lago expiration_at expires the ENTIRE WALLET — on that date
 * "all remaining credits are automatically voided" — and topupWallet never
 * clears it. So an org provisioned on day 0 that PAYS on day 80 has those paid
 * credits destroyed on day 90. Lago has no per-transaction expiry, so the grant
 * cannot be expired on its own without a second wallet per org; at
 * LAGO_CREDIT_RATE_USD 0.0025 a 100-credit grant is worth $0.25, so that
 * machinery is not worth building. createWallet no longer sets the field; this
 * removes it from wallets already created.
 *
 * This migration talks to LAGO, not Mongo — it is a migration rather than a
 * script so it runs automatically on deploy (dockerStart runs migrate-mongo up
 * before starting the app) and cannot be forgotten in an environment that has
 * real wallets. The testing Lago has none, so there it is a logged no-op; the
 * work happens the first time this deploys somewhere with customers.
 *
 * Idempotent: only wallets that still carry an expiration_at are touched, so a
 * re-run does nothing.
 *
 * FAILURE POLICY. Individual wallet failures are collected and reported but do
 * not stop the run. Being unable to reach Lago at all DOES throw, so
 * migrate-mongo leaves the migration unrecorded and retries on the next deploy
 * — "we could not check" must never be filed as "done". That does mean a
 * sustained Lago outage will block a deploy, which is the intended trade for a
 * fix that protects customers' paid balances.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

const PER_PAGE = 100;

const billingConfig = () => {
  const url = process.env.BILLING_API_URL;
  const key = process.env.BILLING_API_KEY;
  if (!url || !key) {
    throw new Error("BILLING_API_URL / BILLING_API_KEY are not set — cannot clear Lago wallet expiries");
  }
  return { url: url.replace(/\/$/, ""), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
};

// Lago has no "list every wallet" endpoint: GET /wallets REQUIRES
// external_customer_id and 404s ("customer_not_found") without it. So walk the
// customers and ask per customer. Note an org can hold MORE THAN ONE active
// wallet — re-provisioning used to mint a second one — so this must handle a
// list per customer, not a single wallet.
const listAllCustomers = async ({ url, headers }) => {
  const customers = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${url}/customers?per_page=${PER_PAGE}&page=${page}`, { headers });
    if (!res.ok) throw new Error(`Lago GET /customers failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const batch = body.customers || [];
    customers.push(...batch);
    const total = body.meta?.total_pages ?? 1;
    if (page >= total || batch.length === 0) break;
  }
  return customers;
};

const walletsFor = async ({ url, headers }, external_id) => {
  const res = await fetch(`${url}/wallets?external_customer_id=${encodeURIComponent(external_id)}`, { headers });
  if (!res.ok) throw new Error(`Lago GET /wallets for ${external_id} failed (${res.status})`);
  return (await res.json()).wallets || [];
};

export const up = async () => {
  const cfg = billingConfig();

  // A hard failure here throws and leaves the migration unrecorded — see the
  // failure policy above.
  const customers = await listAllCustomers(cfg);
  const wallets = [];
  for (const customer of customers) {
    for (const wallet of await walletsFor(cfg, customer.external_id)) {
      wallets.push({ ...wallet, external_customer_id: wallet.external_customer_id || customer.external_id });
    }
  }
  // Only ACTIVE wallets: a terminated one holds nothing anyone can spend.
  const expiring = wallets.filter((w) => w.expiration_at && w.status === "active");

  console.log(`Lago: ${customers.length} customers, ${wallets.length} wallets, ${expiring.length} active with an expiration_at.`);
  if (expiring.length === 0) {
    console.log("Nothing to clear — createWallet no longer sets expiration_at, so none will appear.");
    return;
  }

  const failures = [];
  for (const wallet of expiring) {
    try {
      const res = await fetch(`${cfg.url}/wallets/${wallet.lago_id}`, {
        method: "PUT",
        headers: cfg.headers,
        body: JSON.stringify({ wallet: { expiration_at: null } })
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      console.log(`  cleared expiry on wallet ${wallet.lago_id} (customer ${wallet.external_customer_id}, was ${wallet.expiration_at})`);
    } catch (err) {
      failures.push({ wallet: wallet.lago_id, customer: wallet.external_customer_id, error: err.message });
      console.error(`  FAILED wallet ${wallet.lago_id} (customer ${wallet.external_customer_id}): ${err.message}`);
    }
  }

  console.log(`Cleared ${expiring.length - failures.length}/${expiring.length} wallet expiries.`);
  if (failures.length) {
    // Reported, not thrown: the migration is idempotent, so re-running picks up
    // the stragglers, and blocking every future deploy over one bad wallet is
    // worse than the wallets that DID get fixed being recorded as fixed.
    console.warn(
      `WARNING: ${failures.length} wallet(s) still carry an expiration_at and will void their credits. ` +
        `Re-run this migration or clear them by hand: ${JSON.stringify(failures)}`
    );
  }
};

// Deliberately irreversible. Down would mean re-attaching a deadline to
// customers' paid credits, which is the bug this removes.
export const down = async () => {
  console.log("clear_lago_wallet_expiry is not reversible — re-adding a wallet expiry would void paid credits.");
};

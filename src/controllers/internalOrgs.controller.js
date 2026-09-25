import logger from "../logger.js";
import internalOrgService from "../db_services/internalOrg.service.js";
import { getWallet, getSubscription, getShadowBalance, listWalletTransactions, topupWallet } from "../services/lago.service.js";
import { getOrganizationById } from "../services/proxy.service.js";

// Internal credits dashboard: list our own orgs, see their credits, grant more.
// Every route is behind InternalAuth (email allowlist). Granting goes through
// topupWallet, which writes Lago AND resyncs the gate's Redis balance, so the
// dashboard never leaves the two disagreeing.

const toNumber = (value) => (value === null || value === undefined || value === "" ? null : Number(value));

// One org's row. A Lago failure for one org is reported on its row instead of
// failing the whole list.
const buildRow = async (org) => {
  const row = { org_id: org.org_id, name: org.name, added_by: org.added_by, added_at: org.createdAt };
  try {
    const [wallet, subscription, gate] = await Promise.all([
      getWallet(org.org_id),
      getSubscription(org.org_id).catch(() => null),
      getShadowBalance(org.org_id)
    ]);
    const balance = toNumber(wallet?.credits_balance);
    const used = toNumber(wallet?.credits_ongoing_usage_balance) ?? 0;
    Object.assign(row, {
      plan: subscription?.plan_slug ?? null,
      plan_code: subscription?.plan_code ?? null,
      fee_cents: subscription?.plan_amount_cents ?? null,
      has_wallet: Boolean(wallet),
      balance,
      used_this_period: used,
      spendable: balance === null ? null : balance - used,
      // What the request gate currently believes; null = no cached value yet
      // (the next request seeds it from Lago).
      gate_balance: toNumber(gate),
      rate_amount: toNumber(wallet?.rate_amount),
      wallet_count: wallet?.active_wallet_count ?? 0
    });
  } catch (err) {
    row.error = err.message;
  }
  return row;
};

// Lets the dashboard check a token before showing anything.
const access = async (req, res, next) => {
  res.locals = { success: true, data: { allowed: true, email: req.profile?.user?.email ?? null } };
  req.statusCode = 200;
  return next();
};

const listInternalOrgs = async (req, res, next) => {
  const orgs = await internalOrgService.list();
  const rows = await Promise.all(orgs.map(buildRow));
  res.locals = { success: true, data: rows };
  req.statusCode = 200;
  return next();
};

const addInternalOrg = async (req, res, next) => {
  const org_id = String(req.body.org_id);

  const existing = await internalOrgService.getByOrg(org_id);
  if (existing) {
    res.locals = { success: true, message: `org ${org_id} is already internal`, data: await buildRow(existing) };
    req.statusCode = 200;
    return next();
  }

  const org = await getOrganizationById(org_id);
  if (!org) {
    res.locals = { success: false, message: `org ${org_id} was not found in MSG91` };
    req.statusCode = 404;
    return next();
  }
  // Credits can only be granted to an org that already has a wallet; refuse
  // here rather than list an org whose "Add credits" would always fail.
  if (!(await getWallet(org_id))) {
    res.locals = { success: false, message: `org ${org_id} has no Lago wallet — provision it first` };
    req.statusCode = 400;
    return next();
  }

  const row = await internalOrgService.add(org_id, { name: org.name ?? null, added_by: req.profile?.user?.email ?? null });
  logger.info(`[internal-orgs] org ${org_id} (${org.name}) added by ${req.profile?.user?.email}`);
  res.locals = { success: true, message: `org ${org_id} added`, data: await buildRow(row) };
  req.statusCode = 201;
  return next();
};

const removeInternalOrg = async (req, res, next) => {
  const org_id = String(req.params.org_id);
  const removed = await internalOrgService.remove(org_id);
  if (removed) logger.info(`[internal-orgs] org ${org_id} removed by ${req.profile?.user?.email}`);
  res.locals = removed
    ? { success: true, message: `org ${org_id} removed from the internal list (wallet and plan untouched)` }
    : { success: false, message: `org ${org_id} is not in the internal list` };
  req.statusCode = removed ? 200 : 404;
  return next();
};

const listTransactions = async (req, res, next) => {
  const org_id = String(req.params.org_id);
  if (!(await internalOrgService.getByOrg(org_id))) {
    res.locals = { success: false, message: `org ${org_id} is not in the internal list` };
    req.statusCode = 404;
    return next();
  }
  const transactions = await listWalletTransactions(org_id, { per_page: req.query.limit ?? 10 });
  res.locals = { success: true, data: transactions };
  req.statusCode = 200;
  return next();
};

const addCredits = async (req, res, next) => {
  const org_id = String(req.params.org_id);
  const { credits, reason, reference_id } = req.body;
  const by = req.profile?.user?.email ?? null;

  // Only listed internal orgs: the dashboard must never top up a customer.
  if (!(await internalOrgService.getByOrg(org_id))) {
    res.locals = { success: false, message: `org ${org_id} is not in the internal list` };
    req.statusCode = 404;
    return next();
  }

  // Four metadata keys with the reference_id topupWallet adds; Lago rejects more than five.
  const result = await topupWallet(org_id, credits, { reference_id, metadata: { source: "internal-dashboard", by, reason } });
  const gate_balance = toNumber(await getShadowBalance(org_id));

  if (result.duplicate) {
    logger.warn(`[internal-orgs] duplicate grant ignored for org ${org_id} reference_id=${reference_id} (by ${by})`);
  } else {
    logger.info(`[internal-orgs] granted ${credits} credits to org ${org_id} by ${by} — ${reason}`);
  }
  res.locals = {
    success: true,
    message: result.duplicate ? "already applied for this reference_id — nothing added" : `added ${credits} credits`,
    data: {
      org_id,
      credits_added: result.duplicate ? 0 : credits,
      duplicate: result.duplicate,
      // The balance just written to the gate (Lago's ongoing balance).
      synced_balance: toNumber(result.credits_balance),
      gate_balance
    }
  };
  req.statusCode = 200;
  return next();
};

export default { access, listInternalOrgs, addInternalOrg, removeInternalOrg, listTransactions, addCredits };

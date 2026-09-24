import OrgBillingModel from "../mongoModel/OrgBilling.model.js";

// All Mongo access for org_billings lives here.

const getByOrg = async (org_id) => OrgBillingModel.findOne({ org_id: String(org_id) }).lean();

// Create-or-update; the org_id is the identity and is never changed.
const upsert = async (org_id, fields) =>
  OrgBillingModel.findOneAndUpdate(
    { org_id: String(org_id) },
    { $set: fields, $setOnInsert: { org_id: String(org_id) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

// Conditional transition: apply `fields` only while the row is in one of
// `fromStatuses`. Returns the updated row, or null when the guard did not match
// (someone else moved it first). Atomic, so two webhooks racing on the same org
// cannot both, say, start a grace period.
const setStatusIf = async (org_id, fromStatuses, fields) =>
  OrgBillingModel.findOneAndUpdate({ org_id: String(org_id), status: { $in: fromStatuses } }, { $set: fields }, { new: true }).lean();

const listByStatus = async (statuses) => OrgBillingModel.find({ status: { $in: statuses } }).lean();

// Rows whose grace period has run out.
const listGraceExpired = async (now = new Date()) => OrgBillingModel.find({ status: "past_due", grace_until: { $ne: null, $lte: now } }).lean();

// Record a settled credit purchase: add it to the unspent purchased balance so
// the next renewal tops up the allowance only, not the whole wallet.
const addPurchasedCredits = async (org_id, credits, fields = {}) =>
  OrgBillingModel.findOneAndUpdate(
    { org_id: String(org_id) },
    { $inc: { credits_purchased_balance: Number(credits) || 0 }, $set: fields, $setOnInsert: { org_id: String(org_id) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

// Forget the open payment pages for these invoices. An $unset per pack key, not
// a rewrite of the whole map: a purchase of another pack can be adding its own
// entry at the same moment, and a rewrite from a row read a moment earlier would
// drop it (or resurrect one just cleared).
const clearPendingPurchases = async (org_id, invoice_ids) => {
  const wanted = new Set((invoice_ids ?? []).map(String));
  if (!wanted.size) return null;
  const row = await getByOrg(org_id);
  const keys = Object.entries(row?.pending_credit_purchases ?? {})
    .filter(([, p]) => wanted.has(String(p?.invoice_id)))
    .map(([key]) => `pending_credit_purchases.${key}`);
  if (!keys.length) return row;
  return OrgBillingModel.findOneAndUpdate({ org_id: String(org_id) }, { $unset: Object.fromEntries(keys.map((k) => [k, ""])) }, { new: true }).lean();
};

// Every org attached to the Stripe connection, i.e. every org that could have
// bought a credit pack (buying attaches it). Wider than listByStatus: a FREE org
// can buy too.
const listWithPaymentMethod = async () => OrgBillingModel.find({ payment_provider_code: { $ne: null } }).lean();

const incrementRetry = async (org_id) =>
  OrgBillingModel.updateOne({ org_id: String(org_id) }, { $inc: { retry_count: 1 }, $set: { last_retry_at: new Date() } });

export default {
  getByOrg,
  upsert,
  setStatusIf,
  listByStatus,
  listGraceExpired,
  incrementRetry,
  addPurchasedCredits,
  clearPendingPurchases,
  listWithPaymentMethod
};

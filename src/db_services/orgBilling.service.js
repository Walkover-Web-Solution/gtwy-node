import OrgBillingModel from "../mongoModel/OrgBilling.model.js";

// All Mongo access for org_billings lives here.

const getByOrg = async (org_id) => OrgBillingModel.findOne({ org_id: String(org_id) }).lean();

const getByCustomer = async (stripe_customer_id) => OrgBillingModel.findOne({ stripe_customer_id: String(stripe_customer_id) }).lean();

const getBySubscription = async (stripe_subscription_id) =>
  OrgBillingModel.findOne({ stripe_subscription_id: String(stripe_subscription_id) }).lean();

// Create-or-update; the org_id is the identity and is never changed.
const upsert = async (org_id, fields) =>
  OrgBillingModel.findOneAndUpdate(
    { org_id: String(org_id) },
    { $set: fields, $setOnInsert: { org_id: String(org_id) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

// Record the Stripe customer for an org ONLY if none is recorded yet. Two
// concurrent checkouts can both create a Stripe customer; the loser of this
// write gets null back and must reuse the winner's id, so an org never ends
// up with two customers in our records (the orphan is logged for cleanup).
const setCustomerIfUnset = async (org_id, stripe_customer_id) => {
  try {
    return await OrgBillingModel.findOneAndUpdate(
      { org_id: String(org_id), stripe_customer_id: null },
      { $set: { stripe_customer_id: String(stripe_customer_id) }, $setOnInsert: { org_id: String(org_id) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  } catch (err) {
    // 11000 = the org row already exists with a customer (the filter did not
    // match, so the upsert tried to insert a second org_id). Report "lost".
    if (err?.code === 11000) return null;
    throw err;
  }
};

const listByStatus = async (statuses) => OrgBillingModel.find({ status: { $in: statuses } }).lean();

const pushDuplicateSubscription = async (org_id, stripe_subscription_id) =>
  OrgBillingModel.updateOne({ org_id: String(org_id) }, { $addToSet: { duplicate_subscription_ids: String(stripe_subscription_id) } });

export default { getByOrg, getByCustomer, getBySubscription, upsert, setCustomerIfUnset, listByStatus, pushDuplicateSubscription };

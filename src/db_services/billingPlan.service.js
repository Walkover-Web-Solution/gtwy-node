import BillingPlanModel from "../mongoModel/BillingPlan.model.js";

// All Mongo access for billing_plans lives here.

// Every plan, ordered by plan_code.
async function listPlans() {
  return BillingPlanModel.find({}).sort({ plan_code: 1 }).lean();
}

// One plan by its code, or null.
async function getPlan(plan_code) {
  return BillingPlanModel.findOne({ plan_code: String(plan_code) }).lean();
}

// Active plans only, with just the fields safe to show an end user —
// `services` (the internal per-plan model allowlist) is deliberately omitted.
async function listActivePlans() {
  return BillingPlanModel.find({ status: 1 }).select("plan_code display_name credit_grant").sort({ plan_code: 1 }).lean();
}

// Create or update a plan and return the stored document.
async function upsertPlan(plan_code, fields) {
  return BillingPlanModel.findOneAndUpdate(
    { plan_code: String(plan_code) },
    { $set: fields, $setOnInsert: { plan_code: String(plan_code) } },
    { upsert: true, new: true, runValidators: true }
  ).lean();
}

// Delete a plan; true when a document was removed.
async function deletePlan(plan_code) {
  const result = await BillingPlanModel.deleteOne({ plan_code: String(plan_code) });
  return result.deletedCount > 0;
}

export default { listPlans, getPlan, listActivePlans, upsertPlan, deletePlan };

import BillingPlanModel from "../mongoModel/BillingPlan.model.js";

// All Mongo access for billing_plans lives here (AI_INSTRUCTIONS.md: models are
// referenced only inside the service layer).

async function listPlans() {
  return BillingPlanModel.find({}).sort({ plan_code: 1 }).lean();
}

async function getPlan(plan_code) {
  return BillingPlanModel.findOne({ plan_code: String(plan_code) }).lean();
}

async function upsertPlan(plan_code, fields) {
  return BillingPlanModel.findOneAndUpdate(
    { plan_code: String(plan_code) },
    { $set: fields, $setOnInsert: { plan_code: String(plan_code) } },
    { upsert: true, new: true, runValidators: true }
  ).lean();
}

async function deletePlan(plan_code) {
  const result = await BillingPlanModel.deleteOne({ plan_code: String(plan_code) });
  return result.deletedCount > 0;
}

export default { listPlans, getPlan, upsertPlan, deletePlan };

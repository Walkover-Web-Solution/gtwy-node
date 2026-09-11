import billingPlanService from "../db_services/billingPlan.service.js";

// Admin management of what each billing plan includes. gtwy-ai reads the
// collection live, so an edit takes effect with no deploy.

// Create or update a plan definition.
const setBillingPlan = async (req, res, next) => {
  const { plan_code, display_name, services, credit_grant, status, stripe_price_id, monthly_credits } = req.body;

  const doc = await billingPlanService.upsertPlan(plan_code, {
    display_name,
    services,
    credit_grant,
    status,
    // Mongoose strips undefined from $set, so omitting these leaves stored values alone.
    stripe_price_id,
    monthly_credits,
    updated_by: req.profile?.user?.email || ""
  });

  res.locals = { success: true, message: "billing plan saved", data: doc };
  req.statusCode = 200;
  return next();
};

// Every plan definition.
const listBillingPlans = async (req, res, next) => {
  res.locals = { success: true, data: await billingPlanService.listPlans() };
  req.statusCode = 200;
  return next();
};

// Active plans, safe fields only — for any signed-in user to browse (e.g. the plans page).
const listPublicBillingPlans = async (req, res, next) => {
  res.locals = { success: true, data: await billingPlanService.listActivePlans() };
  req.statusCode = 200;
  return next();
};

// One plan definition by code.
const getBillingPlan = async (req, res, next) => {
  const doc = await billingPlanService.getPlan(req.params.plan_code);

  res.locals = doc ? { success: true, data: doc } : { success: false, message: `no billing plan '${req.params.plan_code}'` };
  req.statusCode = doc ? 200 : 404;
  return next();
};

// Delete a plan definition.
const removeBillingPlan = async (req, res, next) => {
  const removed = await billingPlanService.deletePlan(req.body.plan_code);

  // Orgs still on a deleted plan fall back to the most restrictive one, so say so.
  res.locals = {
    success: true,
    message: removed
      ? `billing plan removed — any org still on '${req.body.plan_code}' now falls back to the most restrictive plan`
      : "no such billing plan"
  };
  req.statusCode = 200;
  return next();
};

export default { setBillingPlan, listBillingPlans, listPublicBillingPlans, getBillingPlan, removeBillingPlan };

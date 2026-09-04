import billingPlanService from "../db_services/billingPlan.service.js";

// Admin management of what each billing plan includes. Python reads the
// collection live through a change stream, so an edit here takes effect on the
// next request with no deploy and no migration — that is the whole point of the
// feature. Editing a plan does NOT move any org between plans; that is
// POST /api/lago/plan.

const setBillingPlan = async (req, res, next) => {
  const { plan_code, display_name, services, credit_grant, status } = req.body;

  const doc = await billingPlanService.upsertPlan(plan_code, {
    display_name,
    services,
    credit_grant,
    status,
    updated_by: req.profile?.user?.email || ""
  });

  res.locals = { success: true, message: "billing plan saved", data: doc };
  req.statusCode = 200;
  return next();
};

const listBillingPlans = async (req, res, next) => {
  res.locals = { success: true, data: await billingPlanService.listPlans() };
  req.statusCode = 200;
  return next();
};

const getBillingPlan = async (req, res, next) => {
  const doc = await billingPlanService.getPlan(req.params.plan_code);

  res.locals = doc ? { success: true, data: doc } : { success: false, message: `no billing plan '${req.params.plan_code}'` };
  req.statusCode = doc ? 200 : 404;
  return next();
};

const removeBillingPlan = async (req, res, next) => {
  const removed = await billingPlanService.deletePlan(req.body.plan_code);

  // Deleting a plan orgs still point at demotes them to the most restrictive
  // plan on the Python side (fail-closed), so say so rather than reporting a
  // bare success.
  res.locals = {
    success: true,
    message: removed
      ? `billing plan removed — any org still on '${req.body.plan_code}' now falls back to the most restrictive plan`
      : "no such billing plan"
  };
  req.statusCode = 200;
  return next();
};

export default { setBillingPlan, listBillingPlans, getBillingPlan, removeBillingPlan };

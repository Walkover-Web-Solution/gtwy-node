import Joi from "joi";

// The `services` allowlist is validated here rather than left to Python, because
// on the Python side a plan that normalises to "nothing allowed" rejects the
// ENTIRE billing_plans load — so one bad edit would freeze every plan at its
// previous definition, with only an ERROR log to say so. Catch it at the door.
const servicesSchema = Joi.alternatives()
  .try(
    Joi.string().valid("*"),
    Joi.object()
      .min(1)
      .pattern(Joi.string().min(1), Joi.alternatives().try(Joi.string().valid("*"), Joi.array().items(Joi.string().min(1)).min(1)))
  )
  .required()
  .messages({
    "alternatives.match": 'services must be "*" or an object mapping a service to "*" or a non-empty array of model names',
    "any.required": "services required"
  });

// plan_code is the wire slug shared with Python and Redis. Restricted to the two
// plans Python recognises: billing_utils.get_org_plan coerces anything else to
// "free", which would silently restrict a paying org. Widening this list is a
// two-repo, ordered change — Python first.
const planCodeSchema = Joi.string().valid("free", "paid").required().messages({
  "any.only": 'plan_code must be "free" or "paid" — adding a plan requires a coordinated Python release first',
  "any.required": "plan_code required"
});

const setBillingPlan = {
  body: Joi.object().keys({
    plan_code: planCodeSchema,
    display_name: Joi.string().min(1).required().messages({ "any.required": "display_name required" }),
    services: servicesSchema,
    credit_grant: Joi.number().min(0).default(0),
    status: Joi.number().valid(0, 1).default(1)
  })
};

const getBillingPlan = {
  params: Joi.object().keys({ plan_code: planCodeSchema })
};

const removeBillingPlan = {
  body: Joi.object().keys({ plan_code: planCodeSchema })
};

export default { setBillingPlan, getBillingPlan, removeBillingPlan };

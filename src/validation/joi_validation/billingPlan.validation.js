import Joi from "joi";

// Validated here because gtwy-ai rejects the whole billing_plans load if a plan
// normalises to "nothing allowed", freezing every plan at its previous definition.
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

// Per-hit fees in USD, by kind of hit. Validated tightly because a wrong number
// here charges real money on every request and gtwy-ai takes the value as given.
// The cap is a typo guard, not a policy: raise it deliberately if a plan really
// needs to charge more than $10 a hit.
const hitFeesSchema = Joi.object()
  .keys({
    api: Joi.number().min(0).max(10).default(0),
    chatbot: Joi.number().min(0).max(10).default(0),
    embed: Joi.number().min(0).max(10).default(0)
  })
  .optional()
  .messages({
    "object.unknown": "hit_fees accepts only api, chatbot and embed",
    "number.max": "a per-hit fee above $10 looks like a mistake"
  });

// The wire slug shared with gtwy-ai, which coerces anything else to "free".
// Widening this list is a two-repo change, gtwy-ai first.
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
    status: Joi.number().valid(0, 1).default(1),
    // The balance a paid subscription invoice tops the wallet up TO. Optional so
    // an edit that does not mention it leaves the stored value alone.
    monthly_credits: Joi.number().integer().min(0).optional(),
    // Per-hit fees for this plan. Optional, and sending it REPLACES the stored
    // map, so include every kind you want charged.
    hit_fees: hitFeesSchema
  })
};

const getBillingPlan = {
  params: Joi.object().keys({ plan_code: planCodeSchema })
};

const removeBillingPlan = {
  body: Joi.object().keys({ plan_code: planCodeSchema })
};

export default { setBillingPlan, getBillingPlan, removeBillingPlan };

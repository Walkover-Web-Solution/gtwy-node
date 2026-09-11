import Joi from "joi";

// Admin routes only; the customer-facing routes take everything from the token.

const replayEvent = {
  params: Joi.object().keys({
    event_id: Joi.string()
      .pattern(/^(evt_[A-Za-z0-9]+|reconcile:in_[A-Za-z0-9]+)$/)
      .required()
      .messages({ "string.pattern.base": "event_id must be a Stripe event id (evt_…) or a reconcile id (reconcile:in_…)" })
  })
};

const orgParam = {
  params: Joi.object().keys({
    org_id: Joi.string().required().messages({ "any.required": "org_id required" })
  })
};

const reconcile = {
  body: Joi.object().keys({
    // Default is a dry run: report what would change, change nothing.
    dry_run: Joi.boolean().default(true),
    lookback_days: Joi.number().integer().min(1).max(365).default(45)
  })
};

export default { replayEvent, orgParam, reconcile };

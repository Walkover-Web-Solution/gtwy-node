import Joi from "joi";

// Admin routes only; the customer-facing routes take everything from the token.

const replayEvent = {
  params: Joi.object().keys({
    // A Lago webhook id, or a reconcile key ("reconcile:<invoice lago_id>").
    unique_key: Joi.string()
      .min(1)
      .max(200)
      .pattern(/^[A-Za-z0-9:_-]+$/)
      .required()
      .messages({ "string.pattern.base": "unique_key must be a Lago webhook id or a reconcile:<invoice_id> key" })
  })
};

const orgParam = {
  params: Joi.object().keys({
    org_id: Joi.string().required().messages({ "any.required": "org_id required" })
  })
};

// Buying a credit pack. Only the USD amount is accepted, and the service
// checks it against the packs actually on offer — the number of credits is
// derived from the org's rate, never taken from the client.
const buyCredits = {
  body: Joi.object().keys({
    usd: Joi.number().positive().required().messages({
      "any.required": "usd required — the amount of the credit pack to buy",
      "number.positive": "usd must be a positive amount"
    })
  })
};

const reconcile = {
  body: Joi.object().keys({
    // Default is a dry run: report what would change, change nothing.
    dry_run: Joi.boolean().default(true),
    lookback_days: Joi.number().integer().min(1).max(365).default(45)
  })
};

export default { replayEvent, orgParam, reconcile, buyCredits };

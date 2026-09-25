import Joi from "joi";

// Internal credits dashboard. Every route is also behind InternalAuth.

// The biggest single grant the dashboard accepts. A typo guard, not a policy:
// one stray zero here is real credit handed out. Grant twice for more.
export const MAX_CREDITS_PER_GRANT = 1_000_000;

const orgId = Joi.alternatives()
  .try(
    Joi.string()
      .trim()
      .pattern(/^[A-Za-z0-9_-]{1,64}$/),
    Joi.number().integer().positive()
  )
  .required()
  .messages({ "any.required": "org_id required", "alternatives.match": "org_id must be an org id" });

const orgParam = {
  params: Joi.object().keys({ org_id: orgId })
};

const addOrg = {
  body: Joi.object().keys({ org_id: orgId })
};

const transactions = {
  params: Joi.object().keys({ org_id: orgId }),
  query: Joi.object().keys({ limit: Joi.number().integer().min(1).max(50).default(10) })
};

const addCredits = {
  params: Joi.object().keys({ org_id: orgId }),
  body: Joi.object().keys({
    credits: Joi.number()
      .integer()
      .positive()
      .max(MAX_CREDITS_PER_GRANT)
      .required()
      .messages({
        "number.base": "credits must be a number",
        "number.integer": "credits must be a whole number",
        "number.positive": "credits must be greater than 0",
        "number.max": `at most ${MAX_CREDITS_PER_GRANT} credits per grant`,
        "any.required": "credits required"
      }),
    reason: Joi.string().trim().min(1).max(200).required().messages({ "any.required": "reason required", "string.empty": "reason required" }),
    // Created by the client when the dialog opens; a retry or double-click with
    // the same id is recognised by topupWallet and grants nothing extra.
    reference_id: Joi.string().trim().min(8).max(100).required().messages({ "any.required": "reference_id required" })
  })
};

export default { orgParam, addOrg, transactions, addCredits };

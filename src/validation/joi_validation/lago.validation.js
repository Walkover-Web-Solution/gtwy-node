import Joi from "joi";
import { PLAN_SLUGS } from "../../configs/billingPlans.js";

// MSG91 webhook body — the sender owns the shape, so unknown keys must pass.
const provisionWebhook = {
  body: Joi.object()
    .keys({
      event: Joi.string().required().messages({
        "any.required": "event required"
      }),
      data: Joi.object().unknown(true).required().messages({
        "any.required": "data required"
      })
    })
    .unknown(true)
};

const provisionOrg = {
  body: Joi.object().keys({
    org_id: Joi.alternatives().try(Joi.string(), Joi.number()).required().messages({
      "any.required": "org_id not found"
    })
  })
};

const topupOrgWallet = {
  body: Joi.object().keys({
    org_id: Joi.alternatives().try(Joi.string(), Joi.number()).required().messages({
      "any.required": "org_id required"
    }),
    credits: Joi.number().positive().required().messages({
      "number.base": "credits must be a number",
      "number.positive": "credits must be greater than 0",
      "any.required": "credits required"
    }),
    reference_id: Joi.string().optional(),
    metadata: Joi.object().optional()
  })
};

const syncWalletBalance = {
  params: Joi.object().keys({
    org_id: Joi.string().required().messages({
      "string.empty": "org_id required",
      "any.required": "org_id required"
    })
  })
};

// Slugs come from the plan registry so the two cannot drift.
const planSlug = Joi.string()
  .valid(...PLAN_SLUGS)
  .required()
  .messages({
    "any.only": `plan must be one of ${PLAN_SLUGS.join(", ")}`,
    "any.required": "plan required"
  });

const setOrgPlan = {
  body: Joi.object().keys({
    org_id: Joi.alternatives().try(Joi.string(), Joi.number()).required().messages({
      "any.required": "org_id required"
    }),
    plan: planSlug,
    // Free text for the audit line.
    reason: Joi.string().max(500).optional()
  })
};

const getOrgPlan = {
  params: Joi.object().keys({
    org_id: Joi.string().required().messages({
      "string.empty": "org_id required",
      "any.required": "org_id required"
    })
  })
};

export default { provisionWebhook, provisionOrg, topupOrgWallet, syncWalletBalance, setOrgPlan, getOrgPlan };

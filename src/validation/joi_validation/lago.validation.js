import Joi from "joi";

const provisionOrg = {
  body: Joi.object().keys({
    org_id: Joi.string().required().messages({
      "any.required": "org_id not found"
    })
  })
};

const getWalletBalance = {
  params: Joi.object().keys({
    org_id: Joi.string().required().messages({
      "string.empty": "org_id required",
      "any.required": "org_id required"
    })
  })
};

const topupOrgWallet = {
  body: Joi.object().keys({
    org_id: Joi.string().required().messages({
      "string.empty": "org_id required",
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

export default { provisionOrg, getWalletBalance, topupOrgWallet, syncWalletBalance };

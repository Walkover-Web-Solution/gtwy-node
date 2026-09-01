import Joi from "joi";

const idField = Joi.alternatives().try(Joi.string(), Joi.number());

const setUserLimit = {
  body: Joi.object().keys({
    folder_id: Joi.string().required().messages({ "any.required": "folder_id required" }),
    user_id: idField.required().messages({ "any.required": "user_id required" }),
    user_limit: Joi.number().min(0).required().messages({
      "number.base": "user_limit must be a number",
      "number.min": "user_limit cannot be negative",
      "any.required": "user_limit required"
    }),
    user_limit_reset_period: Joi.string().valid("monthly", "weekly", "daily").optional()
  })
};

const listUserLimits = {
  query: Joi.object().keys({
    folder_id: Joi.string().optional()
  })
};

const removeUserLimit = {
  body: Joi.object().keys({
    folder_id: Joi.string().required().messages({ "any.required": "folder_id required" }),
    user_id: idField.required().messages({ "any.required": "user_id required" })
  })
};

export default { setUserLimit, listUserLimits, removeUserLimit };

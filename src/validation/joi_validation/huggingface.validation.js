import Joi from "joi";

const getHuggingFaceModelProviders = {
  query: Joi.object()
    .keys({
      model: Joi.string().trim().required().messages({
        "any.required": "model is required",
        "string.empty": "model cannot be empty"
      })
    })
    .unknown(true)
};

export default { getHuggingFaceModelProviders };

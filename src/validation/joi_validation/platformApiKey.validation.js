import Joi from "joi";

const setPlatformApiKey = {
  body: Joi.object().keys({
    service: Joi.string().required().messages({ "any.required": "service required" }),
    apikey: Joi.string().min(8).required().messages({
      "any.required": "apikey required",
      "string.min": "apikey looks too short"
    })
  })
};

const removePlatformApiKey = {
  body: Joi.object().keys({
    service: Joi.string().required().messages({ "any.required": "service required" })
  })
};

export default { setPlatformApiKey, removePlatformApiKey };

import Joi from "joi";

// The company object is MSG91's shape, not ours, so only the field we depend on
// is pinned and the rest is passed through untouched.
const createOrganization = {
  body: Joi.object().keys({
    company: Joi.object()
      .keys({
        name: Joi.string().min(1).required().messages({ "any.required": "company.name is required" })
      })
      .unknown(true)
      .required()
      .messages({ "any.required": "company is required" })
  })
};

export default { createOrganization };

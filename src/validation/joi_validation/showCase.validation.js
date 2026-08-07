import Joi from "joi";

const createShowCase = {
  body: Joi.object()
    .keys({
      category: Joi.string().trim().min(2).max(100).required().messages({
        "any.required": "category is required",
        "string.empty": "category cannot be empty",
        "string.min": "category must be at least 2 characters",
        "string.max": "category must not exceed 100 characters"
      }),
      name: Joi.string().trim().min(2).max(150).required().messages({
        "any.required": "name is required",
        "string.empty": "name cannot be empty",
        "string.min": "name must be at least 2 characters",
        "string.max": "name must not exceed 150 characters"
      }),
      description: Joi.string().trim().min(10).max(2000).required().messages({
        "any.required": "description is required",
        "string.empty": "description cannot be empty",
        "string.min": "description must be at least 10 characters",
        "string.max": "description must not exceed 2000 characters"
      }),
      link: Joi.string()
        .trim()
        .uri({ scheme: ["http", "https"] })
        .max(500)
        .required()
        .messages({
          "any.required": "link is required",
          "string.empty": "link cannot be empty",
          "string.uri": "link must be a valid http or https URL",
          "string.max": "link must not exceed 500 characters"
        })
    })
    .required()
};

const getShowCases = {};

export default {
  createShowCase,
  getShowCases
};

import Joi from "joi";

const createShowCase = {
  body: Joi.object()
    .keys({
      // The form posts a fixed slug from CATEGORY_OPTIONS ("x", "github", ...),
      // so the lower bound has to allow the single-character "x".
      category: Joi.string().trim().min(1).max(100).required().messages({
        "any.required": "category is required",
        "string.empty": "category cannot be empty",
        "string.max": "category must not exceed 100 characters"
      }),
      name: Joi.string().trim().min(2).max(150).required().messages({
        "any.required": "name is required",
        "string.empty": "name cannot be empty",
        "string.min": "name must be at least 2 characters",
        "string.max": "name must not exceed 150 characters"
      }),
      // Bounds mirror DESCRIPTION_MIN/DESCRIPTION_MAX on the builders/submit form.
      description: Joi.string().trim().min(50).max(300).required().messages({
        "any.required": "description is required",
        "string.empty": "description cannot be empty",
        "string.min": "description must be at least 50 characters",
        "string.max": "description must not exceed 300 characters"
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

export default {
  createShowCase
};

import Joi from "joi";

// Mirrors the upstream contract so bad input fails here, not as an opaque upstream 400.
const SKILL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SKILL_NAME_MESSAGE = "name must contain only letters, numbers, underscores, or hyphens (no spaces or special characters)";
const SKILL_NAME_MAX = 45;

const skillIdParams = Joi.object()
  .keys({
    skill_id: Joi.string().required().messages({
      "any.required": "skill_id is required"
    })
  })
  .unknown(true);

const getAllSkills = {
  // No validation needed
};

const getSkill = {
  params: skillIdParams
};

const createSkill = {
  // org_id and created_by are allowed through here and stripped in the service.
  body: Joi.object()
    .keys({
      name: Joi.string()
        .min(1)
        .max(SKILL_NAME_MAX)
        .pattern(SKILL_NAME_PATTERN)
        .required()
        .messages({
          "any.required": "name is required",
          "string.empty": "name cannot be empty",
          "string.max": `name must be at most ${SKILL_NAME_MAX} characters`,
          "string.pattern.base": SKILL_NAME_MESSAGE
        }),
      description: Joi.string().min(1).required().messages({
        "any.required": "description is required",
        "string.empty": "description cannot be empty"
      }),
      content: Joi.string().min(1).required().messages({
        "any.required": "content is required",
        "string.empty": "content cannot be empty"
      })
    })
    .unknown(true)
};

const updateSkill = {
  params: skillIdParams,
  body: Joi.object()
    .keys({
      name: Joi.string()
        .min(1)
        .max(SKILL_NAME_MAX)
        .pattern(SKILL_NAME_PATTERN)
        .optional()
        .messages({
          "string.empty": "name cannot be empty",
          "string.max": `name must be at most ${SKILL_NAME_MAX} characters`,
          "string.pattern.base": SKILL_NAME_MESSAGE
        }),
      description: Joi.string().min(1).optional().messages({
        "string.empty": "description cannot be empty"
      }),
      content: Joi.string().min(1).optional().messages({
        "string.empty": "content cannot be empty"
      })
    })
    .or("name", "description", "content")
    .unknown(true)
    .messages({
      "object.missing": "at least one of name, description or content is required"
    })
};

const deleteSkill = {
  params: skillIdParams
};

export default {
  getAllSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill
};

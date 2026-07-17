import Joi from "joi";

const createSkillSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
  description: Joi.string().trim().min(1).max(500).required(),
  content: Joi.string().min(1).required(),
  org_id: Joi.string().required(),
  created_by: Joi.string().required()
});

const updateSkillSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).optional(),
  description: Joi.string().trim().min(1).max(500).optional(),
  content: Joi.string().min(1).optional(),
  updated_by: Joi.string().optional()
});

const getSkillByIdSchema = Joi.object({
  id: Joi.string().required()
});

const getSkillsByOrgSchema = Joi.object({
  org_id: Joi.string().required()
});

const deleteSkillSchema = Joi.object({
  id: Joi.string().required()
});

export { createSkillSchema, updateSkillSchema, getSkillByIdSchema, getSkillsByOrgSchema, deleteSkillSchema };

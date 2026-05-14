import { createTemplate, getTemplates, updateTemplate, deleteTemplate } from "../db_services/richUiTemplate.service.js";
import { allowedUpdateFields } from "../validation/joi_validation/richUiTemplate.validation.js";
import { buildSchemaFromTemplateFormat, buildDefaultValues } from "../utils/templateVariables.utils.js";

// Create a new rich UI template
export const createRichUiTemplate = async (req, res, next) => {
  let { name, description, json_schema, template_format, is_public, default_json, default_values, ui, variables } = req.body;
  const {
    user: { id: user_id }
  } = req.profile;
  const org_id = req.profile.org.id;
  if (ui && !template_format) {
    template_format = ui;
  }
  const initialVariables = variables ?? default_json ?? default_values;
  let schema = json_schema;
  if (!schema && template_format) {
    schema = buildSchemaFromTemplateFormat(template_format, {}, initialVariables ?? {}, { name, description });
  }

  const result = await createTemplate(
    {
      name,
      description,
      json_schema: schema,
      template_format,
      variables: initialVariables,
      ui: ui || null,
      org_id,
      is_public: is_public ? is_public : false
    },
    user_id
  );

  res.locals = result;
  req.statusCode = 201;
  return next();
};

// Get all templates
export const getRichUiTemplates = async (req, res, next) => {
  const org_id = req.profile.org.id;

  res.locals = await getTemplates(org_id);
  req.statusCode = 200;
  return next();
};

export const updateRichUiTemplate = async (req, res, next) => {
  const { template_id } = req.params;
  const {
    user: { id: user_id }
  } = req.profile;
  const is_public = req.body.is_public ? req.body.is_public : false;

  const updateData = Object.fromEntries(Object.entries(req.body).filter(([key, value]) => allowedUpdateFields.includes(key) && value != null));

  if (updateData.template_format) {
    if (!updateData.json_schema) {
      updateData.json_schema = buildSchemaFromTemplateFormat(updateData.template_format, {}, updateData.variables ?? updateData.default_json ?? {}, {
        name: updateData.name,
        description: updateData.description
      });
    }
    if (!updateData.default_json && !updateData.default_values) {
      const regeneratedDefaults = buildDefaultValues(updateData.template_format);
      updateData.default_json = regeneratedDefaults;
      updateData.default_values = regeneratedDefaults;
    }
  }

  res.locals = await updateTemplate(template_id, updateData, user_id, is_public);
  req.statusCode = 200;
  return next();
};

export const deleteRichUiTemplate = async (req, res, next) => {
  const { template_id } = req.params;
  const {
    user: { id: user_id }
  } = req.profile;

  res.locals = await deleteTemplate(template_id, user_id);
  req.statusCode = 200;
  return next();
};

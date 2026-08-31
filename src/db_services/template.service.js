import templateModel from "../mongoModel/Template.model.js";

async function getAll() {
  return templateModel.find({ visible: true });
}

/**
 * Save bridge data as a template
 * @param {Object} bridgeData - Filtered bridge data to save as template
 * @param {String} templateName - Name for the template
 * @param {Object} [meta] - Marketing copy from the validator agent (headline, description, useCases)
 * @returns {Object} - Created template document
 */
async function saveTemplate(bridgeData, templateName, meta = null) {
  const templateData = {
    template: JSON.stringify(bridgeData),
    templateName: templateName,
    visible: true,
    ...(meta && { meta })
  };

  return await templateModel.create(templateData);
}

export default {
  getAll,
  saveTemplate
};

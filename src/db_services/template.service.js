import templateModel from "../mongoModel/Template.model.js";

async function getAll() {
  return templateModel.find();
}

/**
 * Save bridge data as a template
 * @param {Object} bridgeData - Filtered bridge data to save as template
 * @param {String} templateName - Name for the template
 * @returns {Object} - Created template document
 */
async function saveTemplate(bridgeData, templateName) {
  const templateData = {
    template: JSON.stringify(bridgeData),
    templateName: templateName,
    visible: true
  };

  return await templateModel.create(templateData);
}

export default {
  getAll,
  saveTemplate
};

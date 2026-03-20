import RichUiTemplate from "../mongoModel/RichUiTemplate.model.js";

// Create a new rich UI template
async function createTemplate(templateData, user_id) {
  try {
    const template = new RichUiTemplate({
      ...templateData,
      created_by: user_id,
      updated_by: user_id
    });

    const savedTemplate = await template.save();
    return {
      success: true,
      data: savedTemplate,
      message: "Rich UI template created successfully"
    };
  } catch (error) {
    throw new Error(`Failed to create template: ${error.message}`);
  }
}

// Get all templates
async function getTemplates(org_id) {
  try {
    const templates = await RichUiTemplate.find({
      $or: [{ is_public: true }, { org_id: org_id }]
    })
      .sort({ createdAt: -1 })
      .lean();

    return {
      success: true,
      data: templates,
      count: templates.length
    };
  } catch (error) {
    throw new Error(`Failed to fetch templates: ${error.message}`);
  }
}

// Update a template
async function updateTemplate(template_id, updateData, user_id, is_public) {
  try {
    const updatedTemplate = await RichUiTemplate.findOneAndUpdate(
      {
        _id: template_id
      },
      {
        ...updateData,
        updated_by: user_id,
        is_public: is_public,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    ).lean();

    if (!updatedTemplate) {
      throw new Error("Template not found");
    }

    return {
      success: true,
      data: updatedTemplate,
      message: "Template updated successfully"
    };
  } catch (error) {
    throw new Error(`Failed to update template: ${error.message}`);
  }
}

// Delete a template
async function deleteTemplate(template_id) {
  try {
    const deletedTemplate = await RichUiTemplate.findOneAndDelete({
      _id: template_id
    });

    if (!deletedTemplate) {
      throw new Error("Template not found");
    }

    return {
      success: true,
      message: "Template deleted successfully"
    };
  } catch (error) {
    throw new Error(`Failed to delete template: ${error.message}`);
  }
}

export { createTemplate, getTemplates, updateTemplate, deleteTemplate };

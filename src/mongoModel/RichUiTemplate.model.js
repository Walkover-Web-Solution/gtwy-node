import mongoose from "mongoose";

const richUiTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    json_schema: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    template_format: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    ui: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    variables: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    created_by: {
      type: String,
      required: true
    },
    updated_by: {
      type: String
    },
    org_id: {
      type: String,
      required: true
    },
    is_public: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

richUiTemplateSchema.index({ name: 1 });

const RichUiTemplate = mongoose.model("RichUiTemplate", richUiTemplateSchema, "rich_ui_templates");

export default RichUiTemplate;

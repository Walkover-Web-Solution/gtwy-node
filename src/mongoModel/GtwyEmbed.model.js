import mongoose from "mongoose";

const ConfigSchema = new mongoose.Schema(
  {
    hideHomeButton: { type: Boolean, default: false },
    showAgentTypeOnCreateAgent: { type: Boolean, default: false },
    showHistory: { type: Boolean, default: false },
    showConfigType: { type: Boolean, default: false },
    hideAdvancedParameters: { type: Boolean, default: false },
    hideCreateManuallyButton: { type: Boolean, default: false },
    hideAdvancedConfigurations: { type: Boolean, default: false },
    hidePreTool: { type: Boolean, default: false },
    slide: { type: String, default: "right" },
    defaultOpen: { type: Boolean, default: false },
    hideFullScreenButton: { type: Boolean, default: false },
    hideCloseButton: { type: Boolean, default: false },
    hideHeader: { type: Boolean, default: false },
    addDefaultApiKeys: { type: Boolean, default: false },
    showResponseType: { type: Boolean, default: false },
    showVariables: { type: Boolean, default: false },
    showAgentName: { type: Boolean, default: false },
    themeMode: { type: String, default: "light" },
    theme_config: { type: Object, default: {} },
    showGuide: { type: Boolean, default: false },
    configureGtwyRedirection: { type: String, default: "" },
    embed_id: { type: String, default: "" },
    tools_id: { type: [String], default: [] },
    variables_path: { type: Object, default: {} },
    pre_tool_id: { type: String, default: "" },
    prompt: { type: Object, default: {} },
    models: { type: Object, default: {} },
    hidePromptHelper: { type: Boolean, default: false }
  },
  { _id: false, strict: false }
);

const FolderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  org_id: {
    type: String,
    required: true
  },
  type: {
    type: String
  },
  config: {
    type: ConfigSchema,
    default: {}
  },
  apikey_object_id: {
    type: Object,
    default: {}
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  folder_limit: {
    type: Number,
    default: 0
  },
  folder_usage: {
    type: Number,
    default: 0
  },
  folder_limit_reset_period: {
    type: String,
    enum: ["monthly", "weekly", "daily"],
    default: "monthly"
  },
  folder_limit_start_date: {
    type: Date,
    default: Date.now
  }
});

const FolderModel = mongoose.model("Folder", FolderSchema);

export default FolderModel;

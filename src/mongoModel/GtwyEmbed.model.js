import mongoose from "mongoose";
import { cacheInvalidationPlugin } from "../cache_service/mongoosePlugin.js";
import { tag_keys } from "../configs/tagKeys.js";

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
    type: mongoose.Schema.Types.Mixed,
    default: "agent"
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
  deletedAt: {
    type: Date,
    default: null
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

FolderSchema.index({ org_id: 1, name: 1 }, { unique: true });
FolderSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 2592000 }); // TTL: 30 days

FolderSchema.pre("save", function (next) {
  if (this.type === "embed") {
    const defaults = {
      showHomeButton: true,
      showAgentTypeOnCreateAgent: false,
      showHistory: false,
      showConfigType: false,
      showAdvancedParameters: true,
      showCreateManuallyButton: true,
      showAdvancedConfigurations: true,
      showPreTool: true,
      slide: "right",
      defaultOpen: false,
      showFullScreenButton: true,
      showCloseButton: true,
      showHeader: true,
      addDefaultApiKeys: false,
      showResponseType: false,
      showVariables: false,
      showAgentName: false,
      themeMode: "light",
      theme_config: {},
      showGuide: false,
      configureGtwyRedirection: "",
      embed_id: "",
      tools_id: [],
      variables_path: {},
      pre_tool_id: "",
      prompt: {},
      models: {},
      showPromptHelper: true,
      showReviewAgent: false
    };
    this.config = { ...defaults, ...(this.config || {}) };
  }
  next();
});

FolderSchema.plugin(cacheInvalidationPlugin, { tags: [tag_keys.folder] });

const FolderModel = mongoose.model("Folder", FolderSchema);

export default FolderModel;

import mongoose from "mongoose";

const prebuiltPromptSchema = new mongoose.Schema(
  {
    org_id: {
      type: String,
      required: true
    },
    prebuilt_prompts: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { strict: false }
);

const PrebuiltPrompt = mongoose.model("preBuiltPrompts", prebuiltPromptSchema);

export default PrebuiltPrompt;

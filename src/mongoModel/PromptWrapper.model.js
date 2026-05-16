import mongoose from "mongoose";
import { cacheInvalidationPlugin } from "../cache_service/mongoosePlugin.js";
import { tag_keys } from "../configs/tagKeys.js";

const promptWrapperSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    template: {
      type: String,
      required: true
    },
    variables: {
      type: [String],
      default: []
    },
    org_id: {
      type: String,
      required: true
    },
    created_by: {
      type: String,
      required: true
    }
  },
  { timestamps: true }
);

promptWrapperSchema.plugin(cacheInvalidationPlugin, { tags: [tag_keys.wrapper] });

const PromptWrapperModel = mongoose.model("prompt_wrappers", promptWrapperSchema);

export default PromptWrapperModel;

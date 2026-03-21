import mongoose from "mongoose";
import { baseAgentFields } from "./schemas/shared.js";

const version = new mongoose.Schema(
  {
    ...baseAgentFields,
    // BridgeVersion-specific fields
    version_description: { type: String, default: "" },
    parent_id: { type: String, required: true }
  },
  {
    timestamps: true
  }
);

version.index({ deletedAt: 1 }, { expireAfterSeconds: 2592000 });
const versionModel = mongoose.model("configuration_versions", version);
export default versionModel;

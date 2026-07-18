import mongoose from "mongoose";
const BlockedOrgSchema = new mongoose.Schema(
  {
    org_id: { type: String, required: true, unique: true, index: true },
    reason: { type: String, default: null },
    blocked_by: { type: String, default: null }
  },
  { timestamps: true, strict: true }
);

const BlockedOrgModel = mongoose.model("BlockedOrg", BlockedOrgSchema, "blocked_orgs");
export default BlockedOrgModel;

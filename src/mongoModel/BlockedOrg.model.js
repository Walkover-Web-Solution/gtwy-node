import mongoose from "mongoose";
// One collection for both blocks: user_id null blocks the whole org, a user_id
// blocks just that user inside the org.
const BlockedOrgSchema = new mongoose.Schema(
  {
    org_id: { type: String, required: true, index: true },
    user_id: { type: String, default: null },
    reason: { type: String, default: null },
    blocked_by: { type: String, default: null }
  },
  { timestamps: true, strict: true }
);

BlockedOrgSchema.index({ org_id: 1, user_id: 1 }, { unique: true });

const BlockedOrgModel = mongoose.model("BlockedOrg", BlockedOrgSchema, "blocked_orgs");
export default BlockedOrgModel;

import BlockedOrgModel from "../mongoModel/BlockedOrg.model.js";

// Org-level rows have no user_id; `user_id: null` also matches rows written
// before the field existed.
const block = async ({ org_id, reason = null, blocked_by = null }) => {
  return await BlockedOrgModel.findOneAndUpdate(
    { org_id, user_id: null },
    { $set: { org_id, user_id: null, reason, blocked_by } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const unblock = async (org_id) => {
  return await BlockedOrgModel.findOneAndDelete({ org_id, user_id: null });
};

const getAll = async () => {
  return await BlockedOrgModel.find({ user_id: null }).lean();
};

const isBlocked = async (org_id) => {
  return !!(await BlockedOrgModel.exists({ org_id, user_id: null }));
};

const blockUser = async ({ org_id, user_id, reason = null, blocked_by = null }) => {
  return await BlockedOrgModel.findOneAndUpdate(
    { org_id, user_id },
    { $set: { org_id, user_id, reason, blocked_by } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const unblockUser = async (org_id, user_id) => {
  return await BlockedOrgModel.findOneAndDelete({ org_id, user_id });
};

const getAllUsers = async (org_id) => {
  return await BlockedOrgModel.find({ user_id: { $ne: null }, ...(org_id ? { org_id } : {}) }).lean();
};

export default { block, unblock, getAll, isBlocked, blockUser, unblockUser, getAllUsers };

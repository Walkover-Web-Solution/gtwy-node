import BlockedOrgModel from "../mongoModel/BlockedOrg.model.js";

const block = async ({ org_id, reason = null, blocked_by = null }) => {
  return await BlockedOrgModel.findOneAndUpdate(
    { org_id },
    { $set: { org_id, reason, blocked_by } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const unblock = async (org_id) => {
  return await BlockedOrgModel.findOneAndDelete({ org_id });
};

const getAll = async () => {
  return await BlockedOrgModel.find({}).lean();
};

const isBlocked = async (org_id) => {
  return !!(await BlockedOrgModel.exists({ org_id }));
};

export default { block, unblock, getAll, isBlocked };

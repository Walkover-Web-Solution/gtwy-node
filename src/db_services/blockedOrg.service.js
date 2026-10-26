import { StatusCodes } from "http-status-codes";
import BlockedOrgModel from "../mongoModel/BlockedOrg.model.js";
import { getOrgUser } from "../services/proxy.service.js";
import ApiError from "../utils/ApiError.js";

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

// MSG91 looks the user up inside this company only, so a user who is in
// several orgs is matched (and blocked) for this org alone. Only embed users
// can be blocked: they are created with meta.type "embed" (and guest status "2").
const verifyOrgUser = async (user_id, org_id) => {
  let orgUser = null;
  try {
    orgUser = await getOrgUser(user_id, org_id);
  } catch (err) {
    throw new ApiError(StatusCodes.BAD_GATEWAY, `Could not verify the user's organization: ${err?.message}`);
  }
  if (!orgUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User does not belong to this organization");
  }
  if (orgUser.meta?.type !== "embed") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only embed users can be blocked");
  }
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

export default { block, unblock, getAll, isBlocked, verifyOrgUser, blockUser, unblockUser, getAllUsers };

import InternalOrgModel from "../mongoModel/InternalOrg.model.js";

// All Mongo access for internal_orgs lives here.

const list = async () => InternalOrgModel.find({}).sort({ name: 1, org_id: 1 }).lean();

const getByOrg = async (org_id) => InternalOrgModel.findOne({ org_id: String(org_id) }).lean();

// Insert-only: re-adding an org that is already listed leaves its row alone.
const add = async (org_id, { name = null, added_by = null } = {}) =>
  InternalOrgModel.findOneAndUpdate(
    { org_id: String(org_id) },
    { $setOnInsert: { org_id: String(org_id), name, added_by } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

// Returns true when a row was removed.
const remove = async (org_id) => (await InternalOrgModel.deleteOne({ org_id: String(org_id) })).deletedCount > 0;

export default { list, getByOrg, add, remove };

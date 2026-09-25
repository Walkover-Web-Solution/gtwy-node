import mongoose from "mongoose";

// Orgs we run ourselves (Viasocket, Msg91, ...), managed from the internal
// credits dashboard. Membership is what lets that dashboard grant credits to an
// org: the credits endpoint refuses any org that is not listed here, so it can
// never be used to top up an arbitrary customer. Being listed changes nothing
// else — plan, wallet and billing behave exactly as for any other org.
const InternalOrgSchema = new mongoose.Schema(
  {
    org_id: { type: String, required: true, unique: true, index: true },
    // MSG91 company name, captured when the org is added.
    name: { type: String, default: null },
    // Email of the internal user who added it.
    added_by: { type: String, default: null }
  },
  { timestamps: true, collection: "internal_orgs" }
);

const InternalOrgModel = mongoose.model("InternalOrg", InternalOrgSchema);

export default InternalOrgModel;

import mongoose from "mongoose";

// Per-user credit CAP inside an embed folder. Money stays in the single org
// wallet — this is only a spending limit the org admin sets per end user.
// Enforced by Python at the request gate; the live counter lives in Redis
// (nd_userusedcost_{folder_id}_{sanitized user_id}); user_usage here is only
// the seed value when the counter key is empty. Collection name is explicit —
// Python reads db["user_credit_limits"] directly.
const UserCreditLimitSchema = new mongoose.Schema(
  {
    org_id: {
      type: String,
      required: true
    },
    folder_id: {
      type: String,
      required: true
    },
    user_id: {
      type: String,
      required: true
    },
    user_limit: {
      type: Number,
      required: true,
      min: 0
    },
    user_limit_reset_period: {
      type: String,
      enum: ["monthly", "weekly", "daily"],
      default: "monthly"
    },
    user_limit_start_date: {
      type: Date,
      default: Date.now
    },
    user_usage: {
      type: Number,
      default: 0
    }
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, collection: "user_credit_limits" }
);

UserCreditLimitSchema.index({ org_id: 1, folder_id: 1, user_id: 1 }, { unique: true });

const UserCreditLimitModel = mongoose.model("UserCreditLimit", UserCreditLimitSchema);

export default UserCreditLimitModel;

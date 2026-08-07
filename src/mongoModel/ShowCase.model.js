import mongoose from "mongoose";

export const SHOWCASE_STATUS = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2
};

const showCaseSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    link: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: Number,
      enum: Object.values(SHOWCASE_STATUS),
      default: SHOWCASE_STATUS.PENDING
    }
  },
  { timestamps: true }
);

showCaseSchema.index({ status: 1, createdAt: -1 });

const showCaseModel = mongoose.model("showCaseModel", showCaseSchema);

export default showCaseModel;

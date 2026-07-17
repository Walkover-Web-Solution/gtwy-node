import mongoose from "mongoose";

const skillSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    content: {
      type: String,
      required: true
    },
    org_id: {
      type: String,
      required: true,
      index: true
    },
    created_by: {
      type: String,
      required: true
    },
    updated_by: {
      type: String
    },
    deletedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Index for efficient queries by org_id
skillSchema.index({ org_id: 1, deletedAt: 1 });

const Skill = mongoose.model("Skill", skillSchema);

export default Skill;

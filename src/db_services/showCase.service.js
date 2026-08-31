import showCaseModel from "../mongoModel/ShowCase.model.js";
import { SHOWCASE_STATUS } from "../utils/showCase.utils.js";

async function createShowCase({ category, name, description, link }) {
  const showCase = await showCaseModel.create({
    category,
    name,
    description,
    link,
    status: SHOWCASE_STATUS.PENDING
  });
  return showCase.toObject();
}

// Not exported on purpose — callers go through getApprovedShowCases so that
// pending and rejected entries can never reach a response by accident.
async function getShowCasesByStatus(status, page, limit) {
  const skip = (page - 1) * limit;

  // Counted against the same filter as the page, so `totalPages` can never
  // disagree with what the caller actually receives.
  const [showCases, total] = await Promise.all([
    showCaseModel.find({ status }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    showCaseModel.countDocuments({ status })
  ]);

  return {
    data: showCases,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}

async function getApprovedShowCases(page = 1, limit = 30) {
  return getShowCasesByStatus(SHOWCASE_STATUS.APPROVED, page, limit);
}

export default {
  createShowCase,
  getApprovedShowCases
};

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
async function getShowCasesByStatus(status) {
  return showCaseModel.find({ status }).sort({ createdAt: -1 }).lean();
}

async function getApprovedShowCases() {
  return getShowCasesByStatus(SHOWCASE_STATUS.APPROVED);
}

export default {
  createShowCase,
  getApprovedShowCases
};

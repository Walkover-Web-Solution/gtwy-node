import showCaseModel, { SHOWCASE_STATUS } from "../mongoModel/ShowCase.model.js";

const formatShowCase = (showCase) => ({
  ...showCase,
  _id: showCase._id.toString()
});

async function createShowCase({ category, name, description, link }) {
  const showCase = await showCaseModel.create({
    category,
    name,
    description,
    link,
    status: SHOWCASE_STATUS.PENDING
  });
  return formatShowCase(showCase.toObject());
}

async function getShowCasesByStatus(status) {
  const showCases = await showCaseModel.find({ status }).sort({ createdAt: -1 }).lean();
  return showCases.map(formatShowCase);
}

async function getApprovedShowCases() {
  return getShowCasesByStatus(SHOWCASE_STATUS.APPROVED);
}

export default {
  createShowCase,
  getShowCasesByStatus,
  getApprovedShowCases
};

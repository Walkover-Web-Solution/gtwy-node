import { StatusCodes } from "http-status-codes";
import showCaseDbService from "../db_services/showCase.service.js";

const addShowCase = async (req, res, next) => {
  const { category, name, description, link } = req.body;

  const showCase = await showCaseDbService.createShowCase({ category, name, description, link });

  res.locals = {
    success: true,
    message: "Showcase submitted successfully and is pending approval",
    data: showCase
  };
  req.statusCode = StatusCodes.CREATED;
  return next();
};

const getShowCases = async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 30;

  const { data, total, totalPages } = await showCaseDbService.getApprovedShowCases(page, limit);

  res.locals = {
    success: true,
    message: "Showcases retrieved successfully",
    data,
    total,
    page,
    limit,
    totalPages
  };
  req.statusCode = StatusCodes.OK;
  return next();
};

export default {
  addShowCase,
  getShowCases
};

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
  const showCases = await showCaseDbService.getApprovedShowCases();

  res.locals = {
    success: true,
    message: "Showcases retrieved successfully",
    data: showCases
  };
  req.statusCode = StatusCodes.OK;
  return next();
};

export default {
  addShowCase,
  getShowCases
};

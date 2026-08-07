import { StatusCodes } from "http-status-codes";
import showCaseDbService from "../db_services/showCase.service.js";
import ApiError from "../utils/ApiError.js";

const addShowCase = async (req, res, next) => {
  const { category, name, description, link } = req.body;

  try {
    const showCase = await showCaseDbService.createShowCase({ category, name, description, link });

    res.locals = {
      success: true,
      message: "Showcase submitted successfully and is pending approval",
      data: showCase
    };
    req.statusCode = StatusCodes.CREATED;
    return next();
  } catch (error) {
    if (error?.code === 11000) {
      return next(new ApiError(StatusCodes.CONFLICT, "A showcase with this name already exists"));
    }
    if (error?.name === "ValidationError") {
      return next(new ApiError(StatusCodes.UNPROCESSABLE_ENTITY, error.message));
    }
    console.error("addShowCase error =>", error);
    return next(new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to submit showcase, try again later"));
  }
};

const getShowCases = async (req, res, next) => {
  try {
    const showCases = await showCaseDbService.getApprovedShowCases();

    res.locals = {
      success: true,
      message: "Showcases retrieved successfully",
      data: showCases
    };
    req.statusCode = StatusCodes.OK;
    return next();
  } catch (error) {
    console.error("getShowCases error =>", error);
    return next(new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to fetch showcases, try again later"));
  }
};

export default {
  addShowCase,
  getShowCases
};

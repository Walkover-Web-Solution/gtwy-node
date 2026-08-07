import express from "express";
import showCaseController from "../controllers/showCase.controller.js";
import validate from "../middlewares/validate.middleware.js";
import showCaseValidation from "../validation/joi_validation/showCase.validation.js";

const router = express.Router();

router.post("/", validate(showCaseValidation.createShowCase), showCaseController.addShowCase);
router.get("/", validate(showCaseValidation.getShowCases), showCaseController.getShowCases);
router.get("/all", validate(showCaseValidation.getShowCases), showCaseController.getShowCases);

export default router;

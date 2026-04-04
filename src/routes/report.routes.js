import express from "express";
import { getMonthlyreports, getMessageData } from "../controllers/report.controller.js";
import validate from "../middlewares/validate.middleware.js";
import reportValidation from "../validation/joi_validation/report.validation.js";

let router = express.Router();

router.post("/monthly", validate(reportValidation.getWeeklyreports), getMonthlyreports);

router.post("/message-data", validate(reportValidation.getMessageData), getMessageData);

export default router;

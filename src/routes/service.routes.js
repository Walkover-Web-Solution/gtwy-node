import express from "express";
import serviceController from "../controllers/service.controller.js";
import { combinedAllAuth } from "../middlewares/interfaceMiddlewares.js";

const router = express.Router();

router.get("/", combinedAllAuth, serviceController.getAllServiceController);
router.get("/:service", combinedAllAuth, serviceController.getAllServiceModelsController);

export default router;

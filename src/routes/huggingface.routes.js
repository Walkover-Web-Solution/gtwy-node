import express from "express";
import { middleware } from "../middlewares/middleware.js";
import huggingfaceController from "../controllers/huggingface.controller.js";

const router = express.Router();

router.get("/models/search", middleware, huggingfaceController.searchHuggingFaceModels);
router.get("/models/providers", middleware, huggingfaceController.getHuggingFaceModelProviders);

export default router;

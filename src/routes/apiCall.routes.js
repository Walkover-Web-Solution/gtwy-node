import express from "express";
import { middleware, checkAgentAccessMiddleware } from "../middlewares/middleware.js";
import controller from "../controllers/apiCall.controller.js";
import validate from "../middlewares/validate.middleware.js";
import apiCallValidation from "../validation/joi_validation/apiCall.validation.js";

const router = express.Router();

router.get("/agents-versions-by-functions", middleware, controller.getAgentsAndVersionsByFunctionIds);
router.get("/", middleware, controller.getAllApiCalls);
router.put("/:function_id", middleware, checkAgentAccessMiddleware, validate(apiCallValidation.updateApiCalls), controller.updateApiCalls);
router.delete("/", middleware, checkAgentAccessMiddleware, validate(apiCallValidation.deleteFunction), controller.deleteFunction);
router.post("/", middleware, checkAgentAccessMiddleware, validate(apiCallValidation.createApi), controller.createApi);
router.put("/pre_tool/:agent_id", middleware, checkAgentAccessMiddleware, validate(apiCallValidation.addPreTool), controller.addPreTool);
router.get("/inbuilt", middleware, controller.getAllInBuiltToolsController);

export default router;

import express from "express";
import { middleware, checkAgentAccessMiddleware } from "../middlewares/middleware.js";
import embedController from "../controllers/embed.controller.js";
import { GtwyEmbeddecodeToken } from "../middlewares/gtwyEmbedMiddleware.js";
import validate from "../middlewares/validate.middleware.js";
import embedValidation from "../validation/joi_validation/embed.validation.js";
import { deleteAgentController } from "../controllers/agentConfig.controller.js";

const router = express.Router();

router.post("/login", GtwyEmbeddecodeToken, embedController.embedLogin);
router.post("/", middleware, checkAgentAccessMiddleware, validate(embedValidation.createEmbed), embedController.createEmbed);
router.get("/", middleware, embedController.getAllEmbed);
router.put("/", middleware, checkAgentAccessMiddleware, validate(embedValidation.updateEmbed), embedController.updateEmbed);
router.get("/getAgents", GtwyEmbeddecodeToken, validate(embedValidation.getEmbedDataByUserId), embedController.getEmbedDataByUserId);

router.put("/:agent_id", GtwyEmbeddecodeToken, validate(embedValidation.updateAgentMetadata), embedController.updateAgentMetadataController);

router.delete("/:agent_id", GtwyEmbeddecodeToken, validate(embedValidation.getEmbedDataByUserId), deleteAgentController);

export default router;

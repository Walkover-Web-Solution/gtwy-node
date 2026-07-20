import express from "express";
import { middleware } from "../middlewares/middleware.js";
import * as controller from "../controllers/skill.controller.js";
import validate from "../middlewares/validate.middleware.js";
import * as skillValidation from "../validation/joi_validation/skill.validation.js";

const router = express.Router();

router.post("/", middleware, validate(skillValidation.createSkillSchema), controller.createSkill);
router.get("/", middleware, validate(skillValidation.getSkillsByOrgSchema, "query"), controller.getSkillsByOrg);
router.get("/:id", middleware, controller.getSkillById);
router.put("/:id", middleware, validate(skillValidation.updateSkillSchema), controller.updateSkill);
router.delete("/:id", middleware, controller.deleteSkill);

export default router;

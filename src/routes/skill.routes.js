import express from "express";
import { middleware } from "../middlewares/middleware.js";
import controller from "../controllers/skill.controller.js";
import validate from "../middlewares/validate.middleware.js";
import skillValidation from "../validation/joi_validation/skill.validation.js";

const router = express.Router();

router.get("/", middleware, controller.getAllSkills);
router.post("/", middleware, validate(skillValidation.createSkill), controller.createSkill);
router.get("/:skill_id", middleware, validate(skillValidation.getSkill), controller.getSkill);
router.put("/:skill_id", middleware, validate(skillValidation.updateSkill), controller.updateSkill);
router.delete("/:skill_id", middleware, validate(skillValidation.deleteSkill), controller.deleteSkill);

export default router;

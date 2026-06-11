import express from "express";
import { middleware } from "../middlewares/middleware.js";
import folderController from "../controllers/folder.controller.js";
import validate from "../middlewares/validate.middleware.js";
import folderValidation from "../validation/joi_validation/folder.validation.js";

const router = express.Router();

router.post("/", middleware, validate(folderValidation.createFolder), folderController.createFolderController);
router.get("/", middleware, folderController.getAllFoldersController);
router.put("/", middleware, validate(folderValidation.updateFolder), folderController.updateFolderController);
router.delete("/:folder_id", middleware, validate(folderValidation.deleteFolder), folderController.deleteFolderController);

export default router;

import express from "express";
import { middleware, blockEmbedUsers } from "../middlewares/middleware.js";
import folderController from "../controllers/folder.controller.js";
import validate from "../middlewares/validate.middleware.js";
import folderValidation from "../validation/joi_validation/folder.validation.js";

const router = express.Router();

router.post("/", middleware, blockEmbedUsers, validate(folderValidation.createFolder), folderController.createFolderController);
router.get("/", middleware, blockEmbedUsers, folderController.getAllFoldersController);
router.put("/", middleware, blockEmbedUsers, validate(folderValidation.updateFolder), folderController.updateFolderController);
router.delete("/:folder_id", middleware, blockEmbedUsers, validate(folderValidation.deleteFolder), folderController.deleteFolderController);

export default router;

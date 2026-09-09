import express from "express";
import serviceController from "../controllers/service.controller.js";
import { combinedAllAuth } from "../middlewares/interfaceMiddlewares.js";
import { InternalAuth, middleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import serviceValidation from "../validation/joi_validation/service.validation.js";
import { yoga } from "../graphql/yoga.js";

const router = express.Router();

router.get("/", combinedAllAuth, serviceController.getAllServiceController);

router.use("/graphql", combinedAllAuth, yoga);
router.get("/:service", combinedAllAuth, serviceController.getAllServiceModelsController);
router.post("/", middleware, InternalAuth, validate(serviceValidation.createService), serviceController.addServiceController);

export default router;

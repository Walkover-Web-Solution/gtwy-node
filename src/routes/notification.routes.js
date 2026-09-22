import express from "express";
import { middleware, InternalAuth } from "../middlewares/middleware.js";
import notificationController from "../controllers/notification.controller.js";
import validate from "../middlewares/validate.middleware.js";
import notificationValidation from "../validation/joi_validation/notification.validation.js";

const router = express.Router();

router.post("/", middleware, validate(notificationValidation.createNotification), notificationController.createNotification);
router.post(
  "/broadcast",
  middleware,
  InternalAuth,
  validate(notificationValidation.broadcastNotification),
  notificationController.broadcastNotification
);
router.get("/", middleware, validate(notificationValidation.getNotifications), notificationController.getNotifications);
router.patch("/:id/read", middleware, validate(notificationValidation.markAsRead), notificationController.markAsRead);
router.patch("/read-all", middleware, validate(notificationValidation.markAllAsRead), notificationController.markAllAsRead);

export default router;

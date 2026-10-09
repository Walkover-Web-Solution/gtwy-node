import express from "express";
import { middleware, InternalAuth } from "../middlewares/middleware.js";
import notificationController from "../controllers/notification.controller.js";
import validate from "../middlewares/validate.middleware.js";
import notificationValidation from "../validation/joi_validation/notification.validation.js";

const router = express.Router();

// Creating notifications by hand changes what everyone in the org sees: Admins only.
const orgAdminOnly = (req, res, next) =>
  req.role_name === "admin" ? next() : res.status(403).json({ success: false, message: "Only org admins can manage notifications" });

// Inbox
router.get("/", middleware, validate(notificationValidation.getNotifications), notificationController.getNotifications);
router.get("/catalogue", middleware, notificationController.getCatalogue);
router.patch("/read-all", middleware, validate(notificationValidation.markAllAsRead), notificationController.markAllAsRead);
router.patch("/:id/read", middleware, validate(notificationValidation.markAsRead), notificationController.markAsRead);

// Producing notifications
router.post("/", middleware, orgAdminOnly, validate(notificationValidation.createNotification), notificationController.createNotification);
router.post(
  "/broadcast",
  middleware,
  InternalAuth,
  validate(notificationValidation.broadcastNotification),
  notificationController.broadcastNotification
);
router.post("/events", middleware, InternalAuth, validate(notificationValidation.publishEvent), notificationController.publishEvent);

export default router;

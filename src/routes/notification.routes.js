import express from "express";
import { middleware, InternalAuth } from "../middlewares/middleware.js";
import notificationController from "../controllers/notification.controller.js";
import notificationSettingsController from "../controllers/notificationSettings.controller.js";
import validate from "../middlewares/validate.middleware.js";
import notificationValidation from "../validation/joi_validation/notification.validation.js";

const router = express.Router();

// Rules, channels and manual sends change what an org receives: Admins only.
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

// Channels
router.get("/channels", middleware, orgAdminOnly, notificationSettingsController.listChannels);
router.post("/channels", middleware, orgAdminOnly, validate(notificationValidation.createChannel), notificationSettingsController.createChannel);
router.put("/channels/:id", middleware, orgAdminOnly, validate(notificationValidation.updateChannel), notificationSettingsController.updateChannel);
router.delete("/channels/:id", middleware, orgAdminOnly, validate(notificationValidation.idParam), notificationSettingsController.deleteChannel);
router.post("/channels/:id/test", middleware, orgAdminOnly, validate(notificationValidation.idParam), notificationSettingsController.testChannel);

// Rules
router.get("/rules", middleware, orgAdminOnly, notificationSettingsController.listRules);
router.post("/rules", middleware, orgAdminOnly, validate(notificationValidation.createRule), notificationSettingsController.createRule);
router.put("/rules/:id", middleware, orgAdminOnly, validate(notificationValidation.updateRule), notificationSettingsController.updateRule);
router.delete("/rules/:id", middleware, orgAdminOnly, validate(notificationValidation.idParam), notificationSettingsController.deleteRule);

// Delivery log
router.get("/deliveries", middleware, orgAdminOnly, validate(notificationValidation.listDeliveries), notificationSettingsController.listDeliveries);
router.post(
  "/deliveries/:id/retry",
  middleware,
  orgAdminOnly,
  validate(notificationValidation.idParam),
  notificationSettingsController.retryDelivery
);

// Shadow-mode cutover gate (GTWY team)
router.get("/shadow/parity", middleware, InternalAuth, validate(notificationValidation.shadowParity), notificationSettingsController.getShadowParity);

export default router;

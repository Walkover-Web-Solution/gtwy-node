import express from "express";
import { middleware, blockEmbedUsers } from "../middlewares/middleware.js";

const router = express.Router();

// Define routes  use in the viasocket plug auth verify
router.get("/info", middleware, blockEmbedUsers, (req, res) => {
  res.send({
    success: true,
    message: "Sucessfully authenticated",
    org_id: req.profile?.org?.id,
    organization_name: req.profile?.org?.name,
    user_id: req.profile?.user?.id || "",
    user_name: req.profile?.user?.name || "",
    user_email: req.profile?.user?.email || "",
    user_role: req.profile?.user?.role || ""
  });
});

export default router;

import express from "express";
import { userOrgLocalToken, switchUserOrgLocal, updateUserDetails, removeUsersFromOrg, logout } from "../controllers/userOrgLocal.controller.js";
import { middleware, loginAuth } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import {
  switchUserOrgLocalBodySchema,
  updateUserDetailsBodySchema,
  removeUsersFromOrgBodySchema
} from "../validation/joi_validation/userOrgLocal.validation.js";

const routes = express.Router();

routes.route("/localToken").post(loginAuth, userOrgLocalToken);
routes.route("/switchOrg").post(middleware, validate({ body: switchUserOrgLocalBodySchema }), switchUserOrgLocal);
routes.route("/updateDetails").put(middleware, validate({ body: updateUserDetailsBodySchema }), updateUserDetails);
routes.route("/deleteUser").delete(middleware, validate({ body: removeUsersFromOrgBodySchema }), removeUsersFromOrg);
routes.route("/logout").post(middleware, logout);

export default routes;

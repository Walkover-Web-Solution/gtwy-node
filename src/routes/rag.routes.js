import express from "express";
import {
  getEmbedToken,
  ragEmbedUserLogin,
  searchKnowledge,
  createCollection,
  getAllCollections,
  getCollectionById,
  createResourceInCollection,
  updateResourceInCollection,
  deleteResourceFromCollection,
  getResourceChunks,
  getAllResourcesByCollectionId,
  getOrCreateDefaultCollections,
  getResourcesByCollectionAndOwner,
  deleteResourcesByCollectionAndOwner
} from "../controllers/rag.controller.js";
import { EmbeddecodeToken, middleware, checkAgentAccessMiddleware } from "../middlewares/middleware.js";
import validate from "../middlewares/validate.middleware.js";
import {
  searchSchema,
  createCollectionSchema,
  collectionIdSchema,
  createResourceSchema,
  resourceIdSchema,
  updateResourceSchema,
  getResourcesByCollectionQuerySchema,
  deleteResourcesByCollectionQuerySchema
} from "../validation/joi_validation/rag.validation.js";

const routes = express.Router();

routes.route("/embed/login").get(EmbeddecodeToken, ragEmbedUserLogin);
routes.get("/get-emebed-token", middleware, getEmbedToken);
routes.post("/chatbot/search", middleware, validate({ body: searchSchema }), searchKnowledge);

// Collection routes
routes.post("/collection", middleware, checkAgentAccessMiddleware, validate({ body: createCollectionSchema }), createCollection);
routes.get("/collections", middleware, getAllCollections);
routes.get("/collection/:collectionId", middleware, validate({ params: collectionIdSchema }), getCollectionById);
routes.get("/collection/:collectionId/resources", middleware, validate({ params: collectionIdSchema }), getAllResourcesByCollectionId);
routes.delete("/collection/:id/resources", middleware, checkAgentAccessMiddleware, validate({ query: deleteResourcesByCollectionQuerySchema }), deleteResourcesByCollectionAndOwner);

// Resource routes
routes.get("/resource", middleware, getOrCreateDefaultCollections);
// Public API
routes.get("/resource/by-collection", middleware, validate({ query: getResourcesByCollectionQuerySchema }), getResourcesByCollectionAndOwner);
routes.post("/resource", middleware, checkAgentAccessMiddleware, validate({ body: createResourceSchema }), createResourceInCollection);
routes.put(
  "/resource/:id",
  middleware,
  checkAgentAccessMiddleware,
  validate({ params: resourceIdSchema, body: updateResourceSchema }),
  updateResourceInCollection
);
routes.delete("/resource/:id", middleware, checkAgentAccessMiddleware, validate({ params: resourceIdSchema }), deleteResourceFromCollection);
routes.get("/resource/:id/chunks", middleware, checkAgentAccessMiddleware, validate({ params: resourceIdSchema }), getResourceChunks);

export default routes;

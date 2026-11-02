import { createYoga } from "graphql-yoga";
import { schema } from "./schema.js";
import folderDbService from "../db_services/folder.service.js";

export const yoga = createYoga({
  schema,
  graphqlEndpoint: "/api/service/graphql",
  graphiql: false,
  // Embed tokens carry a folder_id; resolvers use its model overrides to skip hidden models.
  context: async ({ req }) => ({
    folderModels: await folderDbService.getFolderModels(req?.folder_id || req?.Embed?.folder_id)
  })
});

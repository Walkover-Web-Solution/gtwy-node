import { createYoga } from "graphql-yoga";
import { schema } from "./schema.js";

export const yoga = createYoga({
  schema,
  graphqlEndpoint: "/api/service/graphql",
  graphiql: false
});

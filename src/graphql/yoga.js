import { createYoga } from "graphql-yoga";
import { schema } from "./schema.js";

// graphiql enabled outside production only
export const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  graphiql: process.env.NODE_ENV !== "production"
});

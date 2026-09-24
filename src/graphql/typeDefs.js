// GraphQL schema for GetModels, coexists with REST /api/service.

export const typeDefs = /* GraphQL */ `
  scalar JSON

  enum ModelType {
    chat
    fine_tune
    reasoning
    image
    embedding
  }

  type ModelConfiguration {
    model: JSON
    additional_parameters: JSON
  }

  type ServiceModel {
    name: String!
    type: ModelType!
    configuration: ModelConfiguration
    validationConfig: JSON
    outputConfig: JSON
    org_id: String
  }

  type Service {
    name: String!
    modelNames(types: [ModelType!]): [String!]!
    models(types: [ModelType!]): [ServiceModel!]!
  }

  type Query {
    # omit "names" for every service
    services(names: [String!]): [Service!]!
    model(service: String!, name: String!): ServiceModel
  }
`;

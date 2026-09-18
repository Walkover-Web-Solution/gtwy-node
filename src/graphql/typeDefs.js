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

  enum CostComparison {
    lower
    same
    approx_same
  }

  type AlternateOf {
    service: String!
    model_name: String!
    cost_comparison: CostComparison!
    reason: String!
  }

  type ServiceModel {
    name: String!
    type: ModelType!
    configuration: ModelConfiguration
    validationConfig: JSON
    outputConfig: JSON
    org_id: String
    # models this one is a good substitute for
    alternate_of: [AlternateOf!]!
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

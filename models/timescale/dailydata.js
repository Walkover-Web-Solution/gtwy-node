// eslint-disable-next-line no-unused-vars
import { Model, DataTypes, UUIDV4, fn } from "sequelize";
export default (sequelize, DataTypes) => {
  class daily_data extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    // eslint-disable-next-line no-unused-vars
    static associate(models) {
      // define association here
    }
  }
  daily_data.init(
    {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      org_id: DataTypes.STRING,
      bridge_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      version_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      thread_id: DataTypes.STRING,
      model: DataTypes.STRING,
      service: DataTypes.STRING,
      input_tokens: DataTypes.FLOAT,
      output_tokens: DataTypes.FLOAT,
      total_token_count: DataTypes.FLOAT,
      apikey_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: fn("now")
      },
      latency_sum: DataTypes.FLOAT,
      llm_latency_sum: DataTypes.FLOAT,
      tool_call_latency_sum: DataTypes.FLOAT,
      system_latency_sum: DataTypes.FLOAT,
      success_count: DataTypes.FLOAT,
      record_count: DataTypes.FLOAT,
      cost_sum: DataTypes.FLOAT
    },
    {
      sequelize,
      modelName: "daily_data",
      timestamps: false
    }
  );
  return daily_data;
};

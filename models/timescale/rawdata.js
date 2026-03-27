import { Model, fn } from "sequelize";
export default (sequelize, DataTypes) => {
  class raw_data extends Model {
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
  raw_data.init(
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
      total_tokens: DataTypes.FLOAT,
      apikey_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: fn("now")
      },
      latency: DataTypes.FLOAT,
      success: DataTypes.BOOLEAN,
      cost: DataTypes.FLOAT,
      time_zone: {
        type: DataTypes.STRING,
        allowNull: true
      }
    },
    {
      sequelize,
      modelName: "raw_data",
      tableName: "metrics_raw_data",
      timestamps: false
    }
  );
  return raw_data;
};

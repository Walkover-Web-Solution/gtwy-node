import { Model } from "sequelize";
export default (sequelize, DataTypes) => {
  class user_bridge_config_history extends Model {
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
  user_bridge_config_history.init(
    {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      user_id: {
        allowNull: false,
        type: DataTypes.INTEGER
      },
      time: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      },
      type: {
        allowNull: false,
        type: DataTypes.STRING
      },
      bridge_id: {
        allowNull: false,
        type: DataTypes.STRING
      },
      version_id: {
        allowNull: false,
        type: DataTypes.STRING
      },
      org_id: {
        allowNull: false,
        type: DataTypes.STRING
      },
      previous_value: {
        type: DataTypes.JSON,
        allowNull: true
      },
      current_value: {
        type: DataTypes.JSON,
        allowNull: true
      }
    },
    {
      sequelize,
      modelName: "user_bridge_config_history",
      timestamps: false
    }
  );
  return user_bridge_config_history;
};

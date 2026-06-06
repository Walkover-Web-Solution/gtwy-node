"use strict";

import { Model } from "sequelize";

export default (sequelize, DataTypes) => {
  class observability_logs extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate() {
      // define association here if needed
    }
  }

  observability_logs.init(
    {
      unique_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      log_id: {
        type: DataTypes.STRING,
        allowNull: false
      },
      data: {
        type: DataTypes.JSONB,
        allowNull: false
      }
    },
    {
      sequelize,
      modelName: "observability_logs",
      tableName: "observability_logs",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  );

  return observability_logs;
};

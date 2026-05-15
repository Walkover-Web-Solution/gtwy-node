"use strict";

import { Model } from "sequelize";

export default (sequelize, DataTypes) => {
  class conversation_logs extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate() {
      // define association here if needed
    }
  }

  conversation_logs.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      llm_message: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      reasoning: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      user: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      chatbot_message: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      updated_llm_message: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      prompt: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      error: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      is_cached: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      user_feedback: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      tools_call_data: {
        type: DataTypes.JSONB,
        defaultValue: []
      },
      message_id: {
        type: DataTypes.STRING
      },
      sub_thread_id: {
        type: DataTypes.STRING
      },
      thread_id: {
        type: DataTypes.STRING
      },
      version_id: {
        type: DataTypes.STRING
      },
      bridge_id: {
        type: DataTypes.STRING
      },
      user_urls: {
        type: DataTypes.JSONB,
        defaultValue: []
      },
      llm_urls: {
        type: DataTypes.JSONB,
        defaultValue: []
      },
      AiConfig: {
        type: DataTypes.JSONB
      },
      fallback_model: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      org_id: {
        type: DataTypes.STRING
      },
      service: {
        type: DataTypes.STRING
      },
      model: {
        type: DataTypes.STRING
      },
      status: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      tokens: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      variables: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      latency: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      firstAttemptError: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      finish_reason: {
        type: DataTypes.STRING,
        allowNull: true
      },
      parent_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      child_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      batch_data: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      plans: {
        type: DataTypes.JSONB,
        allowNull: true
      }
    },
    {
      sequelize,
      modelName: "conversation_logs",
      tableName: "conversation_logs",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  );

  return conversation_logs;
};

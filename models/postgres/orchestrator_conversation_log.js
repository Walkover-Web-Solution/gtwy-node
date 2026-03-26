"use strict";

import { Model } from "sequelize";

export default (sequelize, DataTypes) => {
  class orchestrator_conversation_logs extends Model {
    static associate() {
      // we can define associations here, avi to kuch nhi h.
    }
  }

  orchestrator_conversation_logs.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      llm_message: {
        type: DataTypes.JSON,
        allowNull: true
      },
      reasoning: {
        type: DataTypes.JSON,
        allowNull: true
      },
      user: {
        type: DataTypes.JSON,
        allowNull: true
      },
      chatbot_message: {
        type: DataTypes.JSON,
        allowNull: true
      },
      updated_llm_message: {
        type: DataTypes.JSON,
        allowNull: true
      },
      prompt: {
        type: DataTypes.JSON,
        allowNull: true
      },
      error: {
        type: DataTypes.JSON,
        allowNull: true
      },
      tools_call_data: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
      },
      message_id: {
        type: DataTypes.JSON,
        allowNull: true
      },
      sub_thread_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      thread_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      version_id: {
        type: DataTypes.JSON,
        allowNull: true
      },
      bridge_id: {
        type: DataTypes.JSON,
        allowNull: true
      },
      image_urls: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
      },
      urls: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: []
      },
      AiConfig: {
        type: DataTypes.JSON,
        allowNull: true
      },
      fallback_model: {
        type: DataTypes.JSON,
        allowNull: true
      },
      org_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      service: {
        type: DataTypes.STRING,
        allowNull: true
      },
      model: {
        type: DataTypes.JSON,
        allowNull: true
      },
      status: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
      },
      tokens: {
        type: DataTypes.JSON,
        allowNull: true
      },
      variables: {
        type: DataTypes.JSON,
        allowNull: true
      },
      latency: {
        type: DataTypes.JSON,
        allowNull: true
      },
      firstAttemptError: {
        type: DataTypes.JSON,
        allowNull: true
      },
      finish_reason: {
        type: DataTypes.JSON,
        allowNull: true
      },
      agents_path: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: true,
        defaultValue: []
      }
    },
    {
      sequelize,
      modelName: "orchestrator_conversation_logs",
      tableName: "orchestrator_conversation_logs",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  );

  return orchestrator_conversation_logs;
};

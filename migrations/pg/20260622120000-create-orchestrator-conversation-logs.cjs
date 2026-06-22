"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("orchestrator_conversation_logs", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      llm_message: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      reasoning: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      user: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      chatbot_message: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      updated_llm_message: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      prompt: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      error: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      tools_call_data: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {}
      },
      message_id: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      sub_thread_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      thread_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      version_id: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      bridge_id: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      image_urls: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: []
      },
      urls: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: []
      },
      AiConfig: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      fallback_model: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      org_id: {
        type: Sequelize.STRING,
        allowNull: true
      },
      service: {
        type: Sequelize.STRING,
        allowNull: true
      },
      model: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      status: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {}
      },
      tokens: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      variables: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      latency: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      firstAttemptError: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      finish_reason: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      agents_path: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: true,
        defaultValue: []
      },
      plans: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP")
      }
    });

    await queryInterface.addIndex("orchestrator_conversation_logs", ["org_id", "bridge_id"], {
      name: "idx_orchestrator_logs_org_bridge"
    });
    await queryInterface.addIndex("orchestrator_conversation_logs", ["thread_id"], {
      name: "idx_orchestrator_logs_thread_id"
    });
    await queryInterface.addIndex("orchestrator_conversation_logs", ["created_at"], {
      name: "idx_orchestrator_logs_created_at"
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("orchestrator_conversation_logs");
  }
};

"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("conversation_logs", "reasoning", {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn("orchestrator_conversation_logs", "reasoning", {
      type: Sequelize.JSON,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("conversation_logs", "reasoning");
    await queryInterface.removeColumn("orchestrator_conversation_logs", "reasoning");
  }
};

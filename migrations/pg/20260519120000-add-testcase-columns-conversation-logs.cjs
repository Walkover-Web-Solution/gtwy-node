"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("conversation_logs", "testcase_id", {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn("conversation_logs", "testcase_data", {
      type: Sequelize.JSONB,
      allowNull: true
    });
    await queryInterface.addIndex("conversation_logs", ["testcase_id"], {
      name: "conversation_logs_testcase_id_idx"
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("conversation_logs", "conversation_logs_testcase_id_idx");
    await queryInterface.removeColumn("conversation_logs", "testcase_data");
    await queryInterface.removeColumn("conversation_logs", "testcase_id");
  }
};

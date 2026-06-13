"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("conversation_logs", "display_name", {
      type: Sequelize.TEXT,
      allowNull: true
    });

    // Needed by the rename UPDATE (WHERE org/bridge/thread/sub_thread) and the
    // sub-thread listing GROUP BY queries.
    await queryInterface.addIndex("conversation_logs", ["org_id", "bridge_id", "thread_id", "sub_thread_id"], {
      name: "conversation_logs_org_bridge_thread_sub_thread_idx"
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("conversation_logs", "conversation_logs_org_bridge_thread_sub_thread_idx");
    await queryInterface.removeColumn("conversation_logs", "display_name");
  }
};

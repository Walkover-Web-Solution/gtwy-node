"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("orphan_threads_cleanup", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      thread_id: {
        type: Sequelize.STRING
      },
      sub_thread_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      org_id: {
        type: Sequelize.STRING
      },
      bridge_id: {
        type: Sequelize.STRING
      },
      queued_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("NOW()")
      }
    });
    await queryInterface.addIndex("orphan_threads_cleanup", ["sub_thread_id"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("orphan_threads_cleanup");
  }
};

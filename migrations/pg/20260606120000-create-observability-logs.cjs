"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("observability_logs", {
      unique_id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      log_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      data: {
        type: Sequelize.JSONB,
        allowNull: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });
    await queryInterface.addIndex("observability_logs", ["log_id"], {
      name: "observability_logs_log_id_idx"
    });
  },
  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex("observability_logs", "observability_logs_log_id_idx");
    await queryInterface.dropTable("observability_logs");
  }
};

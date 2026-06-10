"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex("observability_logs", ["log_id", "created_at"], {
      name: "observability_logs_log_id_created_at_idx"
    });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("observability_logs", "observability_logs_log_id_created_at_idx");
  }
};

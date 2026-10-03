"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add previous_value column (JSON)
    await queryInterface.addColumn("user_bridge_config_history", "previous_value", {
      type: Sequelize.JSON,
      allowNull: true
    });

    // Add current_value column (JSON)
    await queryInterface.addColumn("user_bridge_config_history", "current_value", {
      type: Sequelize.JSON,
      allowNull: true
    });

    // The table now records more than agents — a row can describe a tool too —
    // so the subject column gets a neutral name. Postgres carries the existing
    // index over to the new name, so idx_ubch_org_type_bridge_time still applies.
    await queryInterface.renameColumn("user_bridge_config_history", "bridge_id", "config_id");
  },

  async down(queryInterface) {
    await queryInterface.renameColumn("user_bridge_config_history", "config_id", "bridge_id");
    await queryInterface.removeColumn("user_bridge_config_history", "current_value");
    await queryInterface.removeColumn("user_bridge_config_history", "previous_value");
  }
};

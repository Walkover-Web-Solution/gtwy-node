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
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("user_bridge_config_history", "current_value");
    await queryInterface.removeColumn("user_bridge_config_history", "previous_value");
  }
};

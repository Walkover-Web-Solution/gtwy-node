"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("user_bridge_config_history");

    if (!table.previous_value) {
      await queryInterface.addColumn("user_bridge_config_history", "previous_value", {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: null
      });
    }

    if (!table.current_value) {
      await queryInterface.addColumn("user_bridge_config_history", "current_value", {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: null
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("user_bridge_config_history");

    if (table.previous_value) {
      await queryInterface.removeColumn("user_bridge_config_history", "previous_value");
    }

    if (table.current_value) {
      await queryInterface.removeColumn("user_bridge_config_history", "current_value");
    }
  }
};

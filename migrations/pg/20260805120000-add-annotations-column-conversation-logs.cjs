"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("conversation_logs", "annotations", {
      type: Sequelize.ARRAY(Sequelize.JSONB),
      allowNull: true,
      defaultValue: []
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("conversation_logs", "annotations");
  }
};

"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("conversation_logs", "is_cached", {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("conversation_logs", "is_cached");
  }
};

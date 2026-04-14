"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = "conversation_logs";
    const column = "plans";
    const description = await queryInterface.describeTable(table);
    if (description[column]) {
      return;
    }
    await queryInterface.addColumn(table, column, {
      type: Sequelize.JSONB,
      allowNull: true
    });
  },

  async down(queryInterface) {
    const table = "conversation_logs";
    const column = "plans";
    const description = await queryInterface.describeTable(table);
    if (!description[column]) {
      return;
    }
    await queryInterface.removeColumn(table, column);
  }
};

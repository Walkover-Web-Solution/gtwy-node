"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // 1 day dropped part of yesterday before the 18:30 UTC daily rollup read it.
    await queryInterface.sequelize.query(`SELECT remove_retention_policy('fifteen_minute_data');`);
    await queryInterface.sequelize.query(`SELECT add_retention_policy('fifteen_minute_data', INTERVAL '3 days');`);
  },
  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`SELECT remove_retention_policy('fifteen_minute_data');`);
    await queryInterface.sequelize.query(`SELECT add_retention_policy('fifteen_minute_data', INTERVAL '1 day');`);
  }
};

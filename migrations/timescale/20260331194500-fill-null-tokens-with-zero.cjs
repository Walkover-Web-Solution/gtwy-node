"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // eslint-disable-next-line no-unused-vars
  async up(queryInterface, Sequelize) {
    // Fill historical nulls with 0 for reporting continuity.
    await queryInterface.sequelize.query(`
      UPDATE fifteen_minute_data
      SET
        input_tokens = COALESCE(input_tokens, 0),
        output_tokens = COALESCE(output_tokens, 0)
      WHERE input_tokens IS NULL OR output_tokens IS NULL;
    `);

    await queryInterface.sequelize.query(`
      UPDATE daily_data
      SET
        input_tokens = COALESCE(input_tokens, 0),
        output_tokens = COALESCE(output_tokens, 0)
      WHERE input_tokens IS NULL OR output_tokens IS NULL;
    `);

    // Keep future missing values from becoming null.
    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data
      ALTER COLUMN input_tokens SET DEFAULT 0,
      ALTER COLUMN output_tokens SET DEFAULT 0;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data
      ALTER COLUMN input_tokens SET DEFAULT 0,
      ALTER COLUMN output_tokens SET DEFAULT 0;
    `);
  },

  // eslint-disable-next-line no-unused-vars
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE fifteen_minute_data
      ALTER COLUMN input_tokens DROP DEFAULT,
      ALTER COLUMN output_tokens DROP DEFAULT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE daily_data
      ALTER COLUMN input_tokens DROP DEFAULT,
      ALTER COLUMN output_tokens DROP DEFAULT;
    `);
  }
};

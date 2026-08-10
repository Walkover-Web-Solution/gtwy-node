'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    console.log(Sequelize)
    await queryInterface.sequelize.query(`
      UPDATE conversations AS c1
      SET version_id = (
        SELECT c2.version_id
        FROM conversations AS c2
        WHERE c2.id = c1.id - 1
          AND c2.message_by IN ('user', 'tools_call')
          AND c2.version_id IS NOT NULL
      )
      WHERE c1.message_by = 'assistant'
        AND c1.version_id IS NULL
    `);
  },

  async down (queryInterface) {
   console.log(queryInterface)
  }
};
"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  // Every prompt save in updateVersionController already writes a row here (the
  // prompt text in system_prompt), keyed by the parent agent. version_id records
  // which version it was saved on, so the history can be listed per version.
  // Nullable: rows written before this migration, and rows written by the Python
  // service, leave it empty.
  //
  // CREATE INDEX CONCURRENTLY cannot run inside a transaction; sequelize-cli does
  // not wrap migrations in one by default.
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("system_prompt_versionings", "version_id", {
      type: Sequelize.STRING,
      allowNull: true
    });

    // Backs listPromptVersions / system_prompt_data: org_id + bridge_id, newest first.
    await queryInterface.sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spv_org_bridge_created
       ON system_prompt_versionings (org_id, bridge_id, created_at DESC);`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS idx_spv_org_bridge_created;`);
    await queryInterface.removeColumn("system_prompt_versionings", "version_id");
  }
};

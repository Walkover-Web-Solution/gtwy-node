"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Completion requests can supply a webhook at run time
    // (settings.response_format = { type: "webhook", cred: { url, headers } })
    // instead of having one configured on the agent, so the endpoint is known only
    // for the life of the request. Persisting it here lets /rerun replay the new
    // response to that same endpoint.
    //
    // Written only for type "webhook" (see saveHistory.service.js) — null for every
    // other type, notably the RTLayer creds used for chatbot and playground
    // requests, which carry the platform-wide RTLAYER_AUTH key.
    await queryInterface.addColumn("conversation_logs", "response_format", {
      type: Sequelize.JSONB,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("conversation_logs", "response_format");
  }
};

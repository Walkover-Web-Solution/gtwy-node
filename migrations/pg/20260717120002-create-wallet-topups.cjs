"use strict";

/** @type {import('sequelize-cli').Migration} */
// Wallet top-up ledger (docs/billing-idempotency-outbox-credit-system.md §6).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("wallet_topups", {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      org_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      gateway_event_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true // dedup a redelivered payment webhook
      },
      gross_amount_usd: {
        type: Sequelize.DECIMAL,
        allowNull: false
      },
      fee_amount_usd: {
        type: Sequelize.DECIMAL,
        allowNull: false
      },
      net_credits_loaded: {
        type: Sequelize.DECIMAL,
        allowNull: false
      },
      lago_transaction_id: {
        type: Sequelize.STRING,
        allowNull: false
      },
      status: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "pending"
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });
    await queryInterface.addIndex("wallet_topups", ["org_id"], {
      name: "idx_wallet_topups_org_id"
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("wallet_topups", "idx_wallet_topups_org_id");
    await queryInterface.dropTable("wallet_topups");
  }
};

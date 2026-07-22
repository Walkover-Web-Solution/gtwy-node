"use strict";

import { Model } from "sequelize";

// Wallet top-up ledger (docs/billing-idempotency-outbox-credit-system.md §6).
// A dedicated table (not conversation_logs) because a top-up is a payment-side
// event that must reconcile against the payment gateway's settlement reports
// independently of Lago, which only knows about credits, not real-currency fee
// revenue. gateway_event_id is UNIQUE so a redelivered webhook can't double-credit.
export default (sequelize, DataTypes) => {
  class wallet_topups extends Model {
    static associate() {
      // no associations
    }
  }

  wallet_topups.init(
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      org_id: {
        type: DataTypes.STRING,
        allowNull: false
      },
      gateway_event_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      gross_amount_usd: {
        type: DataTypes.DECIMAL,
        allowNull: false
      },
      fee_amount_usd: {
        type: DataTypes.DECIMAL,
        allowNull: false
      },
      net_credits_loaded: {
        type: DataTypes.DECIMAL,
        allowNull: false
      },
      lago_transaction_id: {
        type: DataTypes.STRING,
        allowNull: false
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pending" // pending | credited | refunded | failed
      }
    },
    {
      sequelize,
      modelName: "wallet_topups",
      tableName: "wallet_topups",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  );

  return wallet_topups;
};

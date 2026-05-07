import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const transactionStatus = pgEnum("transaction_status", [
  "created",
  "submitting",
  "submitted",
  "confirmed",
  "failed",
]);

export const assetType = pgEnum("asset_type", [
  "native",
  "credit_alphanum4",
  "credit_alphanum12",
]);

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: transactionStatus("status").notNull(),
  protocol: text("protocol").notNull(),
  network: text("network").notNull(),
  chainId: text("chain_id"),
  kind: text("kind").notNull(),
  sourceAddress: text("source_address").notNull(),
  destinationAddress: text("destination_address"),
  sourceAccount: text("source_account").notNull(),
  destinationAccount: text("destination_account"),
  assetType: assetType("asset_type"),
  assetCode: text("asset_code"),
  assetIssuer: text("asset_issuer"),
  amount: text("amount"),
  memo: text("memo"),
  intent: jsonb("intent").notNull(),
  preparedPayload: text("prepared_payload"),
  preparedXdr: text("prepared_xdr"),
  txHash: text("tx_hash").unique(),
  submittedPayload: text("submitted_payload"),
  envelopeXdr: text("envelope_xdr"),
  resultPayload: text("result_payload"),
  resultXdr: text("result_xdr"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  providerError: jsonb("provider_error"),
  horizonError: jsonb("horizon_error"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

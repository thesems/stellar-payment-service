import { createTransactionIfNew } from "../db/transaction-repository.js";
import type { Transaction } from "../db/schema.js";

export type PaymentAsset =
  | { type: "native" }
  | {
      type: "credit_alphanum4" | "credit_alphanum12";
      code: string;
      issuer: string;
    };

export type CreatePaymentInput = {
  idempotencyKey: string;
  sourceAccount: string;
  destinationAccount: string;
  amount: string;
  asset: PaymentAsset;
  memo?: string | undefined;
  preparedXdr?: string | undefined;
  txHash?: string | undefined;
};

export async function createPaymentTransaction(
  input: CreatePaymentInput,
): Promise<{ transaction: Transaction; idempotentReplay: boolean }> {
  return createTransactionIfNew({
    idempotencyKey: input.idempotencyKey,
    status: "created",
    sourceAccount: input.sourceAccount,
    destinationAccount: input.destinationAccount,
    assetType: input.asset.type,
    assetCode: input.asset.type === "native" ? null : input.asset.code,
    assetIssuer: input.asset.type === "native" ? null : input.asset.issuer,
    amount: input.amount,
    memo: input.memo ?? null,
    preparedXdr: input.preparedXdr ?? null,
    txHash: input.txHash ?? null,
  });
}

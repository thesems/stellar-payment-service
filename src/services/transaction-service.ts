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

export type CreateStellarTransactionInput = {
  idempotencyKey: string;
  kind: string;
  sourceAccount: string;
  intent: Record<string, unknown>;
  destinationAccount?: string | null | undefined;
  amount?: string | null | undefined;
  asset?: PaymentAsset | null | undefined;
  memo?: string | null | undefined;
  preparedXdr?: string | undefined;
  txHash?: string | undefined;
};

export async function createPaymentTransaction(
  input: CreatePaymentInput,
): Promise<{ transaction: Transaction; idempotentReplay: boolean }> {
  return createStellarTransaction({
    idempotencyKey: input.idempotencyKey,
    kind: "payment",
    sourceAccount: input.sourceAccount,
    destinationAccount: input.destinationAccount,
    amount: input.amount,
    memo: input.memo ?? null,
    asset: input.asset,
    intent: {
      source_account: input.sourceAccount,
      destination: input.destinationAccount,
      amount: input.amount,
      asset: input.asset,
      memo: input.memo ?? null,
    },
    preparedXdr: input.preparedXdr,
    txHash: input.txHash,
  });
}

export async function createStellarTransaction(
  input: CreateStellarTransactionInput,
): Promise<{ transaction: Transaction; idempotentReplay: boolean }> {
  return createTransactionIfNew({
    idempotencyKey: input.idempotencyKey,
    status: "created",
    kind: input.kind,
    sourceAccount: input.sourceAccount,
    destinationAccount: input.destinationAccount ?? null,
    assetType: input.asset?.type ?? null,
    assetCode: input.asset && input.asset.type !== "native" ? input.asset.code : null,
    assetIssuer: input.asset && input.asset.type !== "native" ? input.asset.issuer : null,
    amount: input.amount ?? null,
    memo: input.memo ?? null,
    intent: input.intent,
    preparedXdr: input.preparedXdr ?? null,
    txHash: input.txHash ?? null,
  });
}

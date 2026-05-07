import { describe, expect, it, vi } from "vitest";

const createTransactionIfNew = vi.fn();

vi.mock("../db/transaction-repository.js", () => ({
  createTransactionIfNew,
}));

vi.mock("../config/env.js", () => ({
  config: {
    stellarNetwork: "testnet",
  },
}));

const { createStellarTransaction } = await import("./transaction-service.js");

describe("createStellarTransaction", () => {
  it("writes legacy Stellar fields and generic protocol fields", async () => {
    createTransactionIfNew.mockResolvedValue({
      transaction: { id: "tx-1" },
      idempotentReplay: false,
    });

    await createStellarTransaction({
      idempotencyKey: "swap-001",
      kind: "soroswap_swap",
      sourceAccount: "GSOURCE",
      destinationAccount: "GDEST",
      intent: { source_account: "GSOURCE", to: "GDEST" },
      preparedXdr: "prepared-xdr",
    });

    expect(createTransactionIfNew).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "swap-001",
      status: "created",
      protocol: "stellar",
      network: "testnet",
      chainId: null,
      kind: "soroswap_swap",
      sourceAddress: "GSOURCE",
      destinationAddress: "GDEST",
      sourceAccount: "GSOURCE",
      destinationAccount: "GDEST",
      preparedPayload: "prepared-xdr",
      preparedXdr: "prepared-xdr",
      submittedPayload: null,
      resultPayload: null,
      providerError: null,
    }));
  });
});

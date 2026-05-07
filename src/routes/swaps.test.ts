import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Transaction } from "../db/schema.js";

const createStellarTransaction = vi.fn();
const findTransactionByHash = vi.fn();
const findTransactionById = vi.fn();
const findTransactionByIdempotencyKey = vi.fn();
const claimTransactionForSubmissionById = vi.fn();
const markTransactionSubmitted = vi.fn();
const markTransactionFailed = vi.fn();
const prepareSoroswapSwap = vi.fn();
const parseSignedHostFunctionTransaction = vi.fn();
const parsePreparedHostFunctionTransaction = vi.fn();
const submitSignedTransaction = vi.fn();

vi.mock("../config/env.js", () => ({
  config: {
    stellarNetworkPassphrase: "Test SDF Network ; September 2015",
    soroswapRouterContractId: "C".padEnd(56, "A"),
  },
}));

vi.mock("../services/transaction-service.js", () => ({
  createStellarTransaction,
}));

vi.mock("../db/transaction-repository.js", () => ({
  findTransactionByHash,
  findTransactionById,
  findTransactionByIdempotencyKey,
  claimTransactionForSubmissionById,
  markSubmittingTransactionSubmitted: markTransactionSubmitted,
  markTransactionFailed,
}));

vi.mock("../services/stellar.js", () => ({
  prepareSoroswapSwap,
  parseSignedHostFunctionTransaction,
  parsePreparedHostFunctionTransaction,
  submitSignedTransaction,
}));

const { swapRoutes } = await import("./swaps.js");

describe("POST /swap/prepare", () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_777_508_400_000);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("prepares a swap transaction and stores the intent", async () => {
    const deadline = 1_777_509_000;
    const amountIn = swapUnits("100");
    const amountOutMin = swapUnits("95");
    const createdTransaction = makeTransaction({
      preparedXdr: "prepared-swap-xdr",
      intent: {
        router_contract_id: "C".padEnd(56, "A"),
        source_account: stellarKey("A"),
        path: [contractKey("A"), contractKey("B")],
        amount_in: amountIn,
        amount_out_min: amountOutMin,
        to: stellarKey("B"),
        deadline,
      },
    });

    prepareSoroswapSwap.mockResolvedValue("prepared-swap-xdr");
    createStellarTransaction.mockResolvedValue({
      transaction: createdTransaction,
      idempotentReplay: false,
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/swap/prepare",
      payload: preparePayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(prepareSoroswapSwap).toHaveBeenCalledWith({
      sourceAccount: stellarKey("A"),
      routerContractId: "C".padEnd(56, "A"),
      path: [contractKey("A"), contractKey("B")],
      amountIn,
      amountOutMin,
      to: stellarKey("B"),
      deadline,
    });
    expect(createStellarTransaction).toHaveBeenCalledWith({
      idempotencyKey: "swap-001",
      kind: "soroswap_swap",
      sourceAccount: stellarKey("A"),
      destinationAccount: stellarKey("B"),
      intent: {
        router_contract_id: "C".padEnd(56, "A"),
        source_account: stellarKey("A"),
        path: [contractKey("A"), contractKey("B")],
        amount_in: amountIn,
        amount_out_min: amountOutMin,
        to: stellarKey("B"),
        deadline,
      },
      preparedXdr: "prepared-swap-xdr",
    });
    expect(response.json()).toMatchObject({
      idempotent_replay: false,
      prepared_transaction: "prepared-swap-xdr",
      transaction: {
        id: createdTransaction.id,
        kind: "soroswap_swap",
        prepared_transaction: "prepared-swap-xdr",
      },
    });

    await app.close();
  });

  it("returns an idempotent prepared transaction replay", async () => {
    const amountIn = swapUnits("100");
    const amountOutMin = swapUnits("95");
    const existingTransaction = makeTransaction({
      preparedXdr: "existing-prepared-swap-xdr",
      intent: {
        router_contract_id: "C".padEnd(56, "A"),
        source_account: stellarKey("A"),
        path: [contractKey("A"), contractKey("B")],
        amount_in: amountIn,
        amount_out_min: amountOutMin,
        to: stellarKey("B"),
        deadline: 1_777_509_000,
      },
    });
    findTransactionByIdempotencyKey.mockResolvedValue(existingTransaction);

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/swap/prepare",
      payload: preparePayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(prepareSoroswapSwap).not.toHaveBeenCalled();
    expect(createStellarTransaction).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      idempotent_replay: true,
      prepared_transaction: "existing-prepared-swap-xdr",
    });

    await app.close();
  });
});

describe("POST /swap/submit", () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_777_508_400_000);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("submits a signed swap transaction", async () => {
    const deadline = 1_777_509_000;
    const amountIn = swapUnits("100");
    const amountOutMin = swapUnits("95");
    const createdTransaction = makeTransaction({
      status: "created",
      preparedXdr: "prepared-swap-xdr",
      intent: {
        router_contract_id: "C".padEnd(56, "A"),
        source_account: stellarKey("A"),
        path: [contractKey("A"), contractKey("B")],
        amount_in: amountIn,
        amount_out_min: amountOutMin,
        to: stellarKey("B"),
        deadline,
      },
    });
    const submittedTransaction = makeTransaction({
      status: "submitted",
      txHash: "a".repeat(64),
      submittedAt: new Date("2026-04-18T10:01:00.000Z"),
      updatedAt: new Date("2026-04-18T10:01:00.000Z"),
      intent: createdTransaction.intent,
    });

    findTransactionById.mockResolvedValue(createdTransaction);
    findTransactionByHash.mockResolvedValue(undefined);
    parseSignedHostFunctionTransaction.mockReturnValue({
      transaction: { id: "signed-transaction" },
      hash: submittedTransaction.txHash,
      sourceAccount: stellarKey("A"),
    });
    parsePreparedHostFunctionTransaction.mockReturnValue({
      transaction: { id: "prepared-transaction" },
      hash: submittedTransaction.txHash,
      sourceAccount: stellarKey("A"),
    });
    claimTransactionForSubmissionById.mockResolvedValue({
      ...createdTransaction,
      status: "submitting",
    });
    submitSignedTransaction.mockResolvedValue({
      sourceAccount: stellarKey("A"),
      hash: submittedTransaction.txHash,
      envelopeXdr: "envelope-xdr",
      resultXdr: "result-xdr",
    });
    markTransactionSubmitted.mockResolvedValue(submittedTransaction);

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/swap/submit",
      payload: submitPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(submitSignedTransaction).toHaveBeenCalledWith({ id: "signed-transaction" });
    expect(markTransactionSubmitted).toHaveBeenCalledWith(createdTransaction.id, {
      txHash: submittedTransaction.txHash,
      envelopeXdr: "envelope-xdr",
      resultXdr: "result-xdr",
    });
    expect(response.json()).toMatchObject({
      idempotent_replay: false,
      transaction: {
        id: submittedTransaction.id,
        status: "submitted",
        tx_hash: submittedTransaction.txHash,
      },
    });

    await app.close();
  });

  it("rejects a swap transaction hash mismatch", async () => {
    const createdTransaction = makeTransaction({
      status: "created",
      preparedXdr: "prepared-swap-xdr",
      intent: {
        router_contract_id: "C".padEnd(56, "A"),
        source_account: stellarKey("A"),
        path: [contractKey("A"), contractKey("B")],
        amount_in: swapUnits("100"),
        amount_out_min: swapUnits("95"),
        to: stellarKey("B"),
        deadline: 1_777_509_000,
      },
    });

    findTransactionById.mockResolvedValue(createdTransaction);
    parseSignedHostFunctionTransaction.mockReturnValue({
      transaction: { id: "signed-transaction" },
      hash: "b".repeat(64),
      sourceAccount: stellarKey("A"),
    });
    parsePreparedHostFunctionTransaction.mockReturnValue({
      transaction: { id: "prepared-transaction" },
      hash: "c".repeat(64),
      sourceAccount: stellarKey("A"),
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/swap/submit",
      payload: submitPayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(submitSignedTransaction).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      error: "transaction_mismatch",
    });

    await app.close();
  });
});

async function buildTestApp() {
  const app = Fastify();
  await app.register(swapRoutes);
  return app;
}

function preparePayload() {
  return {
    idempotency_key: "swap-001",
    source_account: stellarKey("A"),
    path: [contractKey("A"), contractKey("B")],
    amount_in: "100",
    amount_out_min: "95",
    to: stellarKey("B"),
  };
}

function submitPayload() {
  return {
    transaction_id: "8b59b7b4-d03b-48e1-89d3-8b9ff89d2ec5",
    signed_transaction: "signed-swap-xdr",
  };
}

function stellarKey(char: string) {
  return `G${char.repeat(55)}`;
}

function contractKey(char: string) {
  return `C${char.repeat(55)}`;
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date("2026-04-18T10:00:00.000Z");

  return {
    id: "8b59b7b4-d03b-48e1-89d3-8b9ff89d2ec5",
    idempotencyKey: "swap-001",
    kind: "soroswap_swap",
    status: "created",
    protocol: "stellar",
    network: "testnet",
    chainId: null,
    sourceAddress: stellarKey("A"),
    destinationAddress: stellarKey("B"),
    sourceAccount: stellarKey("A"),
    destinationAccount: stellarKey("B"),
    assetType: null,
    assetCode: null,
    assetIssuer: null,
    amount: null,
    memo: null,
    intent: {
      router_contract_id: "C".padEnd(56, "A"),
      source_account: stellarKey("A"),
      path: [contractKey("A"), contractKey("B")],
      amount_in: swapUnits("100"),
      amount_out_min: swapUnits("95"),
      to: stellarKey("B"),
      deadline: 1_777_509_000,
    },
    preparedPayload: overrides.preparedXdr ?? null,
    preparedXdr: null,
    txHash: null,
    submittedPayload: null,
    envelopeXdr: null,
    resultPayload: null,
    resultXdr: null,
    errorCode: null,
    errorMessage: null,
    providerError: null,
    horizonError: null,
    submittedAt: null,
    confirmedAt: null,
    failedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function swapUnits(value: string): string {
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const scaled = `${normalizedWhole}${fraction.padEnd(7, "0").slice(0, 7)}`;
  return scaled.replace(/^0+(?=\d)/, "") || "0";
}

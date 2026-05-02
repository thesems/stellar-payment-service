import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Transaction } from "../db/schema.js";

const createPaymentTransaction = vi.fn();
const listTransactions = vi.fn();
const markTransactionSubmitted = vi.fn();
const markTransactionFailed = vi.fn();
const claimTransactionForSubmission = vi.fn();
const findTransactionByHash = vi.fn();
const prepareNativePayment = vi.fn();
const parseSignedNativePayment = vi.fn();
const submitSignedNativePayment = vi.fn();

vi.mock("../services/transaction-service.js", () => ({
  createPaymentTransaction,
}));

vi.mock("../db/transaction-repository.js", () => ({
    findTransactionByHash,
    findTransactionById: vi.fn(),
    listTransactions,
    claimTransactionForSubmission,
    markTransactionFailed,
    markSubmittingTransactionSubmitted: markTransactionSubmitted,
}));

vi.mock("../services/stellar.js", () => ({
  prepareNativePayment,
  parseSignedNativePayment,
  submitSignedNativePayment,
}));

const { transactionRoutes } = await import("./transactions.js");

describe("POST /tx/prepare", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("prepares an unsigned native payment transaction for wallet signing", async () => {
    prepareNativePayment.mockResolvedValue("unsigned-envelope-xdr");

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/prepare",
      payload: preparePayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(prepareNativePayment).toHaveBeenCalledWith({
      sourceAccount: stellarKey("A"),
      destination: stellarKey("B"),
      amount: "1.0000000",
      memo: "demo",
    });
    expect(response.json()).toMatchObject({
      network_passphrase: "Test SDF Network ; September 2015",
      transaction: "unsigned-envelope-xdr",
    });

    await app.close();
  });

  it("rejects invalid prepare input", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/prepare",
      payload: {
        source_account: "invalid",
        destination: stellarKey("B"),
        amount: "1.00000001",
        asset: { type: "native" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "validation_error",
    });
    expect(prepareNativePayment).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects issued assets for prepare", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/prepare",
      payload: {
        ...preparePayload(),
        asset: {
          type: "credit_alphanum4",
          code: "USDC",
          issuer: stellarKey("I"),
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "unsupported_asset",
    });
    expect(prepareNativePayment).not.toHaveBeenCalled();

    await app.close();
  });
});

describe("POST /tx/submit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("submits a signed Stellar payment for a new idempotency key and returns submitted transaction", async () => {
    const createdTransaction = makeTransaction({ status: "created" });
    const submittedTransaction = makeTransaction({
      status: "submitted",
      txHash: "a".repeat(64),
      submittedAt: new Date("2026-04-18T10:01:00.000Z"),
      updatedAt: new Date("2026-04-18T10:01:00.000Z"),
    });

    findTransactionByHash.mockResolvedValue(undefined);
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: submittedTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });
    createPaymentTransaction.mockResolvedValue({
      transaction: createdTransaction,
      idempotentReplay: false,
    });
    claimTransactionForSubmission.mockResolvedValue({
      ...createdTransaction,
      status: "submitting",
    });
    submitSignedNativePayment.mockResolvedValue({
      sourceAccount: "GSOURCEACCOUNT",
      hash: submittedTransaction.txHash,
      envelopeXdr: "envelope-xdr",
      resultXdr: "result-xdr",
    });
    markTransactionSubmitted.mockResolvedValue(submittedTransaction);

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/submit",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(findTransactionByHash).toHaveBeenCalledWith(submittedTransaction.txHash);
    expect(parseSignedNativePayment).toHaveBeenCalledWith("signed-xdr");
    expect(createPaymentTransaction).toHaveBeenCalledWith({
      idempotencyKey: "payment-001",
      sourceAccount: "GSOURCEACCOUNT",
      destinationAccount: "GDESTINATION",
      amount: "1.0000000",
      asset: { type: "native" },
      memo: "demo",
      txHash: submittedTransaction.txHash,
    });
    expect(claimTransactionForSubmission).toHaveBeenCalledWith("payment-001");
    expect(submitSignedNativePayment).toHaveBeenCalledWith({ id: "built-transaction" });
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

  it("returns an idempotent replay without calling Stellar submission", async () => {
    const existingTransaction = makeTransaction({
      status: "submitted",
      txHash: "b".repeat(64),
      submittedAt: new Date("2026-04-18T10:01:00.000Z"),
      updatedAt: new Date("2026-04-18T10:01:00.000Z"),
    });

    findTransactionByHash.mockResolvedValue(undefined);
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: existingTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });
    createPaymentTransaction.mockResolvedValue({
      transaction: existingTransaction,
      idempotentReplay: true,
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/submit",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(submitSignedNativePayment).not.toHaveBeenCalled();
    expect(markTransactionSubmitted).not.toHaveBeenCalled();
    expect(markTransactionFailed).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      idempotent_replay: true,
      transaction: {
        id: existingTransaction.id,
        status: "submitted",
        tx_hash: existingTransaction.txHash,
      },
    });

    await app.close();
  });

  it("rejects a replay that points to a different transaction hash", async () => {
    const existingTransaction = makeTransaction({
      status: "created",
      txHash: "b".repeat(64),
    });

    findTransactionByHash.mockResolvedValue(undefined);
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: "c".repeat(64),
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });
    createPaymentTransaction.mockResolvedValue({
      transaction: existingTransaction,
      idempotentReplay: true,
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/submit",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(submitSignedNativePayment).not.toHaveBeenCalled();
    expect(markTransactionSubmitted).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      error: "idempotency_conflict",
    });

    await app.close();
  });

  it("returns the current record when the transaction is already submitting", async () => {
    const submittingTransaction = makeTransaction({
      status: "submitting",
      txHash: "d".repeat(64),
    });

    findTransactionByHash.mockResolvedValue(submittingTransaction);
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: submittingTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });
    createPaymentTransaction.mockResolvedValue({
      transaction: submittingTransaction,
      idempotentReplay: true,
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/submit",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(claimTransactionForSubmission).not.toHaveBeenCalled();
    expect(submitSignedNativePayment).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      idempotent_replay: true,
      transaction: {
        status: "submitting",
        tx_hash: submittingTransaction.txHash,
      },
    });

    await app.close();
  });
});

describe("GET /tx", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists transactions with pagination and optional account filtering", async () => {
    const firstTransaction = makeTransaction({
      id: "11111111-1111-1111-1111-111111111111",
      sourceAccount: stellarKey("A"),
      destinationAccount: stellarKey("B"),
      createdAt: new Date("2026-04-18T10:05:00.000Z"),
      updatedAt: new Date("2026-04-18T10:05:00.000Z"),
    });
    const secondTransaction = makeTransaction({
      id: "22222222-2222-2222-2222-222222222222",
      sourceAccount: stellarKey("C"),
      destinationAccount: stellarKey("A"),
      createdAt: new Date("2026-04-18T10:04:00.000Z"),
      updatedAt: new Date("2026-04-18T10:04:00.000Z"),
    });

    listTransactions.mockResolvedValue([firstTransaction, secondTransaction]);

    const app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: `/tx?account=${stellarKey("A")}&limit=2&offset=4`,
    });

    expect(response.statusCode).toBe(200);
    expect(listTransactions).toHaveBeenCalledWith({
      account: stellarKey("A"),
      limit: 2,
      offset: 4,
    });
    expect(response.json()).toMatchObject({
      transactions: [
        {
          id: firstTransaction.id,
          source_account: stellarKey("A"),
          destination_account: stellarKey("B"),
        },
        {
          id: secondTransaction.id,
          source_account: stellarKey("C"),
          destination_account: stellarKey("A"),
        },
      ],
    });

    await app.close();
  });

  it("rejects invalid pagination parameters", async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: "GET",
      url: "/tx?limit=0&offset=-1",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "validation_error",
    });
    expect(listTransactions).not.toHaveBeenCalled();

    await app.close();
  });
});

async function buildTestApp() {
  const app = Fastify();
  await app.register(transactionRoutes);
  return app;
}

function paymentPayload() {
  return {
    idempotency_key: "payment-001",
    signed_transaction: "signed-xdr",
  };
}

function preparePayload() {
  return {
    source_account: stellarKey("A"),
    destination: stellarKey("B"),
    amount: "1.0000000",
    asset: { type: "native" },
    memo: "demo",
  };
}

function stellarKey(char: string) {
  return `G${char.repeat(55)}`;
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date("2026-04-18T10:00:00.000Z");

  return {
    id: "8b59b7b4-d03b-48e1-89d3-8b9ff89d2ec5",
    idempotencyKey: "payment-001",
    status: "created",
    sourceAccount: "GSOURCEACCOUNT",
    destinationAccount: "GDESTINATION",
    assetType: "native",
    assetCode: null,
    assetIssuer: null,
    amount: "1.0000000",
    memo: "demo",
    txHash: null,
    envelopeXdr: null,
    resultXdr: null,
    errorCode: null,
    errorMessage: null,
    horizonError: null,
    submittedAt: null,
    confirmedAt: null,
    failedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

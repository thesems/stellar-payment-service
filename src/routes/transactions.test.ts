import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Transaction } from "../db/schema.js";

const createPaymentTransaction = vi.fn();
const listTransactions = vi.fn();
const markTransactionSubmitted = vi.fn();
const markTransactionFailed = vi.fn();
const publicKeyFromSecret = vi.fn();
const submitNativePayment = vi.fn();

vi.mock("../services/transaction-service.js", () => ({
  createPaymentTransaction,
}));

vi.mock("../db/transaction-repository.js", () => ({
    findTransactionByHash: vi.fn(),
    findTransactionById: vi.fn(),
    listTransactions,
    markTransactionFailed,
    markTransactionSubmitted,
}));

vi.mock("../services/stellar.js", () => ({
  publicKeyFromSecret,
  submitNativePayment,
}));

const { transactionRoutes } = await import("./transactions.js");

describe("POST /tx/payment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    publicKeyFromSecret.mockReturnValue("GSOURCEACCOUNT");
  });

  it("submits a Stellar payment for a new idempotency key and returns submitted transaction", async () => {
    const createdTransaction = makeTransaction({ status: "created" });
    const submittedTransaction = makeTransaction({
      status: "submitted",
      txHash: "a".repeat(64),
      submittedAt: new Date("2026-04-18T10:01:00.000Z"),
      updatedAt: new Date("2026-04-18T10:01:00.000Z"),
    });

    createPaymentTransaction.mockResolvedValue({
      transaction: createdTransaction,
      idempotentReplay: false,
    });
    submitNativePayment.mockResolvedValue({
      sourceAccount: "GSOURCEACCOUNT",
      hash: submittedTransaction.txHash,
      envelopeXdr: "envelope-xdr",
      resultXdr: "result-xdr",
    });
    markTransactionSubmitted.mockResolvedValue(submittedTransaction);

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/payment",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(publicKeyFromSecret).toHaveBeenCalledWith("SSECRET");
    expect(createPaymentTransaction).toHaveBeenCalledWith({
      idempotencyKey: "payment-001",
      sourceAccount: "GSOURCEACCOUNT",
      destinationAccount: "GDESTINATION",
      amount: "1.0000000",
      asset: { type: "native" },
      memo: "demo",
    });
    expect(submitNativePayment).toHaveBeenCalledTimes(1);
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

    createPaymentTransaction.mockResolvedValue({
      transaction: existingTransaction,
      idempotentReplay: true,
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/payment",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(submitNativePayment).not.toHaveBeenCalled();
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
    source_secret: "SSECRET",
    destination: "GDESTINATION",
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

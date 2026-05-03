import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Transaction } from "../db/schema.js";

const createPaymentTransaction = vi.fn();
const listTransactions = vi.fn();
const markTransactionSubmitted = vi.fn();
const markTransactionFailed = vi.fn();
const claimTransactionForSubmissionById = vi.fn();
const findTransactionByHash = vi.fn();
const findTransactionById = vi.fn();
const findTransactionByIdempotencyKey = vi.fn();
const prepareNativePayment = vi.fn();
const parsePreparedNativePayment = vi.fn();
const parseSignedNativePayment = vi.fn();
const submitSignedNativePayment = vi.fn();

vi.mock("../services/transaction-service.js", () => ({
  createPaymentTransaction,
}));

vi.mock("../db/transaction-repository.js", () => ({
    findTransactionByHash,
    findTransactionById,
    findTransactionByIdempotencyKey,
    listTransactions,
    claimTransactionForSubmissionById,
    markTransactionFailed,
    markSubmittingTransactionSubmitted: markTransactionSubmitted,
}));

vi.mock("../services/stellar.js", () => ({
  prepareNativePayment,
  parsePreparedNativePayment,
  parseSignedNativePayment,
  submitSignedNativePayment,
}));

const { transactionRoutes } = await import("./transactions.js");

describe("POST /tx/prepare", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("prepares an unsigned native payment transaction and creates a transaction record", async () => {
    const createdTransaction = makeTransaction({
      sourceAccount: stellarKey("A"),
      destinationAccount: stellarKey("B"),
      preparedXdr: "unsigned-envelope-xdr",
    });
    prepareNativePayment.mockResolvedValue("unsigned-envelope-xdr");
    createPaymentTransaction.mockResolvedValue({
      transaction: createdTransaction,
      idempotentReplay: false,
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/prepare",
      payload: preparePayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(prepareNativePayment).toHaveBeenCalledWith({
      sourceAccount: stellarKey("A"),
      destination: stellarKey("B"),
      amount: "1.0000000",
      memo: "demo",
    });
    expect(createPaymentTransaction).toHaveBeenCalledWith({
      idempotencyKey: "payment-001",
      sourceAccount: stellarKey("A"),
      destinationAccount: stellarKey("B"),
      amount: "1.0000000",
      asset: { type: "native" },
      memo: "demo",
      preparedXdr: "unsigned-envelope-xdr",
    });
    expect(response.json()).toMatchObject({
      idempotent_replay: false,
      network_passphrase: "Test SDF Network ; September 2015",
      prepared_transaction: "unsigned-envelope-xdr",
      transaction: {
        id: createdTransaction.id,
        status: "created",
        prepared_transaction: "unsigned-envelope-xdr",
      },
    });

    await app.close();
  });

  it("returns an idempotent prepared transaction replay", async () => {
    const existingTransaction = makeTransaction({
      sourceAccount: stellarKey("A"),
      destinationAccount: stellarKey("B"),
      preparedXdr: "existing-unsigned-envelope-xdr",
    });
    findTransactionByIdempotencyKey.mockResolvedValue(existingTransaction);

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/prepare",
      payload: preparePayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(prepareNativePayment).not.toHaveBeenCalled();
    expect(createPaymentTransaction).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      idempotent_replay: true,
      prepared_transaction: "existing-unsigned-envelope-xdr",
      transaction: {
        id: existingTransaction.id,
        status: "created",
      },
    });

    await app.close();
  });

  it("rejects a prepare replay with different payment details", async () => {
    const existingTransaction = makeTransaction({
      destinationAccount: stellarKey("C"),
      preparedXdr: "existing-unsigned-envelope-xdr",
    });
    findTransactionByIdempotencyKey.mockResolvedValue(existingTransaction);

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/prepare",
      payload: preparePayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(prepareNativePayment).not.toHaveBeenCalled();
    expect(createPaymentTransaction).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      error: "idempotency_conflict",
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
    expect(createPaymentTransaction).not.toHaveBeenCalled();

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

  it("submits a signed Stellar payment for an existing created transaction", async () => {
    const createdTransaction = makeTransaction({
      status: "created",
      preparedXdr: "unsigned-xdr",
    });
    const submittedTransaction = makeTransaction({
      status: "submitted",
      txHash: "a".repeat(64),
      submittedAt: new Date("2026-04-18T10:01:00.000Z"),
      updatedAt: new Date("2026-04-18T10:01:00.000Z"),
    });

    findTransactionByHash.mockResolvedValue(undefined);
    findTransactionById.mockResolvedValue(createdTransaction);
    parsePreparedNativePayment.mockReturnValue({
      transaction: { id: "prepared-transaction" },
      hash: submittedTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: submittedTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });
    claimTransactionForSubmissionById.mockResolvedValue({
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
    expect(findTransactionById).toHaveBeenCalledWith(createdTransaction.id);
    expect(findTransactionByHash).toHaveBeenCalledWith(submittedTransaction.txHash);
    expect(parseSignedNativePayment).toHaveBeenCalledWith("signed-xdr");
    expect(parsePreparedNativePayment).toHaveBeenCalledWith("unsigned-xdr");
    expect(createPaymentTransaction).not.toHaveBeenCalled();
    expect(claimTransactionForSubmissionById).toHaveBeenCalledWith(createdTransaction.id);
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

  it("accepts signed transactions with normalized Stellar amount precision", async () => {
    const createdTransaction = makeTransaction({
      status: "created",
      amount: "50",
      preparedXdr: "unsigned-xdr",
    });
    const submittedTransaction = makeTransaction({
      status: "submitted",
      amount: "50",
      txHash: "e".repeat(64),
      submittedAt: new Date("2026-04-18T10:01:00.000Z"),
      updatedAt: new Date("2026-04-18T10:01:00.000Z"),
    });

    findTransactionById.mockResolvedValue(createdTransaction);
    findTransactionByHash.mockResolvedValue(undefined);
    parsePreparedNativePayment.mockReturnValue({
      transaction: { id: "prepared-transaction" },
      hash: submittedTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "50.0000000",
      memo: "demo",
    });
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: submittedTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "50.0000000",
      memo: "demo",
    });
    claimTransactionForSubmissionById.mockResolvedValue({
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
    expect(submitSignedNativePayment).toHaveBeenCalledWith({ id: "built-transaction" });

    await app.close();
  });

  it("rejects a submit for a missing transaction", async () => {
    findTransactionById.mockResolvedValue(undefined);
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: "b".repeat(64),
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/submit",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(404);
    expect(createPaymentTransaction).not.toHaveBeenCalled();
    expect(submitSignedNativePayment).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects a submit for a non-created transaction", async () => {
    const existingTransaction = makeTransaction({
      status: "submitted",
      txHash: "b".repeat(64),
      submittedAt: new Date("2026-04-18T10:01:00.000Z"),
      updatedAt: new Date("2026-04-18T10:01:00.000Z"),
    });

    findTransactionById.mockResolvedValue(existingTransaction);
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: existingTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/submit",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "transaction_not_submittable",
      transaction: {
        id: existingTransaction.id,
        status: "submitted",
      },
    });
    expect(createPaymentTransaction).not.toHaveBeenCalled();
    expect(submitSignedNativePayment).not.toHaveBeenCalled();
    expect(markTransactionSubmitted).not.toHaveBeenCalled();
    expect(markTransactionFailed).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects a signed transaction that does not match the prepared transaction", async () => {
    const existingTransaction = makeTransaction({
      status: "created",
      preparedXdr: "unsigned-xdr",
    });

    findTransactionById.mockResolvedValue(existingTransaction);
    parsePreparedNativePayment.mockReturnValue({
      transaction: { id: "prepared-transaction" },
      hash: "b".repeat(64),
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: "c".repeat(64),
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/submit",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(createPaymentTransaction).not.toHaveBeenCalled();
    expect(submitSignedNativePayment).not.toHaveBeenCalled();
    expect(markTransactionSubmitted).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      error: "transaction_mismatch",
    });

    await app.close();
  });

  it("rejects a signed transaction hash already used by another transaction", async () => {
    const createdTransaction = makeTransaction({
      status: "created",
      preparedXdr: "unsigned-xdr",
    });
    const conflictingTransaction = makeTransaction({
      id: "11111111-1111-1111-1111-111111111111",
      status: "submitted",
      txHash: "d".repeat(64),
    });

    findTransactionById.mockResolvedValue(createdTransaction);
    findTransactionByHash.mockResolvedValue(conflictingTransaction);
    parsePreparedNativePayment.mockReturnValue({
      transaction: { id: "prepared-transaction" },
      hash: conflictingTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });
    parseSignedNativePayment.mockReturnValue({
      transaction: { id: "built-transaction" },
      hash: conflictingTransaction.txHash,
      sourceAccount: "GSOURCEACCOUNT",
      destination: "GDESTINATION",
      amount: "1.0000000",
      memo: "demo",
    });

    const app = await buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/tx/submit",
      payload: paymentPayload(),
    });

    expect(response.statusCode).toBe(409);
    expect(claimTransactionForSubmissionById).not.toHaveBeenCalled();
    expect(submitSignedNativePayment).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      error: "idempotency_conflict",
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
    transaction_id: "8b59b7b4-d03b-48e1-89d3-8b9ff89d2ec5",
    signed_transaction: "signed-xdr",
  };
}

function preparePayload() {
  return {
    idempotency_key: "payment-001",
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
    preparedXdr: null,
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

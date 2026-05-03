import { describe, expect, it, vi } from "vitest";

const dbUpdate = vi.fn();

vi.mock("./client.js", () => ({
  db: {
    update: dbUpdate,
  },
}));

const { claimTransactionForSubmission, claimTransactionForSubmissionById } = await import("./transaction-repository.js");

describe("claimTransactionForSubmission", () => {
  it("moves a created transaction into submitting", async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: "tx-1",
        idempotencyKey: "payment-001",
        status: "submitting",
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    dbUpdate.mockReturnValue({ set });

    const result = await claimTransactionForSubmission("payment-001");

    expect(result).toMatchObject({
      status: "submitting",
      idempotencyKey: "payment-001",
    });
    expect(dbUpdate).toHaveBeenCalled();
  });
});

describe("claimTransactionForSubmissionById", () => {
  it("moves a created transaction into submitting by id", async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: "tx-1",
        idempotencyKey: "payment-001",
        status: "submitting",
      },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    dbUpdate.mockReturnValue({ set });

    const result = await claimTransactionForSubmissionById("tx-1");

    expect(result).toMatchObject({
      status: "submitting",
      id: "tx-1",
    });
    expect(dbUpdate).toHaveBeenCalled();
  });
});

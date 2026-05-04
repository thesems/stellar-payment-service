import { describe, expect, it } from "vitest";

import { parseStellarError, RpcTransactionError } from "./stellar-error-parser.js";

describe("parseStellarError", () => {
  it("parses Horizon operation result codes", () => {
    const parsed = parseStellarError({
      response: {
        data: {
          extras: {
            result_codes: {
              transaction: "tx_failed",
              operations: ["op_underfunded"],
            },
          },
        },
      },
    });

    expect(parsed).toMatchObject({
      errorCode: "op_underfunded",
      errorMessage: "Source account has insufficient balance.",
    });
  });

  it("parses RPC transaction errors", () => {
    const parsed = parseStellarError(new RpcTransactionError(
      "tx_rejected",
      "RPC rejected the transaction before ledger inclusion.",
      { status: "ERROR", hash: "abc" },
    ));

    expect(parsed).toEqual({
      errorCode: "tx_rejected",
      errorMessage: "RPC rejected the transaction before ledger inclusion.",
      horizonError: { status: "ERROR", hash: "abc" },
    });
  });
});

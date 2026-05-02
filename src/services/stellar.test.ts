import { Account, Asset, BASE_FEE, Keypair, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { config } from "../config/env.js";
import { parseSignedNativePayment } from "./stellar.js";

describe("parseSignedNativePayment", () => {
  it("parses a signed native payment transaction", () => {
    const source = Keypair.random();
    const destination = Keypair.random();
    const account = new Account(source.publicKey(), "123");

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.stellarNetworkPassphrase,
    })
      .addOperation(Operation.payment({
        destination: destination.publicKey(),
        amount: "1.0000000",
        asset: Asset.native(),
      }))
      .addMemo(Memo.text("demo"))
      .setTimeout(300)
      .build();

    tx.sign(source);

    const parsed = parseSignedNativePayment(tx.toEnvelope().toXDR("base64"));

    expect(parsed.hash).toBe(tx.hash().toString("hex"));
    expect(parsed.sourceAccount).toBe(source.publicKey());
    expect(parsed.destination).toBe(destination.publicKey());
    expect(parsed.amount).toBe("1.0000000");
    expect(parsed.memo).toBe("demo");
  });

  it("rejects unsigned transactions", () => {
    const source = Keypair.random();
    const destination = Keypair.random();
    const account = new Account(source.publicKey(), "123");

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.stellarNetworkPassphrase,
    })
      .addOperation(Operation.payment({
        destination: destination.publicKey(),
        amount: "1.0000000",
        asset: Asset.native(),
      }))
      .setTimeout(300)
      .build();

    expect(() => parseSignedNativePayment(tx.toEnvelope().toXDR("base64"))).toThrow(
      "Signed transaction must include at least one signature.",
    );
  });
});

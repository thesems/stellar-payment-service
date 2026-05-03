import { Account, Asset, BASE_FEE, Keypair, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { config } from "../config/env.js";
import { parseSignedPayment } from "./stellar.js";

describe("parseSignedPayment", () => {
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

    const parsed = parseSignedPayment(tx.toEnvelope().toXDR("base64"));

    expect(parsed.hash).toBe(tx.hash().toString("hex"));
    expect(parsed.sourceAccount).toBe(source.publicKey());
    expect(parsed.destination).toBe(destination.publicKey());
    expect(parsed.amount).toBe("1.0000000");
    expect(parsed.asset).toEqual({ type: "native" });
    expect(parsed.memo).toBe("demo");
  });

  it("parses a signed issued-asset payment transaction", () => {
    const source = Keypair.random();
    const destination = Keypair.random();
    const issuer = Keypair.random();
    const account = new Account(source.publicKey(), "123");
    const asset = new Asset("USDC", issuer.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.stellarNetworkPassphrase,
    })
      .addOperation(Operation.payment({
        destination: destination.publicKey(),
        amount: "25.5000000",
        asset,
      }))
      .setTimeout(300)
      .build();

    tx.sign(source);

    const parsed = parseSignedPayment(tx.toEnvelope().toXDR("base64"));

    expect(parsed.hash).toBe(tx.hash().toString("hex"));
    expect(parsed.sourceAccount).toBe(source.publicKey());
    expect(parsed.destination).toBe(destination.publicKey());
    expect(parsed.amount).toBe("25.5000000");
    expect(parsed.asset).toEqual({
      type: "credit_alphanum4",
      code: "USDC",
      issuer: issuer.publicKey(),
    });
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

    expect(() => parseSignedPayment(tx.toEnvelope().toXDR("base64"))).toThrow(
      "Signed transaction must include at least one signature.",
    );
  });
});

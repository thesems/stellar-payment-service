import { Account, Address, Asset, BASE_FEE, Contract, Keypair, Memo, Operation, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { config } from "../config/env.js";
import { parseSignedHostFunctionTransaction, parseSignedPayment } from "./stellar.js";

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

  it("parses a signed contract invocation transaction", () => {
    const source = Keypair.random();
    const account = new Account(source.publicKey(), "123");
    const router = new Contract("CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH");
    const tokenA = "CA4HEQTL2WPEUYKYKCDOHCDNIV4QHNJ7EL4J4NQ6VADP7SYHVRYZ7AW2";
    const tokenB = "CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH";

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.stellarNetworkPassphrase,
    })
      .addOperation(router.call(
        "swap_exact_tokens_for_tokens",
        nativeToScVal(100n, { type: "i128" }),
        nativeToScVal(95n, { type: "i128" }),
        nativeToScVal([new Address(tokenA), new Address(tokenB)]),
        new Address(source.publicKey()).toScVal(),
        nativeToScVal(1234567890n, { type: "u64" }),
      ))
      .setTimeout(300)
      .build();

    tx.sign(source);

    const parsed = parseSignedHostFunctionTransaction(tx.toEnvelope().toXDR("base64"));

    expect(parsed.hash).toBe(tx.hash().toString("hex"));
    expect(parsed.sourceAccount).toBe(source.publicKey());
  });
});

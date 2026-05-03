import { Asset, BASE_FEE, FeeBumpTransaction, Horizon, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction as StellarTransaction } from "@stellar/stellar-sdk";

import { config } from "../config/env.js";

export type PaymentAsset =
    | { type: "native" }
    | {
        type: "credit_alphanum4" | "credit_alphanum12";
        code: string;
        issuer: string;
    };

type PreparePaymentInput = {
    sourceAccount: string;
    destination: string;
    amount: string;
    asset: PaymentAsset;
    memo?: string | undefined;
}

export type ParsedSignedPayment = {
    transaction: StellarTransaction;
    hash: string;
    sourceAccount: string;
    destination: string;
    amount: string;
    asset: PaymentAsset;
    memo?: string | undefined;
};

export type ParsedPayment = ParsedSignedPayment;

type SubmittedStellarTransaction = {
    sourceAccount: string;
    hash: string;
    resultXdr: string;
    envelopeXdr: string;
};

export async function preparePayment(input: PreparePaymentInput): Promise<string> {
    const server = new Horizon.Server(config.stellarHorizonUrl);
    const account = await server.loadAccount(input.sourceAccount);

    const builder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.stellarNetworkPassphrase
    });
    builder.addOperation(Operation.payment({
        amount: input.amount,
        asset: toStellarAsset(input.asset),
        destination: input.destination,
    }));

    if (input.memo) {
        builder.addMemo(Memo.text(input.memo));
    }

    return builder.setTimeout(300).build().toEnvelope().toXDR("base64");
}

export function parseSignedPayment(signedTransaction: string): ParsedSignedPayment {
    return parsePaymentTransaction(signedTransaction, { requireSignature: true });
}

export function parsePreparedPayment(preparedTransaction: string): ParsedPayment {
    return parsePaymentTransaction(preparedTransaction, { requireSignature: false });
}

function parsePaymentTransaction(
    envelopeXdr: string,
    options: { requireSignature: boolean },
): ParsedPayment {
    const transaction = TransactionBuilder.fromXDR(envelopeXdr, config.stellarNetworkPassphrase);
    if (transaction instanceof FeeBumpTransaction) {
        throw new Error("Only single-operation payment transactions are supported.");
    }

    if (options.requireSignature && transaction.signatures.length === 0) {
        throw new Error("Signed transaction must include at least one signature.");
    }

    if (transaction.operations.length !== 1) {
        throw new Error("Only single-operation payment transactions are supported.");
    }

    const operation = transaction.operations[0];
    if (!operation) {
        throw new Error("Only single-operation payment transactions are supported.");
    }

    if (operation.type !== "payment") {
        throw new Error("Only payment transactions are supported.");
    }

    const memo = transaction.memo.type === "text"
        ? String(transaction.memo.value)
        : undefined;

    return {
        transaction,
        hash: transaction.hash().toString("hex"),
        sourceAccount: transaction.source,
        destination: operation.destination,
        amount: operation.amount,
        asset: fromStellarAsset(operation.asset),
        memo,
    };
}

export async function submitSignedPayment(transaction: StellarTransaction): Promise<SubmittedStellarTransaction> {
    const server = new Horizon.Server(config.stellarHorizonUrl);
    const resp = await server.submitTransaction(transaction);
    return {
        sourceAccount: transaction.source,
        hash: resp.hash,
        resultXdr: resp.result_xdr,
        envelopeXdr: resp.envelope_xdr,
    }
}

export async function getAccount(publicKey: string): Promise<Horizon.AccountResponse> {
    const server = new Horizon.Server(config.stellarHorizonUrl);
    return server.loadAccount(publicKey);
}

export async function getTransactionByHash(txHash: string): Promise<Horizon.ServerApi.TransactionRecord> {
    const server = new Horizon.Server(config.stellarHorizonUrl);
    return server.transactions().transaction(txHash).call();
}

function toStellarAsset(asset: PaymentAsset): Asset {
    if (asset.type === "native") {
        return Asset.native();
    }

    return new Asset(asset.code, asset.issuer);
}

function fromStellarAsset(asset: Asset): PaymentAsset {
    if (asset.isNative()) {
        return { type: "native" };
    }

    const code = asset.getCode();
    return {
        type: code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12",
        code,
        issuer: asset.getIssuer(),
    };
}

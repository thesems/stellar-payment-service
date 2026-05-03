import { Asset, BASE_FEE, FeeBumpTransaction, Horizon, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Transaction as StellarTransaction } from "@stellar/stellar-sdk";

import { config } from "../config/env.js";

type PrepareNativePaymentInput = {
    sourceAccount: string;
    destination: string;
    amount: string;
    memo?: string | undefined;
}

export type ParsedSignedNativePayment = {
    transaction: StellarTransaction;
    hash: string;
    sourceAccount: string;
    destination: string;
    amount: string;
    memo?: string | undefined;
};

export type ParsedNativePayment = ParsedSignedNativePayment;

type SubmittedStellarTransaction = {
    sourceAccount: string;
    hash: string;
    resultXdr: string;
    envelopeXdr: string;
};

export async function prepareNativePayment(input: PrepareNativePaymentInput): Promise<string> {
    const server = new Horizon.Server(config.stellarHorizonUrl);
    const account = await server.loadAccount(input.sourceAccount);

    const builder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.stellarNetworkPassphrase
    });
    builder.addOperation(Operation.payment({
        amount: input.amount,
        asset: Asset.native(),
        destination: input.destination,
    }));

    if (input.memo) {
        builder.addMemo(Memo.text(input.memo));
    }

    return builder.setTimeout(300).build().toEnvelope().toXDR("base64");
}

export function parseSignedNativePayment(signedTransaction: string): ParsedSignedNativePayment {
    return parseNativePaymentTransaction(signedTransaction, { requireSignature: true });
}

export function parsePreparedNativePayment(preparedTransaction: string): ParsedNativePayment {
    return parseNativePaymentTransaction(preparedTransaction, { requireSignature: false });
}

function parseNativePaymentTransaction(
    envelopeXdr: string,
    options: { requireSignature: boolean },
): ParsedNativePayment {
    const transaction = TransactionBuilder.fromXDR(envelopeXdr, config.stellarNetworkPassphrase);
    if (transaction instanceof FeeBumpTransaction) {
        throw new Error("Only native payment transactions are supported.");
    }

    if (options.requireSignature && transaction.signatures.length === 0) {
        throw new Error("Signed transaction must include at least one signature.");
    }

    if (transaction.operations.length !== 1) {
        throw new Error("Only single-operation native payment transactions are supported.");
    }

    const operation = transaction.operations[0];
    if (!operation) {
        throw new Error("Only single-operation native payment transactions are supported.");
    }

    if (operation.type !== "payment") {
        throw new Error("Only native payment transactions are supported.");
    }

    if (!operation.asset.isNative()) {
        throw new Error("Only native payment transactions are supported.");
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
        memo,
    };
}

export async function submitSignedNativePayment(transaction: StellarTransaction): Promise<SubmittedStellarTransaction> {
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

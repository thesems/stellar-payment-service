import { Asset, BASE_FEE, FeeBumpTransaction, Horizon, Memo, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import type { Transaction as StellarTransaction } from "@stellar/stellar-sdk";

import { config } from "../config/env.js";
import { RpcTransactionError } from "./stellar-error-parser.js";

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
    resultXdr: string | null;
    envelopeXdr: string;
};

export type StellarTransactionLookup =
    | { status: "SUCCESS"; raw: rpc.Api.RawGetTransactionResponse }
    | { status: "FAILED"; raw: rpc.Api.RawGetTransactionResponse }
    | { status: "NOT_FOUND"; raw: rpc.Api.RawGetTransactionResponse };

export async function preparePayment(input: PreparePaymentInput): Promise<string> {
    const server = new rpc.Server(config.stellarRpcUrl);
    const account = await server.getAccount(input.sourceAccount);

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
    const server = new rpc.Server(config.stellarRpcUrl);
    const resp = await server.sendTransaction(transaction);

    if (resp.status === "ERROR") {
        throw new RpcTransactionError(
            "tx_rejected",
            "RPC rejected the transaction before ledger inclusion.",
            {
                status: resp.status,
                hash: resp.hash,
                latestLedger: resp.latestLedger,
                errorResultXdr: resp.errorResult?.toXDR("base64"),
                diagnosticEventsXdr: resp.diagnosticEvents?.map((event) => event.toXDR("base64")),
            },
        );
    }

    if (resp.status === "TRY_AGAIN_LATER") {
        throw new RpcTransactionError(
            "try_again_later",
            "RPC could not accept the transaction yet. Try again later.",
            resp,
        );
    }

    return {
        sourceAccount: transaction.source,
        hash: resp.hash,
        resultXdr: null,
        envelopeXdr: transaction.toEnvelope().toXDR("base64"),
    }
}

export async function getAccount(publicKey: string): Promise<Horizon.AccountResponse> {
    const server = new Horizon.Server(config.stellarHorizonUrl);
    return server.loadAccount(publicKey);
}

export async function getTransactionByHash(txHash: string): Promise<StellarTransactionLookup> {
    const server = new rpc.Server(config.stellarRpcUrl);
    const resp = await server._getTransaction(txHash);

    if (resp.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { status: "SUCCESS", raw: resp };
    }

    if (resp.status === rpc.Api.GetTransactionStatus.FAILED) {
        return { status: "FAILED", raw: resp };
    }

    return { status: "NOT_FOUND", raw: resp };
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

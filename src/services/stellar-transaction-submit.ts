import type { FastifyReply, FastifyRequest } from "fastify";
import type { Transaction as StellarTransaction } from "@stellar/stellar-sdk";
import type { Transaction } from "../db/schema.js";
import { claimTransactionForSubmissionById, findTransactionByHash, markSubmittingTransactionSubmitted, markTransactionFailed } from "../db/transaction-repository.js";
import { parseStellarError } from "./stellar-error-parser.js";

type ParsedEnvelope = {
    transaction: StellarTransaction;
    hash: string;
    sourceAccount: string;
};

type SubmittedEnvelope = {
    sourceAccount: string;
    hash: string;
    resultXdr: string | null;
    envelopeXdr: string;
};

export async function submitStellarTransactionLifecycle(input: {
    request: FastifyRequest;
    reply: FastifyReply;
    transaction: Transaction;
    signedTransactionXdr: string;
    parseSignedTransaction: (xdr: string) => ParsedEnvelope;
    parsePreparedTransaction: (xdr: string) => ParsedEnvelope;
    submitTransaction: (transaction: StellarTransaction) => Promise<SubmittedEnvelope>;
    matchesPreparedTransaction: (transaction: Transaction, signed: ParsedEnvelope, prepared: ParsedEnvelope) => boolean;
    serializeTransaction: (transaction: Transaction) => Record<string, unknown>;
    successLogLabel: string;
    signedTransactionId: string;
}): Promise<void> {
    const {
        request,
        reply,
        transaction,
        signedTransactionXdr,
        parseSignedTransaction,
        parsePreparedTransaction,
        submitTransaction,
        matchesPreparedTransaction,
        serializeTransaction,
        successLogLabel,
        signedTransactionId,
    } = input;

    let signedTransaction: ParsedEnvelope;
    try {
        signedTransaction = parseSignedTransaction(signedTransactionXdr);
    } catch (err) {
        request.log.warn({
            err,
            transactionId: signedTransactionId,
        }, "signed transaction parse failed");
        reply.status(400).send({
            error: "transaction_parse_failed",
            message: err instanceof Error ? err.message : "Unable to parse signed transaction",
        });
        return;
    }

    let preparedTransaction: ParsedEnvelope;
    try {
        preparedTransaction = parsePreparedTransaction(transaction.preparedXdr as string);
    } catch (err) {
        request.log.warn({
            err,
            transactionId: signedTransactionId,
        }, "prepared transaction parse failed");
        reply.status(409).send({
            error: "prepared_transaction_invalid",
            message: err instanceof Error ? err.message : "Unable to parse prepared transaction",
        });
        return;
    }

    if (!matchesPreparedTransaction(transaction, signedTransaction, preparedTransaction)) {
        reply.status(409).send({
            error: "transaction_mismatch",
            message: "Signed transaction does not match the prepared transaction.",
            transaction: serializeTransaction(transaction),
        });
        return;
    }

    const signedHash = signedTransaction.hash;
    const conflictingTransaction = await findTransactionByHash(signedHash);
    if (conflictingTransaction && conflictingTransaction.id !== transaction.id) {
        request.log.warn({
            transactionId: signedTransactionId,
            txHash: signedHash,
        }, "transaction hash conflict");
        reply.status(409).send({
            error: "idempotency_conflict",
            message: "This signed transaction hash is already associated with a different idempotency key.",
        });
        return;
    }

    const claimedTransaction = await claimTransactionForSubmissionById(transaction.id);
    if (!claimedTransaction) {
        request.log.warn({
            transactionId: signedTransactionId,
            txHash: signedHash,
        }, "transaction already in progress");
        reply.status(409).send({
            error: "transaction_in_progress",
            message: "Transaction is already in progress.",
        });
        return;
    }

    try {
        const result = await submitTransaction(signedTransaction.transaction);

        request.log.info({
            transactionId: signedTransactionId,
            txHash: result.hash,
            sourceAccount: signedTransaction.sourceAccount,
        }, successLogLabel);

        const responseTransaction = await markSubmittingTransactionSubmitted(claimedTransaction.id, {
            txHash: result.hash,
            envelopeXdr: result.envelopeXdr,
            resultXdr: result.resultXdr,
        });

        if (!responseTransaction) {
            request.log.warn({
                transactionId: signedTransactionId,
                txHash: signedHash,
            }, "submission state conflict");
            reply.status(409).send({
                error: "submission_state_conflict",
                message: "Transaction was no longer in submitting state.",
            });
            return;
        }

        request.log.info({
            transactionId: signedTransactionId,
            txHash: result.hash,
        }, "transaction submitted");

        reply.status(201).send({
            idempotent_replay: false,
            transaction: serializeTransaction(responseTransaction),
        });
    } catch (err) {
        request.log.error({
            err,
            transactionId: signedTransactionId,
            txHash: signedHash,
        }, "transaction submission failed");
        const responseTransaction = await markTransactionFailed(claimedTransaction.id, parseStellarError(err));
        reply.status(400).send({
            idempotent_replay: false,
            transaction: serializeTransaction(responseTransaction ?? claimedTransaction),
        });
    }
}

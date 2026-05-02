import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createPaymentTransaction } from "../services/transaction-service.js";
import type { Transaction } from "../db/schema.js";
import { claimTransactionForSubmission, findTransactionByHash, findTransactionById, listTransactions, markSubmittingTransactionSubmitted, markTransactionFailed } from "../db/transaction-repository.js";
import { parseHorizonError } from "../services/horizon-error-parser.js";
import { parseSignedNativePayment, prepareNativePayment, submitSignedNativePayment, ParsedSignedNativePayment } from "../services/stellar.js";
import { config } from "../config/env.js";

const nativeAssetSchema = z.object({
    type: z.literal("native"),
});

const issuedAssetSchema = z.object({
    type: z.enum(["credit_alphanum4", "credit_alphanum12"]),
    code: z.string().trim().min(1).max(12),
    issuer: z.string().trim().min(1),
});

const submitPaymentSchema = z.object({
    idempotency_key: z.string().trim().min(1),
    signed_transaction: z.string().trim().min(1),
});

const stellarPublicKeySchema = z.string().trim().regex(/^G[A-Z2-7]{55}$/, "account must be a Stellar public key");
const amountSchema = z.string().trim().regex(/^\d+(\.\d{1,7})?$/, "amount must be a decimal string with up to 7 decimal places");

const preparePaymentSchema = z.object({
    source_account: stellarPublicKeySchema,
    destination: stellarPublicKeySchema,
    amount: amountSchema,
    asset: z.discriminatedUnion("type", [nativeAssetSchema, issuedAssetSchema]).default({ type: "native" }),
    memo: z.string().trim().min(1).max(28).optional(),
});

const uuidSchema = z.string().uuid();
const txHashSchema = z.string().regex(/^[a-fA-F0-9]{64}$/, "tx hash must be 64 hex characters");
const listTransactionsQuerySchema = z.object({
    account: stellarPublicKeySchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
    app.get("/tx", async (request, reply) => {
        const query = listTransactionsQuerySchema.safeParse(request.query);
        if (!query.success) {
            return reply.status(400).send({
                error: "validation_error",
                details: query.error.flatten().fieldErrors,
            });
        }

        const transactions = await listTransactions({
            account: query.data.account,
            limit: query.data.limit,
            offset: query.data.offset,
        });

        return reply.send({
            transactions: transactions.map(serializeTransaction),
        });
    });

    app.post("/tx/prepare", async (request, reply) => {
        const parsed = preparePaymentSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "validation_error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        if (parsed.data.asset.type !== "native") {
            return reply.status(400).send({
                error: "unsupported_asset",
                message: "Only native XLM payments are supported for transaction preparation.",
            });
        }

        try {
            const transaction = await prepareNativePayment({
                sourceAccount: parsed.data.source_account,
                destination: parsed.data.destination,
                amount: parsed.data.amount,
                memo: parsed.data.memo,
            });

            return reply.send({
                network_passphrase: config.stellarNetworkPassphrase,
                transaction,
            });
        } catch (err) {
            return reply.status(400).send({
                error: "transaction_prepare_failed",
                message: err instanceof Error ? err.message : "Unable to prepare transaction",
            });
        }
    });

    app.get("/tx/:id", async (request, reply) => {
        const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({
                error: "validation_error",
                details: params.error.flatten().fieldErrors,
            });
        }

        const transactionId = params.data.id;
        const transaction = uuidSchema.safeParse(transactionId).success
            ? await findTransactionById(transactionId)
            : txHashSchema.safeParse(transactionId).success
                ? await findTransactionByHash(transactionId)
                : undefined;

        if (!transaction && !uuidSchema.safeParse(transactionId).success && !txHashSchema.safeParse(transactionId).success) {
            return reply.status(400).send({
                error: "validation_error",
                message: "id must be a transaction UUID or a 64-character Stellar transaction hash",
            });
        }

        if (!transaction) {
            return reply.status(404).send({
                error: "transaction_not_found",
            });
        }

        return reply.send({
            transaction: serializeTransaction(transaction),
        });
    });

    app.post("/tx/submit", async (request, reply) => {
        const parsed = submitPaymentSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "validation_error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        let signedPayment: ParsedSignedNativePayment;
        try {
            signedPayment = parseSignedNativePayment(parsed.data.signed_transaction);
        } catch (err) {
            return reply.status(400).send({
                error: "transaction_parse_failed",
                message: err instanceof Error ? err.message : "Unable to parse signed transaction",
            });
        }

        const conflictingTransaction = await findTransactionByHash(signedPayment.hash);
        if (conflictingTransaction && conflictingTransaction.idempotencyKey !== parsed.data.idempotency_key) {
            return reply.status(409).send({
                error: "idempotency_conflict",
                message: "This signed transaction hash is already associated with a different idempotency key.",
            });
        }

        const { transaction, idempotentReplay } = await createPaymentTransaction({
            idempotencyKey: parsed.data.idempotency_key,
            sourceAccount: signedPayment.sourceAccount,
            destinationAccount: signedPayment.destination,
            amount: signedPayment.amount,
            asset: { type: "native" },
            memo: signedPayment.memo,
            txHash: signedPayment.hash,
        });

        if (transaction.txHash && transaction.txHash !== signedPayment.hash) {
            return reply.status(409).send({
                error: "idempotency_conflict",
                message: "This idempotency key is already bound to a different transaction hash.",
            });
        }

        const terminalStatuses = ["submitting", "submitted", "failed"];
        if (terminalStatuses.includes(transaction.status)) {
            return reply.status(idempotentReplay ? 200 : 202).send({
                idempotent_replay: idempotentReplay,
                transaction: serializeTransaction(transaction),
            });
        }

        const claimedTransaction = transaction.status === "created"
            ? await claimTransactionForSubmission(transaction.idempotencyKey)
            : undefined;

        if (!claimedTransaction) {
            return reply.status(409).send({
                error: "transaction_in_progress",
                message: "Transaction is already in progress.",
            });
        }

        try {
            const paymentResult = await submitSignedNativePayment(signedPayment.transaction);

            const responseTransaction = await markSubmittingTransactionSubmitted(claimedTransaction.id, {
                txHash: paymentResult.hash,
                envelopeXdr: paymentResult.envelopeXdr,
                resultXdr: paymentResult.resultXdr,
            });

            if (!responseTransaction) {
                return reply.status(409).send({
                    error: "submission_state_conflict",
                    message: "Transaction was no longer in submitting state.",
                });
            }

            return reply.status(idempotentReplay ? 200 : 201).send({
                idempotent_replay: idempotentReplay,
                transaction: serializeTransaction(responseTransaction),
            });
        } catch (err) {
            const responseTransaction = await markTransactionFailed(claimedTransaction.id, parseHorizonError(err));
            return reply.status(400).send({
                idempotent_replay: idempotentReplay,
                transaction: serializeTransaction(responseTransaction ?? claimedTransaction),
            });
        }
    });
}

function serializeTransaction(transaction: Transaction) {
    return {
        id: transaction.id,
        idempotency_key: transaction.idempotencyKey,
        status: transaction.status,
        source_account: transaction.sourceAccount,
        destination_account: transaction.destinationAccount,
        amount: transaction.amount,
        asset: serializeAsset(transaction),
        memo: transaction.memo,
        tx_hash: transaction.txHash,
        error_code: transaction.errorCode,
        error_message: transaction.errorMessage,
        created_at: transaction.createdAt.toISOString(),
        updated_at: transaction.updatedAt.toISOString(),
    };
}

function serializeAsset(transaction: Transaction) {
    if (transaction.assetType === "native") {
        return { type: "native" };
    }

    return {
        type: transaction.assetType,
        code: transaction.assetCode,
        issuer: transaction.assetIssuer,
    };
}

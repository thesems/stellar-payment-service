import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createPaymentTransaction } from "../services/transaction-service.js";
import type { Transaction } from "../db/schema.js";
import { findTransactionByHash, findTransactionById, markTransactionFailed, markTransactionSubmitted } from "../db/transaction-repository.js";
import { parseHorizonError } from "../services/horizon-error-parser.js";
import { publicKeyFromSecret, submitNativePayment } from "../services/stellar.js";

const nativeAssetSchema = z.object({
    type: z.literal("native"),
});

const issuedAssetSchema = z.object({
    type: z.enum(["credit_alphanum4", "credit_alphanum12"]),
    code: z.string().trim().min(1).max(12),
    issuer: z.string().trim().min(1),
});

const createPaymentSchema = z.object({
    idempotency_key: z.string().trim().min(1),
    source_secret: z.string().trim().min(1),
    destination: z.string().trim().min(1),
    amount: z.string().trim().regex(/^\d+(\.\d{1,7})?$/, "amount must be a decimal string with up to 7 decimal places"),
    asset: z.discriminatedUnion("type", [nativeAssetSchema, issuedAssetSchema]).default({ type: "native" }),
    memo: z.string().trim().min(1).max(28).optional(),
});

const uuidSchema = z.string().uuid();
const txHashSchema = z.string().regex(/^[a-fA-F0-9]{64}$/, "tx hash must be 64 hex characters");

export async function transactionRoutes(app: FastifyInstance): Promise<void> {
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

    app.post("/tx/payment", async (request, reply) => {
        const parsed = createPaymentSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "validation_error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        if (parsed.data.asset.type !== "native") {
            return reply.status(400).send({
                error: "unsupported_asset",
                message: "Only native XLM payments are supported for this first Stellar submission slice.",
            });
        }

        const { transaction, idempotentReplay } = await createPaymentTransaction({
            idempotencyKey: parsed.data.idempotency_key,
            sourceAccount: publicKeyFromSecret(parsed.data.source_secret),
            destinationAccount: parsed.data.destination,
            amount: parsed.data.amount,
            asset: parsed.data.asset,
            memo: parsed.data.memo,
        });

        let responseTransaction = transaction;

        if (!idempotentReplay) {
            try {
                const paymentInput = {
                    sourceSecret: parsed.data.source_secret,
                    destination: transaction.destinationAccount,
                    amount: transaction.amount,
                    memo: transaction.memo ?? undefined,
                };

                const paymentResult = await submitNativePayment(paymentInput);

                responseTransaction = await markTransactionSubmitted(transaction.id, {
                    txHash: paymentResult.hash,
                    envelopeXdr: paymentResult.envelopeXdr,
                    resultXdr: paymentResult.resultXdr,
                });
            } catch (err) {
                responseTransaction = await markTransactionFailed(transaction.id, parseHorizonError(err));
            }
        }

        return reply.status(idempotentReplay ? 200 : 201).send({
            idempotent_replay: idempotentReplay,
            transaction: serializeTransaction(responseTransaction),
        });
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

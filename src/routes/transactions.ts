import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createPaymentTransaction } from "../services/transaction-service.js";
import type { Transaction } from "../db/schema.js";
import { findTransactionByHash, findTransactionById, findTransactionByIdempotencyKey, listTransactions } from "../db/transaction-repository.js";
import { getAccount, parsePreparedPayment, parseSignedPayment, preparePayment, submitSignedPayment, type ParsedSignedPayment, type PaymentAsset } from "../services/stellar.js";
import { config } from "../config/env.js";
import { submitStellarTransactionLifecycle } from "../services/stellar-transaction-submit.js";

const nativeAssetSchema = z.object({
    type: z.literal("native"),
});

const issuedAssetSchema = z.object({
    type: z.enum(["credit_alphanum4", "credit_alphanum12"]),
    code: z.string().trim().min(1).max(12),
    issuer: z.string().trim().regex(/^G[A-Z2-7]{55}$/, "issuer must be a Stellar public key"),
}).superRefine((asset, ctx) => {
    if (asset.type === "credit_alphanum4" && asset.code.length > 4) {
        ctx.addIssue({
            code: "custom",
            path: ["code"],
            message: "credit_alphanum4 asset codes must be 1-4 characters",
        });
    }

    if (asset.type === "credit_alphanum12" && asset.code.length <= 4) {
        ctx.addIssue({
            code: "custom",
            path: ["code"],
            message: "credit_alphanum12 asset codes must be 5-12 characters",
        });
    }
});

const submitPaymentSchema = z.object({
    transaction_id: z.string().uuid(),
    signed_transaction: z.string().trim().min(1),
});

const stellarPublicKeySchema = z.string().trim().regex(/^G[A-Z2-7]{55}$/, "account must be a Stellar public key");
const amountSchema = z.string().trim().regex(/^\d+(\.\d{1,7})?$/, "amount must be a decimal string with up to 7 decimal places");

const preparePaymentSchema = z.object({
    idempotency_key: z.string().trim().min(1),
    source_account: stellarPublicKeySchema,
    destination: stellarPublicKeySchema,
    amount: amountSchema,
    asset: z.discriminatedUnion("type", [nativeAssetSchema, issuedAssetSchema]),
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
            request.log.warn({
                details: parsed.error.flatten().fieldErrors,
            }, "transaction prepare validation failed");
            return reply.status(400).send({
                error: "validation_error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const existingTransaction = await findTransactionByIdempotencyKey(parsed.data.idempotency_key);
        if (existingTransaction) {
            if (!samePreparedPayment(existingTransaction, {
                sourceAccount: parsed.data.source_account,
                destinationAccount: parsed.data.destination,
                amount: parsed.data.amount,
                asset: parsed.data.asset,
                memo: parsed.data.memo,
            })) {
                return reply.status(409).send({
                    error: "idempotency_conflict",
                    message: "This idempotency key is already bound to a different prepared transaction.",
                });
            }

            return reply.send({
                idempotent_replay: true,
                network_passphrase: config.stellarNetworkPassphrase,
                prepared_transaction: existingTransaction.status === "created" ? existingTransaction.preparedXdr : null,
                transaction: serializeTransaction(existingTransaction),
            });
        }

        try {
            request.log.info({
                sourceAccount: parsed.data.source_account,
                destination: parsed.data.destination,
                amount: parsed.data.amount,
                asset: parsed.data.asset,
                memo: parsed.data.memo ?? null,
            }, "preparing payment transaction");

            await Promise.all([
                verifySourceCanSendAsset(parsed.data.source_account, parsed.data.asset, parsed.data.amount),
                verifyDestinationCanReceiveAsset(parsed.data.destination, parsed.data.asset),
            ]);

            const preparedXdr = await preparePayment({
                sourceAccount: parsed.data.source_account,
                destination: parsed.data.destination,
                amount: parsed.data.amount,
                asset: parsed.data.asset,
                memo: parsed.data.memo,
            });
            const { transaction, idempotentReplay } = await createPaymentTransaction({
                idempotencyKey: parsed.data.idempotency_key,
                sourceAccount: parsed.data.source_account,
                destinationAccount: parsed.data.destination,
                amount: parsed.data.amount,
                asset: parsed.data.asset,
                memo: parsed.data.memo,
                preparedXdr,
            });
            if (!samePreparedPayment(transaction, {
                sourceAccount: parsed.data.source_account,
                destinationAccount: parsed.data.destination,
                amount: parsed.data.amount,
                asset: parsed.data.asset,
                memo: parsed.data.memo,
            })) {
                return reply.status(409).send({
                    error: "idempotency_conflict",
                    message: "This idempotency key is already bound to a different prepared transaction.",
                });
            }

            request.log.info({
                idempotencyKey: parsed.data.idempotency_key,
                sourceAccount: parsed.data.source_account,
                destination: parsed.data.destination,
                amount: parsed.data.amount,
            }, "transaction prepared");
            return reply.status(idempotentReplay ? 200 : 201).send({
                idempotent_replay: idempotentReplay,
                network_passphrase: config.stellarNetworkPassphrase,
                prepared_transaction: transaction.status === "created" ? transaction.preparedXdr : null,
                transaction: serializeTransaction(transaction),
            });
        } catch (err) {
            request.log.error({
                err,
                sourceAccount: parsed.data.source_account,
                destination: parsed.data.destination,
                amount: parsed.data.amount,
            }, "transaction prepare failed");
            if (err instanceof PaymentPrepareError) {
                return reply.status(400).send({
                    error: err.code,
                    message: err.message,
                });
            }

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
            request.log.warn({
                details: parsed.error.flatten().fieldErrors,
            }, "transaction submit validation failed");
            return reply.status(400).send({
                error: "validation_error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const transaction = await findTransactionById(parsed.data.transaction_id);
        if (!transaction) {
            return reply.status(404).send({
                error: "transaction_not_found",
            });
        }

        if (transaction.status !== "created") {
            return reply.status(409).send({
                error: "transaction_not_submittable",
                message: "Only created transactions can be submitted.",
                transaction: serializeTransaction(transaction),
            });
        }

        if (!transaction.preparedXdr) {
            return reply.status(409).send({
                error: "transaction_not_prepared",
                message: "Transaction does not have a prepared envelope XDR.",
                transaction: serializeTransaction(transaction),
            });
        }

        if (transaction.kind !== "payment") {
            return reply.status(409).send({
                error: "transaction_not_submittable",
                message: "Unsupported transaction kind.",
                transaction: serializeTransaction(transaction),
            });
        }

        await submitStellarTransactionLifecycle({
            request,
            reply,
            transaction,
            signedTransactionXdr: parsed.data.signed_transaction,
            parseSignedTransaction: parseSignedPayment,
            parsePreparedTransaction: parsePreparedPayment,
            submitTransaction: async (stellarTransaction) => submitSignedPayment(stellarTransaction),
            matchesPreparedTransaction: (storedTransaction, signedTransaction, preparedTransaction) =>
                matchesStoredPayment(storedTransaction, signedTransaction as ParsedSignedPayment)
                && signedTransaction.hash === preparedTransaction.hash,
            serializeTransaction,
            successLogLabel: "submitting signed payment",
            signedTransactionId: parsed.data.transaction_id,
        });
    });
}

export function serializeTransaction(transaction: Transaction) {
    const paymentIntent = readPaymentIntent(transaction);
    return {
        id: transaction.id,
        idempotency_key: transaction.idempotencyKey,
        kind: transaction.kind,
        status: transaction.status,
        protocol: transaction.protocol,
        network: transaction.network,
        chain_id: transaction.chainId,
        source_address: transaction.sourceAddress,
        destination_address: transaction.destinationAddress,
        source_account: transaction.sourceAccount,
        destination_account: transaction.destinationAccount,
        amount: transaction.amount,
        asset: serializeAsset(transaction),
        memo: transaction.memo,
        intent: transaction.intent,
        prepared_transaction: transaction.status === "created" ? transaction.preparedXdr : null,
        prepared_payload: transaction.status === "created" ? transaction.preparedPayload : null,
        network_passphrase: transaction.status === "created" ? config.stellarNetworkPassphrase : null,
        tx_hash: transaction.txHash,
        submitted_payload: transaction.submittedPayload,
        result_payload: transaction.resultPayload,
        error_code: transaction.errorCode,
        error_message: transaction.errorMessage,
        payment: paymentIntent
            ? {
                source_account: paymentIntent.sourceAccount,
                destination: paymentIntent.destinationAccount,
                amount: paymentIntent.amount,
                asset: paymentIntent.asset,
                memo: paymentIntent.memo,
            }
            : null,
        created_at: transaction.createdAt.toISOString(),
        updated_at: transaction.updatedAt.toISOString(),
    };
}

function samePreparedPayment(
    transaction: Transaction,
    input: {
        sourceAccount: string;
        destinationAccount: string;
        amount: string;
        asset: PaymentAsset;
        memo?: string | undefined;
    },
): boolean {
    const payment = readPaymentIntent(transaction);
    if (!payment) {
        return false;
    }

    return payment.sourceAccount === input.sourceAccount
        && payment.destinationAccount === input.destinationAccount
        && sameStellarAmount(payment.amount, input.amount)
        && (payment.memo ?? undefined) === (input.memo ?? undefined)
        && sameAsset(payment.asset, input.asset);
}

function matchesStoredPayment(transaction: Transaction, signedPayment: ParsedSignedPayment): boolean {
    const payment = readPaymentIntent(transaction);
    if (!payment) {
        return false;
    }

    return payment.sourceAccount === signedPayment.sourceAccount
        && payment.destinationAccount === signedPayment.destination
        && sameStellarAmount(payment.amount, signedPayment.amount)
        && (payment.memo ?? undefined) === (signedPayment.memo ?? undefined)
        && sameAsset(payment.asset, signedPayment.asset);
}

function sameStellarAmount(left: string, right: string): boolean {
    return normalizeStellarAmount(left) === normalizeStellarAmount(right);
}

function normalizeStellarAmount(amount: string): string {
    const [whole = "0", fraction = ""] = amount.split(".");
    const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
    return `${normalizedWhole}.${fraction.padEnd(7, "0").slice(0, 7)}`;
}

function serializeAsset(transaction: Transaction) {
    if (transaction.assetType == null) {
        return null;
    }

    if (transaction.assetType === "native") {
        return { type: "native" };
    }

    return {
        type: transaction.assetType,
        code: transaction.assetCode,
        issuer: transaction.assetIssuer,
    };
}

function sameAsset(left: PaymentAsset, right: PaymentAsset): boolean {
    if (left.type !== right.type) {
        return false;
    }

    if (left.type === "native" && right.type === "native") {
        return true;
    }

    if (left.type === "native" || right.type === "native") {
        return false;
    }

    return left.code === right.code && left.issuer === right.issuer;
}

function readPaymentIntent(transaction: Transaction): {
    sourceAccount: string;
    destinationAccount: string;
    amount: string;
    asset: PaymentAsset;
    memo?: string | undefined;
} | null {
    if (transaction.kind !== "payment") {
        return null;
    }

    const intent = transaction.intent as Partial<{
        source_account: string;
        destination: string;
        amount: string;
        asset: PaymentAsset;
        memo?: string | null;
    }> | null | undefined;

    const sourceAccount = intent?.source_account ?? transaction.sourceAccount ?? transaction.sourceAddress;
    const destinationAccount = intent?.destination ?? transaction.destinationAccount ?? transaction.destinationAddress ?? undefined;
    const amount = intent?.amount ?? transaction.amount ?? undefined;
    const asset = intent?.asset ?? readAsset(transaction);

    if (!destinationAccount || !amount || !asset) {
        return null;
    }

    return {
        sourceAccount,
        destinationAccount,
        amount,
        asset,
        memo: intent?.memo ?? transaction.memo ?? undefined,
    };
}

function readAsset(transaction: Transaction): PaymentAsset | null {
    if (transaction.assetType == null) {
        return null;
    }

    if (transaction.assetType === "native") {
        return { type: "native" };
    }

    if (!transaction.assetCode || !transaction.assetIssuer) {
        return null;
    }

    return {
        type: transaction.assetType,
        code: transaction.assetCode,
        issuer: transaction.assetIssuer,
    };
}

async function verifySourceCanSendAsset(sourceAccount: string, asset: PaymentAsset, amount: string): Promise<void> {
    const account = await getAccount(sourceAccount);
    const balance = findAssetBalance(account.balances, asset);
    if (!balance) {
        throw new PaymentPrepareError(
            "source_asset_missing",
            "Source account does not hold the requested asset.",
        );
    }

    if (compareStellarAmounts(balance, amount) < 0) {
        throw new PaymentPrepareError(
            "source_insufficient_balance",
            "Source account balance is lower than the requested payment amount.",
        );
    }
}

async function verifyDestinationCanReceiveAsset(destinationAccount: string, asset: PaymentAsset): Promise<void> {
    if (asset.type === "native" || destinationAccount === asset.issuer) {
        return;
    }

    const account = await getAccount(destinationAccount);
    if (!findAssetBalance(account.balances, asset)) {
        throw new PaymentPrepareError(
            "destination_trustline_missing",
            "Destination account does not have a trustline for the requested asset.",
        );
    }
}

function findAssetBalance(balances: unknown[], asset: PaymentAsset): string | undefined {
    for (const balance of balances) {
        const record = typeof balance === "object" && balance !== null
            ? balance as Record<string, unknown>
            : {};
        if (asset.type === "native") {
            if (record.asset_type === "native") {
                return String(record.balance ?? "0");
            }
            continue;
        }

        if (record.asset_type === asset.type
            && record.asset_code === asset.code
            && record.asset_issuer === asset.issuer) {
            return String(record.balance ?? "0");
        }
    }

    return undefined;
}

function compareStellarAmounts(left: string, right: string): number {
    const leftStroops = stellarAmountToStroops(left);
    const rightStroops = stellarAmountToStroops(right);

    if (leftStroops === rightStroops) {
        return 0;
    }

    return leftStroops > rightStroops ? 1 : -1;
}

function stellarAmountToStroops(amount: string): bigint {
    const [whole = "0", fraction = ""] = amount.split(".");
    return BigInt(whole.replace(/^0+(?=\d)/, "") || "0") * 10_000_000n
        + BigInt(fraction.padEnd(7, "0").slice(0, 7));
}

class PaymentPrepareError extends Error {
    constructor(
        readonly code: "source_asset_missing" | "source_insufficient_balance" | "destination_trustline_missing",
        message: string,
    ) {
        super(message);
    }
}

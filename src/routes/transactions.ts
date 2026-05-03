import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createPaymentTransaction } from "../services/transaction-service.js";
import type { Transaction } from "../db/schema.js";
import { claimTransactionForSubmissionById, findTransactionByHash, findTransactionById, findTransactionByIdempotencyKey, listTransactions, markSubmittingTransactionSubmitted, markTransactionFailed } from "../db/transaction-repository.js";
import { parseHorizonError } from "../services/horizon-error-parser.js";
import { getAccount, parsePreparedPayment, parseSignedPayment, preparePayment, submitSignedPayment, type ParsedSignedPayment, type PaymentAsset } from "../services/stellar.js";
import { config } from "../config/env.js";

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

        let signedPayment: ParsedSignedPayment;
        try {
            signedPayment = parseSignedPayment(parsed.data.signed_transaction);
        } catch (err) {
            request.log.warn({
                err,
                transactionId: parsed.data.transaction_id,
            }, "signed transaction parse failed");
            return reply.status(400).send({
                error: "transaction_parse_failed",
                message: err instanceof Error ? err.message : "Unable to parse signed transaction",
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

        let preparedPayment: ParsedSignedPayment;
        try {
            preparedPayment = parsePreparedPayment(transaction.preparedXdr);
        } catch (err) {
            request.log.warn({
                err,
                transactionId: parsed.data.transaction_id,
            }, "prepared transaction parse failed");
            return reply.status(409).send({
                error: "prepared_transaction_invalid",
                message: err instanceof Error ? err.message : "Unable to parse prepared transaction",
            });
        }

        if (!matchesStoredPayment(transaction, signedPayment) || signedPayment.hash !== preparedPayment.hash) {
            return reply.status(409).send({
                error: "transaction_mismatch",
                message: "Signed transaction does not match the prepared transaction.",
                transaction: serializeTransaction(transaction),
            });
        }

        const conflictingTransaction = await findTransactionByHash(signedPayment.hash);
        if (conflictingTransaction && conflictingTransaction.id !== transaction.id) {
            request.log.warn({
                transactionId: parsed.data.transaction_id,
                txHash: signedPayment.hash,
            }, "transaction hash conflict");
            return reply.status(409).send({
                error: "idempotency_conflict",
                message: "This signed transaction hash is already associated with a different idempotency key.",
            });
        }

        const claimedTransaction = await claimTransactionForSubmissionById(transaction.id);

        if (!claimedTransaction) {
            request.log.warn({
                transactionId: parsed.data.transaction_id,
                txHash: signedPayment.hash,
            }, "transaction already in progress");
            return reply.status(409).send({
                error: "transaction_in_progress",
                message: "Transaction is already in progress.",
            });
        }

        try {
            request.log.info({
                transactionId: parsed.data.transaction_id,
                txHash: signedPayment.hash,
                sourceAccount: signedPayment.sourceAccount,
                destination: signedPayment.destination,
                amount: signedPayment.amount,
                asset: signedPayment.asset,
            }, "submitting signed payment");
            const paymentResult = await submitSignedPayment(signedPayment.transaction);

            const responseTransaction = await markSubmittingTransactionSubmitted(claimedTransaction.id, {
                txHash: paymentResult.hash,
                envelopeXdr: paymentResult.envelopeXdr,
                resultXdr: paymentResult.resultXdr,
            });

            if (!responseTransaction) {
                request.log.warn({
                    transactionId: parsed.data.transaction_id,
                    txHash: signedPayment.hash,
                }, "submission state conflict");
                return reply.status(409).send({
                    error: "submission_state_conflict",
                    message: "Transaction was no longer in submitting state.",
                });
            }

            request.log.info({
                transactionId: parsed.data.transaction_id,
                txHash: paymentResult.hash,
            }, "transaction submitted");
            return reply.status(201).send({
                idempotent_replay: false,
                transaction: serializeTransaction(responseTransaction),
            });
        } catch (err) {
            request.log.error({
                err,
                transactionId: parsed.data.transaction_id,
                txHash: signedPayment.hash,
            }, "transaction submission failed");
            const responseTransaction = await markTransactionFailed(claimedTransaction.id, parseHorizonError(err));
            return reply.status(400).send({
                idempotent_replay: false,
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
        prepared_transaction: transaction.status === "created" ? transaction.preparedXdr : null,
        network_passphrase: transaction.status === "created" ? config.stellarNetworkPassphrase : null,
        tx_hash: transaction.txHash,
        error_code: transaction.errorCode,
        error_message: transaction.errorMessage,
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
    return transaction.sourceAccount === input.sourceAccount
        && transaction.destinationAccount === input.destinationAccount
        && sameStellarAmount(transaction.amount, input.amount)
        && (transaction.memo ?? undefined) === (input.memo ?? undefined)
        && sameAsset(transactionAsset(transaction), input.asset);
}

function matchesStoredPayment(transaction: Transaction, signedPayment: ParsedSignedPayment): boolean {
    return transaction.sourceAccount === signedPayment.sourceAccount
        && transaction.destinationAccount === signedPayment.destination
        && sameStellarAmount(transaction.amount, signedPayment.amount)
        && (transaction.memo ?? undefined) === (signedPayment.memo ?? undefined)
        && sameAsset(transactionAsset(transaction), signedPayment.asset);
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
    if (transaction.assetType === "native") {
        return { type: "native" };
    }

    return {
        type: transaction.assetType,
        code: transaction.assetCode,
        issuer: transaction.assetIssuer,
    };
}

function transactionAsset(transaction: Transaction): PaymentAsset {
    if (transaction.assetType === "native") {
        return { type: "native" };
    }

    if (!transaction.assetCode || !transaction.assetIssuer) {
        throw new Error("issued asset transaction is missing code or issuer");
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

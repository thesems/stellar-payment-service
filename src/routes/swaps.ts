import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { config } from "../config/env.js";
import { findTransactionById, findTransactionByIdempotencyKey } from "../db/transaction-repository.js";
import type { Transaction } from "../db/schema.js";
import { createStellarTransaction } from "../services/transaction-service.js";
import { parsePreparedHostFunctionTransaction, parseSignedHostFunctionTransaction, prepareSoroswapSwap, submitSignedTransaction } from "../services/stellar.js";
import { submitStellarTransactionLifecycle } from "../services/stellar-transaction-submit.js";
import { serializeTransaction } from "./transactions.js";

const contractIdSchema = z.string().trim().regex(/^C[A-Z2-7]{55}$/, "contract must be a Stellar contract ID");
const stellarAddressSchema = z.string().trim().regex(/^[GC][A-Z2-7]{55}$/, "address must be a Stellar account or contract");
const swapAmountSchema = z.string().trim().regex(/^\d+(\.\d{1,7})?$/, "amount must be a decimal string with up to 7 places");

const prepareSwapSchema = z.object({
    idempotency_key: z.string().trim().min(1),
    source_account: z.string().trim().regex(/^G[A-Z2-7]{55}$/, "source account must be a Stellar public key"),
    path: z.array(contractIdSchema).min(2),
    amount_in: swapAmountSchema,
    amount_out_min: swapAmountSchema,
    to: stellarAddressSchema,
    deadline: z.coerce.number().int().positive().optional(),
});

const submitSwapSchema = z.object({
    transaction_id: z.string().uuid(),
    signed_transaction: z.string().trim().min(1),
});

const uuidSchema = z.string().uuid();

export async function swapRoutes(app: FastifyInstance): Promise<void> {
    app.post("/swap/prepare", async (request, reply) => {
        const parsed = prepareSwapSchema.safeParse(request.body);
        if (!parsed.success) {
            request.log.warn({
                details: parsed.error.flatten().fieldErrors,
            }, "swap prepare validation failed");
            return reply.status(400).send({
                error: "validation_error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const routerContractId = config.soroswapRouterContractId;
        if (!routerContractId) {
            return reply.status(500).send({
                error: "swap_not_configured",
                message: "SOROSWAP_ROUTER_CONTRACT_ID is not configured.",
            });
        }

        const deadline = parsed.data.deadline ?? defaultSwapDeadline();
        const amountIn = normalizeSwapAmount(parsed.data.amount_in);
        const amountOutMin = normalizeSwapAmount(parsed.data.amount_out_min);
        const swapIntent = {
            source_account: parsed.data.source_account,
            path: parsed.data.path,
            amount_in: amountIn,
            amount_out_min: amountOutMin,
            to: parsed.data.to,
            deadline,
        };

        const existingTransaction = await findTransactionByIdempotencyKey(parsed.data.idempotency_key);
        if (existingTransaction) {
            if (!samePreparedSwap(existingTransaction, swapIntent)) {
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
                path: parsed.data.path,
                amountIn,
                amountOutMin,
                to: parsed.data.to,
                deadline,
            }, "preparing soroswap transaction");

            const preparedXdr = await prepareSoroswapSwap({
                sourceAccount: parsed.data.source_account,
                routerContractId,
                path: parsed.data.path,
                amountIn,
                amountOutMin,
                to: parsed.data.to,
                deadline,
            });

            const { transaction, idempotentReplay } = await createStellarTransaction({
                idempotencyKey: parsed.data.idempotency_key,
                kind: "soroswap_swap",
                sourceAccount: parsed.data.source_account,
                destinationAccount: parsed.data.to,
                intent: {
                    router_contract_id: routerContractId,
                    source_account: parsed.data.source_account,
                    path: parsed.data.path,
                    amount_in: amountIn,
                    amount_out_min: amountOutMin,
                    to: parsed.data.to,
                    deadline,
                },
                preparedXdr,
            });

            if (!samePreparedSwap(transaction, swapIntent)) {
                return reply.status(409).send({
                    error: "idempotency_conflict",
                    message: "This idempotency key is already bound to a different prepared transaction.",
                });
            }

            request.log.info({
                idempotencyKey: parsed.data.idempotency_key,
                sourceAccount: parsed.data.source_account,
                path: parsed.data.path,
            }, "soroswap transaction prepared");

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
                path: parsed.data.path,
                amountIn: parsed.data.amount_in,
            }, "soroswap prepare failed");

            return reply.status(400).send({
                error: "transaction_prepare_failed",
                message: err instanceof Error ? err.message : "Unable to prepare swap transaction",
            });
        }
    });

    app.get("/swap/:id", async (request, reply) => {
        const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
        if (!params.success) {
            return reply.status(400).send({
                error: "validation_error",
                details: params.error.flatten().fieldErrors,
            });
        }

        const swap = uuidSchema.safeParse(params.data.id).success
            ? await findTransactionById(params.data.id)
            : undefined;

        if (!swap || swap.kind !== "soroswap_swap") {
            return reply.status(404).send({
                error: "transaction_not_found",
            });
        }

        return reply.send({
            transaction: serializeTransaction(swap),
        });
    });

    app.post("/swap/submit", async (request, reply) => {
        const parsed = submitSwapSchema.safeParse(request.body);
        if (!parsed.success) {
            request.log.warn({
                details: parsed.error.flatten().fieldErrors,
            }, "swap submit validation failed");
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

        if (transaction.kind !== "soroswap_swap" || transaction.status !== "created") {
            return reply.status(409).send({
                error: "transaction_not_submittable",
                message: "Only created swap transactions can be submitted.",
                transaction: serializeTransaction(transaction),
            });
        }

        await submitStellarTransactionLifecycle({
            request,
            reply,
            transaction,
            signedTransactionXdr: parsed.data.signed_transaction,
            parseSignedTransaction: parseSignedHostFunctionTransaction,
            parsePreparedTransaction: parsePreparedHostFunctionTransaction,
            submitTransaction: async (stellarTransaction) => submitSignedTransaction(stellarTransaction),
            matchesPreparedTransaction: (_, signedTransaction, preparedTransaction) => signedTransaction.hash === preparedTransaction.hash,
            serializeTransaction,
            successLogLabel: "submitting signed swap",
            signedTransactionId: parsed.data.transaction_id,
        });
    });
}

function samePreparedSwap(
    transaction: Transaction,
    input: {
        source_account: string;
        path: string[];
        amount_in: string;
        amount_out_min: string;
        to: string;
        deadline?: number;
    },
): boolean {
    if (transaction.kind !== "soroswap_swap") {
        return false;
    }

    const intent = transaction.intent as Partial<{
        router_contract_id: string;
        source_account: string;
        path: string[];
        amount_in: string;
        amount_out_min: string;
        to: string;
        deadline: number;
    }> | null | undefined;

    const routerContractId = config.soroswapRouterContractId;
    return intent?.router_contract_id === routerContractId
        && intent?.source_account === input.source_account
        && sameContractPath(intent?.path ?? [], input.path)
        && sameContractAmount(intent?.amount_in, input.amount_in)
        && sameContractAmount(intent?.amount_out_min, input.amount_out_min)
        && intent?.to === input.to
        && Number(intent?.deadline) === input.deadline;
}

function sameContractPath(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameContractAmount(left: string | undefined, right: string): boolean {
    if (!left) {
        return false;
    }

    return normalizeSwapAmount(left) === normalizeSwapAmount(right);
}

function defaultSwapDeadline(): number {
    return Math.floor(Date.now() / 1000) + 600;
}

function normalizeSwapAmount(amount: string): string {
    const trimmed = amount.trim();
    const [whole = "0", fraction = ""] = trimmed.split(".");
    const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
    const scaled = `${normalizedWhole || "0"}${fraction.padEnd(7, "0").slice(0, 7)}`;
    return scaled.replace(/^0+(?=\d)/, "") || "0";
}

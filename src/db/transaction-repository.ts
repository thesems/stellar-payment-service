import { and, asc, eq, isNotNull } from "drizzle-orm";

import { db } from "./client.js";
import { type NewTransaction, type Transaction, transactions } from "./schema.js";

export async function createTransactionIfNew(
    input: NewTransaction,
): Promise<{ transaction: Transaction; idempotentReplay: boolean }> {
    const inserted = await db.insert(transactions).values(input).onConflictDoNothing({
        target: transactions.idempotencyKey
    }).returning();

    const newTransaction = inserted[0];
    if (newTransaction) {
        return { transaction: newTransaction, idempotentReplay: false };
    }

    const existing = await findTransactionByIdempotencyKey(input.idempotencyKey);
    if (!existing) {
        throw new Error("idempotency conflict detected, but existing transaction was not found");
    }

    return { transaction: existing, idempotentReplay: true };
}

export async function findTransactionByIdempotencyKey(
    idempotencyKey: string,
): Promise<Transaction | undefined> {
    const rows = await db
        .select()
        .from(transactions)
        .where(eq(transactions.idempotencyKey, idempotencyKey))
        .limit(1);

    return rows[0];
}

export async function findTransactionById(id: string): Promise<Transaction | undefined> {
    const rows = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, id))
        .limit(1);

    return rows[0];
}

export async function findTransactionByHash(txHash: string): Promise<Transaction | undefined> {
    const rows = await db
        .select()
        .from(transactions)
        .where(eq(transactions.txHash, txHash))
        .limit(1);

    return rows[0];
}

export async function findSubmittedTransactions(): Promise<Transaction[]> {
    return db
        .select()
        .from(transactions)
        .where(and(
            eq(transactions.status, "submitted"),
            isNotNull(transactions.txHash),
        ))
        .orderBy(asc(transactions.submittedAt));
}

export async function markTransactionSubmitted(
    id: string,
    input: {
        txHash: string;
        envelopeXdr: string;
        resultXdr: string;
    },
): Promise<Transaction> {
    const rows = await db
        .update(transactions)
        .set({
            status: "submitted",
            txHash: input.txHash,
            envelopeXdr: input.envelopeXdr,
            resultXdr: input.resultXdr,
            submittedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(transactions.id, id))
        .returning();

    const transaction = rows[0];
    if (!transaction) {
        throw new Error(`transaction ${id} was not found`);
    }

    return transaction;
}

export async function markTransactionFailed(
    id: string,
    input: {
        errorCode: string;
        errorMessage: string;
        horizonError?: unknown;
    },
): Promise<Transaction> {
    const rows = await db
        .update(transactions)
        .set({
            status: "failed",
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            horizonError: input.horizonError ?? null,
            failedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(transactions.id, id))
        .returning();

    const transaction = rows[0];
    if (!transaction) {
        throw new Error(`transaction ${id} was not found`);
    }

    return transaction;
}

export async function markSubmittedTransactionConfirmed(id: string): Promise<Transaction | undefined> {
    const rows = await db
        .update(transactions)
        .set({
            status: "confirmed",
            confirmedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(and(
            eq(transactions.id, id),
            eq(transactions.status, "submitted"),
        ))
        .returning();

    return rows[0];
}

export async function markSubmittedTransactionFailed(
    id: string,
    input: {
        errorCode: string;
        errorMessage: string;
        horizonError?: unknown;
    },
): Promise<Transaction | undefined> {
    const rows = await db
        .update(transactions)
        .set({
            status: "failed",
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            horizonError: input.horizonError ?? null,
            failedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(and(
            eq(transactions.id, id),
            eq(transactions.status, "submitted"),
        ))
        .returning();

    return rows[0];
}

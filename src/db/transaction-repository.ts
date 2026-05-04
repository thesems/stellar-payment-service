import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";

import { db } from "./client.js";
import { type NewTransaction, type Transaction, transactions } from "./schema.js";

type TransactionLookupField = "id" | "idempotencyKey" | "txHash";

async function findTransactionByField(
    field: TransactionLookupField,
    value: string,
): Promise<Transaction | undefined> {
    const column = field === "id"
        ? transactions.id
        : field === "idempotencyKey"
            ? transactions.idempotencyKey
            : transactions.txHash;

    const rows = await db
        .select()
        .from(transactions)
        .where(eq(column, value))
        .limit(1);

    return rows[0];
}

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
    return findTransactionByField("idempotencyKey", idempotencyKey);
}

export async function findTransactionById(id: string): Promise<Transaction | undefined> {
    return findTransactionByField("id", id);
}

export async function findTransactionByHash(txHash: string): Promise<Transaction | undefined> {
    return findTransactionByField("txHash", txHash);
}

export async function claimTransactionForSubmission(
    idempotencyKey: string,
): Promise<Transaction | undefined> {
    const rows = await db
        .update(transactions)
        .set({
            status: "submitting",
            updatedAt: new Date(),
        })
        .where(and(
            eq(transactions.idempotencyKey, idempotencyKey),
            eq(transactions.status, "created"),
        ))
        .returning();

    return rows[0];
}

export async function claimTransactionForSubmissionById(
    id: string,
): Promise<Transaction | undefined> {
    const rows = await db
        .update(transactions)
        .set({
            status: "submitting",
            updatedAt: new Date(),
        })
        .where(and(
            eq(transactions.id, id),
            eq(transactions.status, "created"),
        ))
        .returning();

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

export async function listTransactions(input: {
    account: string | undefined;
    limit: number;
    offset: number;
}): Promise<Transaction[]> {
    const conditions = [];

    if (input.account) {
        conditions.push(or(
            eq(transactions.sourceAccount, input.account),
            eq(transactions.destinationAccount, input.account),
        ));
    }

    const query = db
        .select()
        .from(transactions)
        .orderBy(desc(transactions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

    if (conditions.length > 0) {
        return query.where(and(...conditions));
    }

    return query;
}

export async function markTransactionSubmitted(
    id: string,
    input: {
        txHash: string;
        envelopeXdr: string;
        resultXdr: string | null;
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

export async function markSubmittingTransactionSubmitted(
    id: string,
    input: {
        txHash: string;
        envelopeXdr: string;
        resultXdr: string | null;
    },
): Promise<Transaction | undefined> {
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
        .where(and(
            eq(transactions.id, id),
            eq(transactions.status, "submitting"),
        ))
        .returning();

    return rows[0];
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
            or(
                eq(transactions.status, "submitted"),
                eq(transactions.status, "submitting"),
            ),
        ))
        .returning();

    return rows[0];
}

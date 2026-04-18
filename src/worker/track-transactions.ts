import { config } from "../config/env.js";
import {
  findSubmittedTransactions,
  markSubmittedTransactionConfirmed,
  markSubmittedTransactionFailed,
} from "../db/transaction-repository.js";
import type { Transaction } from "../db/schema.js";
import { parseHorizonError } from "../services/horizon-error-parser.js";
import { getTransactionByHash } from "../services/stellar.js";

let shuttingDown = false;

async function main(): Promise<void> {
  console.log("transaction tracker started", {
    pollIntervalMs: config.workerPollIntervalMs,
    submittedTimeoutMinutes: config.workerSubmittedTimeoutMinutes,
  });

  while (!shuttingDown) {
    await pollOnce();
    await sleep(config.workerPollIntervalMs);
  }
}

async function pollOnce(): Promise<void> {
  const transactions = await findSubmittedTransactions();

  for (const transaction of transactions) {
    await trackTransaction(transaction);
  }
}

async function trackTransaction(transaction: Transaction): Promise<void> {
  if (!transaction.txHash) return;

  if (isTimedOut(transaction)) {
    await markSubmittedTransactionFailed(transaction.id, {
      errorCode: "tracking_timeout",
      errorMessage: "Transaction stayed submitted too long without Horizon confirmation.",
    });
    console.warn("transaction tracking timed out", {
      id: transaction.id,
      txHash: transaction.txHash,
    });
    return;
  }

  try {
    const horizonTransaction = await getTransactionByHash(transaction.txHash);

    if (horizonTransaction.successful) {
      const confirmed = await markSubmittedTransactionConfirmed(transaction.id);
      if (confirmed) {
        console.log("transaction confirmed", {
          id: transaction.id,
          txHash: transaction.txHash,
        });
      }
      return;
    }

    await markSubmittedTransactionFailed(transaction.id, {
      errorCode: "tx_failed",
      errorMessage: "Horizon returned an unsuccessful transaction.",
      horizonError: horizonTransaction,
    });
    console.warn("transaction failed according to Horizon", {
      id: transaction.id,
      txHash: transaction.txHash,
    });
  } catch (err) {
    if (isHorizonNotFound(err)) {
      return;
    }

    await markSubmittedTransactionFailed(transaction.id, parseHorizonError(err));
    console.warn("transaction tracking failed", {
      id: transaction.id,
      txHash: transaction.txHash,
      err,
    });
  }
}

function isTimedOut(transaction: Transaction): boolean {
  const submittedAt = transaction.submittedAt ?? transaction.updatedAt;
  const timeoutMs = config.workerSubmittedTimeoutMinutes * 60 * 1000;
  return Date.now() - submittedAt.getTime() > timeoutMs;
}

function isHorizonNotFound(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 404;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGINT", () => {
  shuttingDown = true;
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

await main();

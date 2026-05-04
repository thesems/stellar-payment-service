import { config } from "../config/env.js";
import {
  findSubmittedTransactions,
  markSubmittedTransactionConfirmed,
  markSubmittedTransactionFailed,
} from "../db/transaction-repository.js";
import type { Transaction } from "../db/schema.js";
import { parseStellarError } from "../services/stellar-error-parser.js";
import { getTransactionByHash } from "../services/stellar.js";

const shutdownController = new AbortController();
let shutdownSignalCount = 0;

async function main(): Promise<void> {
  const { signal } = shutdownController;

  console.log("transaction tracker started", {
    pollIntervalMs: config.workerPollIntervalMs,
    submittedTimeoutMinutes: config.workerSubmittedTimeoutMinutes,
  });

  while (!signal.aborted) {
    await pollOnce(signal);
    if (!signal.aborted) {
      await sleep(config.workerPollIntervalMs, signal);
    }
  }

  console.log("transaction tracker stopped");
}

async function pollOnce(signal: AbortSignal): Promise<void> {
  const transactions = await findSubmittedTransactions();

  for (const transaction of transactions) {
    if (signal.aborted) return;
    await trackTransaction(transaction);
  }
}

async function trackTransaction(transaction: Transaction): Promise<void> {
  if (!transaction.txHash) return;

  if (isTimedOut(transaction)) {
    await markSubmittedTransactionFailed(transaction.id, {
      errorCode: "tracking_timeout",
      errorMessage: "Transaction stayed submitted too long without Stellar RPC confirmation.",
    });
    console.warn("transaction tracking timed out", {
      id: transaction.id,
      txHash: transaction.txHash,
    });
    return;
  }

  try {
    const stellarTransaction = await getTransactionByHash(transaction.txHash);

    if (stellarTransaction.status === "NOT_FOUND") {
      return;
    }

    if (stellarTransaction.status === "SUCCESS") {
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
      errorMessage: "Stellar RPC returned a failed transaction.",
      horizonError: toJsonSafe(stellarTransaction.raw),
    });
    console.warn("transaction failed according to Stellar RPC", {
      id: transaction.id,
      txHash: transaction.txHash,
    });
  } catch (err) {
    await markSubmittedTransactionFailed(transaction.id, parseStellarError(err));
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

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abortSleep);
      resolve();
    }, ms);

    const abortSleep = () => {
      clearTimeout(timeout);
      resolve();
    };

    signal.addEventListener("abort", abortSleep, { once: true });
  });
}

function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function requestShutdown(signal: NodeJS.Signals): void {
  shutdownSignalCount += 1;

  if (shutdownSignalCount === 1) {
    console.log("transaction tracker shutting down", { signal });
    shutdownController.abort();
    return;
  }

  console.warn("transaction tracker forced shutdown", { signal });
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.on("SIGINT", requestShutdown);
process.on("SIGTERM", requestShutdown);

await main();

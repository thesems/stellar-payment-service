import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  STELLAR_NETWORK: z.enum(["testnet"]).default("testnet"),
  STELLAR_HORIZON_URL: z.string().trim().url().default("https://horizon-testnet.stellar.org"),
  STELLAR_NETWORK_PASSPHRASE: z.string().trim().min(1).default("Test SDF Network ; September 2015"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_SUBMITTED_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(20),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  host: parsed.data.HOST,
  port: parsed.data.PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  stellarNetwork: parsed.data.STELLAR_NETWORK,
  stellarHorizonUrl: parsed.data.STELLAR_HORIZON_URL,
  stellarNetworkPassphrase: parsed.data.STELLAR_NETWORK_PASSPHRASE,
  workerPollIntervalMs: parsed.data.WORKER_POLL_INTERVAL_MS,
  workerSubmittedTimeoutMinutes: parsed.data.WORKER_SUBMITTED_TIMEOUT_MINUTES,
};

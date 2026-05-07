import "dotenv/config";
import { z } from "zod";

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  STELLAR_NETWORK: z.enum(["testnet"]).default("testnet"),
  STELLAR_HORIZON_URL: z.string().trim().url().default("https://horizon-testnet.stellar.org"),
  STELLAR_RPC_URL: z.string().trim().url().default("https://soroban-testnet.stellar.org"),
  STELLAR_NETWORK_PASSPHRASE: z.string().trim().min(1).default("Test SDF Network ; September 2015"),
  SOROSWAP_ROUTER_CONTRACT_ID: z.string().trim().regex(/^C[A-Z2-7]{55}$/).optional(),
  SEP10_ENABLED: z.preprocess(parseBoolean, z.boolean().default(false)),
  SEP10_HOME_DOMAINS: z.string().trim().min(1).default("localhost"),
  SEP10_WEB_AUTH_DOMAIN: z.string().trim().min(1).default("localhost"),
  SEP10_SIGNING_SECRET: z.string().trim().optional(),
  SEP10_JWT_SECRET: z.string().trim().optional(),
  SEP10_AUTH_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  SEP10_JWT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(86400),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_SUBMITTED_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(20),
  LOG_PRETTY: z.preprocess(parseBoolean, z.boolean().default(true)),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.SEP10_ENABLED) {
  if (!parsed.data.SEP10_SIGNING_SECRET) {
    console.error("Invalid configuration:");
    console.error({ SEP10_SIGNING_SECRET: ["SEP10_SIGNING_SECRET is required when SEP10_ENABLED=true"] });
    process.exit(1);
  }

  if (!parsed.data.SEP10_JWT_SECRET) {
    console.error("Invalid configuration:");
    console.error({ SEP10_JWT_SECRET: ["SEP10_JWT_SECRET is required when SEP10_ENABLED=true"] });
    process.exit(1);
  }
}

export const config = {
  host: parsed.data.HOST,
  port: parsed.data.PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  stellarNetwork: parsed.data.STELLAR_NETWORK,
  stellarHorizonUrl: parsed.data.STELLAR_HORIZON_URL,
  stellarRpcUrl: parsed.data.STELLAR_RPC_URL,
  stellarNetworkPassphrase: parsed.data.STELLAR_NETWORK_PASSPHRASE,
  soroswapRouterContractId: parsed.data.SOROSWAP_ROUTER_CONTRACT_ID ?? null,
  sep10Enabled: parsed.data.SEP10_ENABLED,
  sep10HomeDomains: parsed.data.SEP10_HOME_DOMAINS.split(",").map((value) => value.trim()).filter(Boolean),
  sep10WebAuthDomain: parsed.data.SEP10_WEB_AUTH_DOMAIN,
  sep10SigningSecret: parsed.data.SEP10_SIGNING_SECRET ?? null,
  sep10JwtSecret: parsed.data.SEP10_JWT_SECRET ?? null,
  sep10AuthTimeoutSeconds: parsed.data.SEP10_AUTH_TIMEOUT_SECONDS,
  sep10JwtTimeoutSeconds: parsed.data.SEP10_JWT_TIMEOUT_SECONDS,
  workerPollIntervalMs: parsed.data.WORKER_POLL_INTERVAL_MS,
  workerSubmittedTimeoutMinutes: parsed.data.WORKER_SUBMITTED_TIMEOUT_MINUTES,
  logPretty: parsed.data.LOG_PRETTY,
};

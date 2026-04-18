import Fastify from "fastify";

import { config } from "./config/env.js";
import { accountRoutes } from "./routes/accounts.js";
import { healthRoutes } from "./routes/health.js";
import { transactionRoutes } from "./routes/transactions.js";

const app = Fastify({ logger: true });
let shuttingDown = false;

async function main(): Promise<void> {
  try {
    await app.register(accountRoutes);
    await app.register(healthRoutes);
    await app.register(transactionRoutes);

    await app.listen({ host: config.host, port: config.port });
    app.log.info({ host: config.host, port: config.port }, "app started");
  } catch (err) {
    app.log.error(err);
    await shutdown("startup-failure");
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ signal }, "shutting down");

  await app.close();

  process.exit(0);
}

await main();

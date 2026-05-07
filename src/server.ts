import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { authRoutes } from "./routes/auth.js";
import { accountRoutes } from "./routes/accounts.js";
import { healthRoutes } from "./routes/health.js";
import { transactionRoutes } from "./routes/transactions.js";
import { swapRoutes } from "./routes/swaps.js";

const app = Fastify({ loggerInstance: createLogger(config.logPretty) });
let shuttingDown = false;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "../web/dist");

async function main(): Promise<void> {
  try {
    await app.register(accountRoutes);
    await app.register(authRoutes);
    await app.register(healthRoutes);
    await app.register(transactionRoutes);
    await app.register(swapRoutes);

    app.get("/*", async (request, reply) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return reply.callNotFound();
      }

      const requestPath = request.url.split("?")[0] ?? "/";
      const filePath = resolveWebPath(requestPath);

      if (!filePath) {
        return reply.callNotFound();
      }

      try {
        const body = await readFile(filePath);
        return reply.type(getContentType(filePath)).send(body);
      } catch {
        return reply.callNotFound();
      }
    });

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

function resolveWebPath(requestPath: string): string | null {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const hasExtension = path.extname(normalizedPath).length > 0;
  const candidate = path.resolve(webRoot, `.${normalizedPath}`);

  if (!candidate.startsWith(webRoot)) {
    return null;
  }

  if (hasExtension) {
    return candidate;
  }

  return path.resolve(webRoot, "./index.html");
}

function getContentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

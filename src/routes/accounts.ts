import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getAccount } from "../services/stellar.js";

const accountParamsSchema = z.object({
  address: z.string().trim().regex(/^G[A-Z2-7]{55}$/, "address must be a Stellar public key"),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/account/:address", async (request, reply) => {
    const params = accountParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "validation_error",
        details: params.error.flatten().fieldErrors,
      });
    }

    try {
      const account = await getAccount(params.data.address);

      return reply.send({
        address: account.accountId,
        sequence: account.sequence,
        balances: account.balances,
      });
    } catch (err) {
      const statusCode = isNotFoundError(err) ? 404 : 502;

      return reply.status(statusCode).send({
        error: statusCode === 404 ? "account_not_found" : "horizon_error",
        message: err instanceof Error ? err.message : "Unable to fetch Stellar account",
      });
    }
  });
}

function isNotFoundError(err: unknown): boolean {
  const record = typeof err === "object" && err !== null ? (err as Record<string, unknown>) : undefined;
  const response = record?.response;
  const responseRecord = typeof response === "object" && response !== null ? (response as Record<string, unknown>) : undefined;
  return responseRecord?.status === 404;
}

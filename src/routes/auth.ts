import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { buildChallengeTx, issueJwt, verifyChallengeTx } from "../services/sep10.js";
import { config } from "../config/env.js";

const authRequest = z.object({
    account: z.string().trim().regex(/^G[A-Z2-7]{55}$/, "account must be a Stellar public key"),
    memo: z.string().trim().min(1).max(28).optional(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
    app.get("/auth", async (request, reply) => {
        const query = authRequest.safeParse(request.query);
        if (!query.success) {
            return reply.status(400).send({
                error: "validation_error",
                details: query.error.flatten().fieldErrors,
            });
        }

        try {
            return reply.send({
                network_passphrase: config.stellarNetworkPassphrase,
                transaction: buildChallengeTx(query.data.account, query.data.memo),
            });
        } catch (error) {
            return reply.status(400).send({
                error: "auth_challenge_error",
                message: error instanceof Error ? error.message : "Unable to build SEP-10 challenge",
            });
        }
    });

    app.post("/auth", async (request, reply) => {
        const body = z.object({
            transaction: z.string().trim().min(1),
        }).safeParse(request.body);

        if (!body.success) {
            return reply.status(400).send({
                error: "validation_error",
                details: body.error.flatten().fieldErrors,
            });
        }

        try {
            const { account } = verifyChallengeTx(body.data.transaction);
            return reply.send({
                account,
                token: issueJwt(account),
            });
        } catch (error) {
            return reply.status(400).send({
                error: "auth_verification_error",
                message: error instanceof Error ? error.message : "Unable to verify SEP-10 challenge",
            });
        }
    });
}

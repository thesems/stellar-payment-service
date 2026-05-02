import Fastify from "fastify";
import { Keypair, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://localhost/test";
process.env.SEP10_ENABLED ??= "true";
process.env.SEP10_HOME_DOMAINS ??= "localhost";
process.env.SEP10_WEB_AUTH_DOMAIN ??= "localhost";
process.env.SEP10_SIGNING_SECRET ??= Keypair.random().secret();
process.env.SEP10_JWT_SECRET ??= "jwt-secret";

const { authRoutes } = await import("./auth.js");
const { verifyJwt } = await import("../services/sep10.js");

describe("SEP-10 auth", () => {
  beforeEach(() => {
    process.env.SEP10_ENABLED = "true";
  });

  it("builds and verifies a challenge transaction", async () => {
    const app = await buildTestApp();
    const client = Keypair.random();

    const challengeResponse = await app.inject({
      method: "GET",
      url: `/auth?account=${client.publicKey()}`,
    });

    expect(challengeResponse.statusCode).toBe(200);

    const challenge = challengeResponse.json() as { transaction: string };
    const tx = TransactionBuilder.fromXDR(challenge.transaction, "Test SDF Network ; September 2015");
    tx.sign(client);

    const response = await app.inject({
      method: "POST",
      url: "/auth",
      payload: {
        transaction: tx.toEnvelope().toXDR("base64"),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { account: string; token: string };
    expect(body.account).toBe(client.publicKey());
    expect(verifyJwt(body.token).sub).toBe(client.publicKey());

    await app.close();
  });

  it("rejects malformed auth requests", async () => {
    const app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/auth?account=not-a-stellar-key",
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

async function buildTestApp() {
  const app = Fastify();
  await app.register(authRoutes);
  return app;
}

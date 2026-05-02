import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { Keypair, WebAuth } from "@stellar/stellar-sdk";

import { config } from "../config/env.js";

const jwt = createRequire(import.meta.url)("jsonwebtoken") as {
  sign: (
    payload: Record<string, unknown>,
    secret: string,
    options: {
      algorithm: "HS256";
      issuer: string;
      subject: string;
      expiresIn: number;
      jwtid: string;
    },
  ) => string;
  verify: (
    token: string,
    secret: string,
    options: {
      algorithms: ["HS256"];
      issuer: string;
    },
  ) => Record<string, unknown>;
};

type JwtClaims = {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
};

export function buildChallengeTx(account: string, memo?: string): string {
  ensureSep10Enabled();

  return WebAuth.buildChallengeTx(
    getServerKeypair(),
    account,
    config.sep10HomeDomains[0] ?? config.sep10WebAuthDomain,
    config.sep10AuthTimeoutSeconds,
    config.stellarNetworkPassphrase,
    config.sep10WebAuthDomain,
    memo ?? null,
  );
}

export function verifyChallengeTx(challengeTx: string): { account: string; memo: string | null } {
  ensureSep10Enabled();

  const serverKeypair = getServerKeypair();
  const [homeDomain] = config.sep10HomeDomains;
  if (!homeDomain) {
    throw new Error("At least one SEP10_HOME_DOMAINS value is required");
  }

  const { clientAccountID, memo } = WebAuth.readChallengeTx(
    challengeTx,
    serverKeypair.publicKey(),
    config.stellarNetworkPassphrase,
    homeDomain,
    config.sep10WebAuthDomain,
  );

  const verified = WebAuth.verifyChallengeTxSigners(
    challengeTx,
    serverKeypair.publicKey(),
    config.stellarNetworkPassphrase,
    [clientAccountID],
    homeDomain,
    config.sep10WebAuthDomain,
  );

  if (!verified.includes(clientAccountID)) {
    throw new Error("Challenge transaction was not signed by the authenticated account");
  }

  return { account: clientAccountID, memo };
}

export function issueJwt(account: string): string {
  ensureSep10Enabled();

  return jwt.sign({}, config.sep10JwtSecret ?? "", {
    algorithm: "HS256",
    issuer: config.sep10WebAuthDomain,
    subject: account,
    expiresIn: config.sep10JwtTimeoutSeconds,
    jwtid: cryptoRandomId(),
  });
}

export function verifyJwt(token: string): JwtClaims {
  ensureSep10Enabled();

  const payload = jwt.verify(token, config.sep10JwtSecret ?? "", {
    algorithms: ["HS256"],
    issuer: config.sep10WebAuthDomain,
  });

  if (
    typeof payload.iss !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    typeof payload.jti !== "string"
  ) {
    throw new Error("Invalid JWT payload");
  }

  return payload as JwtClaims;
}

function getServerKeypair(): Keypair {
  if (!config.sep10SigningSecret) {
    throw new Error("SEP10_SIGNING_SECRET is required");
  }

  return Keypair.fromSecret(config.sep10SigningSecret);
}

function ensureSep10Enabled(): void {
  if (!config.sep10Enabled) {
    throw new Error("SEP-10 is disabled");
  }
}

function cryptoRandomId(): string {
  return randomUUID();
}

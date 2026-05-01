import "dotenv/config";

import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  XdrLargeInt,
  rpc,
} from "@stellar/stellar-sdk";

const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const rpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const horizonUrl = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const sourceSecret = process.env.SOURCE_SECRET;
const amount = process.env.AMOUNT_XLM ?? "1.0000000";
const destinationPublicKey = process.env.DESTINATION_PUBLIC_KEY ?? Keypair.random().publicKey();

if (!sourceSecret) {
  throw new Error("SOURCE_SECRET is required");
}

if (!StrKey.isValidEd25519SecretSeed(sourceSecret)) {
  throw new Error("SOURCE_SECRET must be a valid Stellar secret seed starting with S...");
}

if (!StrKey.isValidEd25519PublicKey(destinationPublicKey)) {
  throw new Error("DESTINATION_PUBLIC_KEY must be a valid Stellar public key starting with G...");
}

const sourceKeypair = Keypair.fromSecret(sourceSecret);
const sourcePublicKey = sourceKeypair.publicKey();
const amountStroops = parseXlmToStroops(amount);

if (amountStroops <= 0n) {
  throw new Error("AMOUNT_XLM must be greater than 0");
}

const rpcServer = new rpc.Server(rpcUrl);
const horizonServer = new Horizon.Server(horizonUrl);

console.log("Testing native XLM SAC transfer to a possibly-unfunded G account");
console.log({
  rpcUrl,
  horizonUrl,
  networkPassphrase,
  sourcePublicKey,
  destinationPublicKey,
  amountXlm: amount,
  amountStroops: amountStroops.toString(),
});

const destinationExistsBefore = await accountExists(destinationPublicKey);
console.log("Destination exists before transfer:", destinationExistsBefore);

const sourceAccount = await rpcServer.getAccount(sourcePublicKey);
const nativeSacContractId = Asset.native().contractId(networkPassphrase);
const nativeSac = new Contract(nativeSacContractId);

console.log("Native XLM SAC contract:", nativeSacContractId);

const tx = new TransactionBuilder(sourceAccount, {
  fee: BASE_FEE,
  networkPassphrase,
})
  .addOperation(
    nativeSac.call(
      "transfer",
      Address.fromString(sourcePublicKey).toScVal(),
      Address.fromString(destinationPublicKey).toScVal(),
      new XdrLargeInt("i128", amountStroops).toI128(),
    ),
  )
  .setTimeout(300)
  .build();

console.log("Preparing Soroban transaction...");
const preparedTx = await rpcServer.prepareTransaction(tx);
preparedTx.sign(sourceKeypair);

console.log("Submitting transaction...");
const sent = await rpcServer.sendTransaction(preparedTx);
console.log("Submission:", {
  status: sent.status,
  hash: sent.hash,
  latestLedger: sent.latestLedger,
});

if (sent.status === "ERROR") {
  console.error("RPC rejected the transaction before ledger inclusion.");
  console.error(sent.errorResult?.toXDR("base64") ?? sent);
  process.exit(1);
}

console.log("Polling transaction...");
const result = await pollRawTransaction(sent.hash);
console.log("Transaction result:", {
  status: result.status,
  hash: result.txHash ?? sent.hash,
  latestLedger: result.latestLedger,
});

if (result.status !== "SUCCESS") {
  console.error("Transaction did not succeed.");
  console.error(result);
  process.exit(1);
}

const destinationExistsAfter = await accountExists(destinationPublicKey);
console.log("Destination exists after transfer:", destinationExistsAfter);

if (destinationExistsAfter) {
  const account = await horizonServer.loadAccount(destinationPublicKey);
  console.log("Destination balances:", account.balances);
}

async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await horizonServer.loadAccount(publicKey);
    return true;
  } catch (error) {
    if (isHorizonNotFound(error)) {
      return false;
    }

    throw error;
  }
}

async function pollRawTransaction(hash: string): Promise<rpc.Api.RawGetTransactionResponse> {
  let latestResult: rpc.Api.RawGetTransactionResponse | undefined;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    latestResult = await rpcServer._getTransaction(hash);

    if (latestResult.status !== "NOT_FOUND") {
      return latestResult;
    }

    await sleep(1000);
  }

  if (!latestResult) {
    throw new Error("No transaction polling result returned");
  }

  return latestResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isHorizonNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    error.response.status === 404
  );
}

function parseXlmToStroops(value: string): bigint {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d{0,7}))?$/.exec(trimmed);

  if (!match) {
    throw new Error("AMOUNT_XLM must be a decimal string with at most 7 fractional digits");
  }

  const wholePart = match[1];
  if (!wholePart) {
    throw new Error("AMOUNT_XLM must include a whole-number part");
  }

  const whole = BigInt(wholePart);
  const fractional = (match[2] ?? "").padEnd(7, "0");
  return whole * 10_000_000n + BigInt(fractional);
}

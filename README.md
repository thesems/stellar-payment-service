# Stellar Payment Service

Backend service for constructing, submitting, and tracking Stellar testnet transactions.

The project demonstrates practical Stellar backend integration: transaction construction with `@stellar/stellar-sdk`, Horizon submission and reads, idempotent payment requests, durable transaction state, and asynchronous lifecycle tracking.

This is a testnet learning project. It accepts source secret keys directly for local experimentation; a production system should use a proper custody/signing model or a non-custodial wallet signing flow.

It also serves a small browser UI from the same Fastify process. The frontend is a React app in [`web/`](./web), built with Vite, and is available at the service root after a frontend build.

## Implemented

- Native XLM payment preparation and submission on Stellar testnet.
- Idempotency via unique `idempotency_key`.
- Persistent transaction state in Postgres.
- Transaction lookup by internal UUID or Stellar hash.
- Horizon account lookup for balances and sequence.
- Horizon error parsing for common result codes such as `op_underfunded` and `op_no_destination`.
- Single polling worker for `submitted -> confirmed` tracking.
- React/Vite browser UI support for Freighter connect, sign, and submit flows.
- Vitest coverage for the `/tx/prepare` and `/tx/submit` flows.

## Architecture

```text
Fastify API
  -> Drizzle/Postgres
  -> Stellar SDK
  -> Horizon testnet

Worker
  -> submitted transactions
  -> Horizon transaction lookup
  -> confirmed/failed update
```

The API owns validation, idempotency, transaction building, signing, and submission. The worker polls Horizon to move submitted transactions into confirmed or failed states.

## API

### `POST /tx/prepare`

Builds an unsigned native XLM payment transaction for wallet signing.

```json
{
  "source_account": "G...",
  "destination": "G...",
  "amount": "1.0000000",
  "asset": { "type": "native" },
  "memo": "demo payment"
}
```

The response contains the Stellar network passphrase and unsigned transaction envelope XDR.

### `POST /tx/submit`

Submits a wallet-signed native XLM payment.

```json
{
  "idempotency_key": "xlm-test-001",
  "signed_transaction": "AAAA..."
}
```

First request returns `201`. A retry with the same `idempotency_key` and the same signed transaction returns `200` and the same transaction record without submitting a second Stellar transaction.

### `GET /tx/:id`

Fetches a transaction by internal UUID or Stellar transaction hash.

### `GET /account/:address`

Fetches account sequence and balances through Horizon.

### `GET /health`

Basic health check.

## Web UI

The service root serves a small static frontend that exercises the four main endpoints in production:

- `GET /health`
- `GET /account/:address`
- `POST /tx/prepare`
- `POST /tx/submit`
- `GET /tx/:id`

Open the service root in a browser after building the frontend and starting the API. During development, `npm run dev` starts the Fastify API and the Vite frontend together, and you should open the Vite URL on `http://localhost:5173`.

For a production-style bundle, run `npm run build` and then `npm start`.

## Testnet Demo

Generate a disposable testnet keypair:

```bash
node --input-type=module -e 'import { Keypair } from "@stellar/stellar-sdk"; const k = Keypair.random(); console.log({ publicKey: k.publicKey(), secret: k.secret() });'
```

Fund it:

```bash
curl "https://friendbot.stellar.org?addr=G_PUBLIC_KEY"
```

Prepare a payment:

```bash
curl -i -X POST http://localhost:3001/tx/prepare \
  -H 'content-type: application/json' \
  -d '{
    "source_account": "G_SOURCE_ACCOUNT",
    "destination": "G_DESTINATION",
    "amount": "1.0000000",
    "memo": "demo payment"
  }'
```

Then submit the wallet-signed XDR:

```bash
curl -i -X POST http://localhost:3001/tx/submit \
  -H 'content-type: application/json' \
  -d '{
    "idempotency_key": "xlm-test-001",
    "signed_transaction": "AAAA..."
  }'
```

Retry the submit with the same `idempotency_key` and `signed_transaction` to verify idempotency, then query the transaction by returned ID or hash.

## Scripts

```bash
npm run dev          # API
npm run worker:tx    # polling worker
npm run lint         # type-check
npm run test:run     # tests
npm run db:migrate   # apply migrations
```

## Logging

Set `LOG_PRETTY=false` to switch back to JSON logs. The default is pretty, human-readable output for local development.

## Protocol 26 SAC Account Activation Test

This script tests whether the native XLM Stellar Asset Contract can activate a fresh `G...` account by transferring XLM to it.

```bash
SOURCE_SECRET=S_SOURCE_SECRET npm run test:sac-create-account
```

By default, it generates a fresh destination public key, transfers `1.0000000` XLM through the native XLM SAC on testnet, polls the transaction, and checks whether the destination account exists afterward.

Optional environment variables:

```bash
DESTINATION_PUBLIC_KEY=G_DESTINATION # use a specific unfunded destination
AMOUNT_XLM=1.0000000                 # transfer amount, max 7 decimal places
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
```

## Scope

Implemented: testnet XLM payment preparation and submission, idempotent submission, Horizon reads, persisted lifecycle state, polling confirmation worker, React/Vite browser UI, basic tests.

Not implemented: mainnet, authentication, production custody, issued asset payments, Soroban calls.

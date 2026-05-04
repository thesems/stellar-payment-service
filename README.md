# Stellar Payment Service

Backend service for constructing, submitting, and tracking Stellar testnet transactions.

The project demonstrates practical Stellar backend integration: transaction construction with `@stellar/stellar-sdk`, Stellar RPC submission and tracking, Horizon account reads, idempotent payment requests, durable transaction state, and asynchronous lifecycle tracking.

This is a testnet learning project built around a non-custodial wallet signing flow. The browser UI uses Freighter to sign transactions and the backend submits them through Stellar RPC.

It also serves a small browser UI from the same Fastify process. The frontend is a React app in [`web/`](./web), built with Vite, and is available at the service root after a frontend build.

## Implemented

- Native XLM and classic issued-asset payment preparation and submission on Stellar testnet.
- Idempotency via unique `idempotency_key` during transaction creation.
- Persistent transaction state in Postgres.
- Transaction lookup by internal UUID or Stellar hash.
- Stellar RPC account sequence lookup, transaction submission, and transaction tracking.
- Horizon account lookup for balance display.
- Stellar error parsing for common result codes such as `op_underfunded` and `op_no_destination`.
- Single polling worker for `submitted -> confirmed` tracking.
- React/Vite browser UI support for a Freighter wallet-based submit flow.
- Vitest coverage for the `/tx/prepare` and `/tx/submit` flows.

## Architecture

```text
Fastify API
  -> Drizzle/Postgres
  -> Stellar SDK
  -> Stellar RPC testnet for sequence lookup and submission
  -> Horizon testnet for balance reads

Worker
  -> submitted transactions
  -> Stellar RPC transaction lookup
  -> confirmed/failed update
```

The API owns validation, idempotency, transaction building, and submission. Wallets own signing. The worker polls Stellar RPC to move submitted transactions into confirmed or failed states.

## API

### `POST /tx/prepare`

Creates a transaction with status `created` and stores an unsigned Stellar payment transaction for wallet signing.

```json
{
  "idempotency_key": "xlm-test-001",
  "source_account": "G...",
  "destination": "G...",
  "amount": "1.0000000",
  "asset": { "type": "native" },
  "memo": "demo payment"
}
```

For classic issued assets such as USDC or EURC, pass the exact asset identity:

```json
{
  "asset": {
    "type": "credit_alphanum4",
    "code": "USDC",
    "issuer": "G..."
  }
}
```

Issued assets are identified by both code and issuer. The source account must have enough balance for the requested asset, and the destination account must already have a trustline for that exact asset unless the destination is the issuer.

The response contains the transaction record, Stellar network passphrase, and unsigned transaction envelope XDR. This is used by the wallet flow in the browser UI.

### `POST /tx/submit`

Submits a wallet-signed payment for an existing `created` transaction.

```json
{
  "transaction_id": "8b59b7b4-d03b-48e1-89d3-8b9ff89d2ec5",
  "signed_transaction": "AAAA..."
}
```

The signed transaction must match the prepared transaction stored on the existing transaction record. `/tx/submit` does not create new transaction records.

### `GET /tx/:id`

Fetches a transaction by internal UUID or Stellar transaction hash.

### `GET /account/:address`

Fetches account sequence and balances through Horizon.

### `GET /health`

Basic health check.

## Web UI

The service root serves a small static frontend that exercises the wallet-based payment flow in production:

- `GET /health`
- `GET /account/:address`
- `POST /tx/prepare`
- `POST /tx/submit`
- `GET /tx/:id`

Open the service root in a browser after building the frontend and starting the API. During development, `npm run dev` starts the Fastify API and the Vite frontend together, and you should open the Vite URL on `http://localhost:5173`.

For a production-style bundle, run `npm run build` and then `npm start`.

## Testnet Demo

Connect a wallet on Stellar testnet, then create a prepared transaction:

```bash
curl -i -X POST http://localhost:3001/tx/prepare \
  -H 'content-type: application/json' \
  -d '{
    "idempotency_key": "xlm-test-001",
    "source_account": "G_SOURCE_ACCOUNT",
    "destination": "G_DESTINATION",
    "amount": "1.0000000",
    "memo": "demo payment"
  }'
```

Then sign the returned `prepared_transaction` in Freighter and submit the signed XDR for the returned transaction ID:

```bash
curl -i -X POST http://localhost:3001/tx/submit \
  -H 'content-type: application/json' \
  -d '{
    "transaction_id": "TRANSACTION_UUID",
    "signed_transaction": "AAAA..."
  }'
```

Query the transaction by returned ID or hash to track submission and confirmation.

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

Implemented: testnet XLM and classic issued-asset payment preparation, wallet-based submission through Stellar RPC, idempotent submission, Horizon balance reads, persisted lifecycle state, polling confirmation worker, React/Vite browser UI, basic tests.

Not implemented: mainnet, authentication, production custody, Soroban calls.

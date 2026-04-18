# Stellar Payment Service

Backend service for constructing, submitting, and tracking Stellar testnet transactions.

The project demonstrates practical Stellar backend integration: transaction construction with `@stellar/stellar-sdk`, Horizon submission and reads, idempotent payment requests, durable transaction state, and asynchronous lifecycle tracking.

This is a testnet learning project. It accepts source secret keys directly for local experimentation; a production system should use a proper custody/signing model or a non-custodial wallet signing flow.

## Implemented

- Native XLM payment submission on Stellar testnet.
- Idempotency via unique `idempotency_key`.
- Persistent transaction state in Postgres.
- Transaction lookup by internal UUID or Stellar hash.
- Horizon account lookup for balances and sequence.
- Horizon error parsing for common result codes such as `op_underfunded` and `op_no_destination`.
- Single polling worker for `submitted -> confirmed` tracking.
- Vitest coverage for the `POST /tx/payment` idempotency branch.

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

### `POST /tx/payment`

Creates an idempotent native XLM payment.

```json
{
  "idempotency_key": "xlm-test-001",
  "source_secret": "S...",
  "destination": "G...",
  "amount": "1.0000000",
  "asset": { "type": "native" },
  "memo": "demo payment"
}
```

First request returns `201`. A retry with the same `idempotency_key` returns `200` and the same transaction record without submitting a second Stellar transaction.

### `GET /tx/:id`

Fetches a transaction by internal UUID or Stellar transaction hash.

### `GET /account/:address`

Fetches account sequence and balances through Horizon.

### `GET /health`

Basic health check.

## Testnet Demo

Generate a disposable testnet keypair:

```bash
node --input-type=module -e 'import { Keypair } from "@stellar/stellar-sdk"; const k = Keypair.random(); console.log({ publicKey: k.publicKey(), secret: k.secret() });'
```

Fund it:

```bash
curl "https://friendbot.stellar.org?addr=G_PUBLIC_KEY"
```

Submit a payment:

```bash
curl -i -X POST http://localhost:3001/tx/payment \
  -H 'content-type: application/json' \
  -d '{
    "idempotency_key": "xlm-test-001",
    "source_secret": "S_SOURCE_SECRET",
    "destination": "G_DESTINATION",
    "amount": "1.0000000",
    "asset": { "type": "native" },
    "memo": "demo payment"
  }'
```

Retry the same request to verify idempotency, then query the transaction by returned ID or hash.

## Scripts

```bash
npm run dev          # API
npm run worker:tx    # polling worker
npm run lint         # type-check
npm run test:run     # tests
npm run db:migrate   # apply migrations
```

## Scope

Implemented: testnet XLM payments, idempotent submission, Horizon reads, persisted lifecycle state, polling confirmation worker, basic tests.

Not implemented: mainnet, authentication, production custody, Freighter signing flow, issued asset payments, Soroban calls.

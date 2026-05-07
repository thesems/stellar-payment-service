ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "protocol" text NOT NULL DEFAULT 'stellar';
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "network" text NOT NULL DEFAULT 'testnet';
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "chain_id" text;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "source_address" text;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "destination_address" text;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "prepared_payload" text;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "submitted_payload" text;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "result_payload" text;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "provider_error" jsonb;

UPDATE "transactions"
SET
  "source_address" = COALESCE("source_address", "source_account"),
  "destination_address" = COALESCE("destination_address", "destination_account"),
  "prepared_payload" = COALESCE("prepared_payload", "prepared_xdr"),
  "submitted_payload" = COALESCE("submitted_payload", "envelope_xdr"),
  "result_payload" = COALESCE("result_payload", "result_xdr"),
  "provider_error" = COALESCE("provider_error", "horizon_error")
WHERE
  "source_address" IS NULL
  OR "destination_address" IS NULL
  OR "prepared_payload" IS NULL
  OR "submitted_payload" IS NULL
  OR "result_payload" IS NULL
  OR "provider_error" IS NULL;

ALTER TABLE "transactions" ALTER COLUMN "source_address" SET NOT NULL;

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'payment';
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "intent" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "transactions" ALTER COLUMN "destination_account" DROP NOT NULL;
ALTER TABLE "transactions" ALTER COLUMN "asset_type" DROP NOT NULL;
ALTER TABLE "transactions" ALTER COLUMN "amount" DROP NOT NULL;
ALTER TABLE "transactions" ALTER COLUMN "memo" DROP NOT NULL;

UPDATE "transactions"
SET "intent" = jsonb_build_object(
  'source_account', "source_account",
  'destination', "destination_account",
  'amount', "amount",
  'asset', CASE
    WHEN "asset_type" IS NULL THEN NULL
    WHEN "asset_type" = 'native' THEN jsonb_build_object('type', 'native')
    ELSE jsonb_build_object(
      'type', "asset_type",
      'code', "asset_code",
      'issuer', "asset_issuer"
    )
  END,
  'memo', "memo"
)
WHERE "kind" = 'payment';

CREATE TYPE "public"."asset_type" AS ENUM('native', 'credit_alphanum4', 'credit_alphanum12');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('created', 'submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "transaction_status" NOT NULL,
	"source_account" text NOT NULL,
	"destination_account" text NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"asset_code" text,
	"asset_issuer" text,
	"amount" text NOT NULL,
	"memo" text,
	"tx_hash" text,
	"envelope_xdr" text,
	"result_xdr" text,
	"error_code" text,
	"error_message" text,
	"horizon_error" jsonb,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "transactions_tx_hash_unique" UNIQUE("tx_hash")
);

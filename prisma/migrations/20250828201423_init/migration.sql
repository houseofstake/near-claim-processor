-- CreateTable
CREATE TABLE "public"."projects" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "num_entitlements" INTEGER,
    "total_claim_value" TEXT,
    "total_claimed" TEXT NOT NULL DEFAULT '0',
    "root_hash" TEXT,
    "build_elapsed" DOUBLE PRECISION,
    "total_elapsed" DOUBLE PRECISION,
    "build_start_time" TIMESTAMP(3),
    "end_generate_time" TIMESTAMP(3),
    "generated" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."proofs" (
    "project_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "tree_index" INTEGER NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimed_at" TIMESTAMP(3),
    "claimed_tx_hash" TEXT,
    "gcs_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proofs_pkey" PRIMARY KEY ("project_id","address")
);

-- CreateIndex
CREATE INDEX "proofs_project_id_idx" ON "public"."proofs"("project_id");

-- CreateIndex
CREATE INDEX "proofs_address_idx" ON "public"."proofs"("address");

-- CreateIndex
CREATE INDEX "proofs_claimed_idx" ON "public"."proofs"("claimed");

-- AddForeignKey
ALTER TABLE "public"."proofs" ADD CONSTRAINT "proofs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

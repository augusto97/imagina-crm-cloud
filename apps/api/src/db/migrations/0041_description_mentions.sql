-- v0.1.134 — Menciones desde la DESCRIPCIÓN de un registro, no sólo desde un
-- comentario.
--
-- `comment_id` pasa a ser nullable: una mención escrita en el documento del
-- registro no cuelga de ningún comentario. `source` dice de dónde vino, para
-- que la campana pueda mostrar el contexto correcto.
ALTER TABLE "mentions" ALTER COLUMN "comment_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "mentions" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'comment';

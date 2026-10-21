-- Comentarios internos vs. visibles para el cliente del portal. Todo lo que ya
-- existía queda INTERNO (lo que el equipo habló entre sí nunca se le muestra al
-- cliente por accidente), salvo lo que escribió el propio cliente desde su
-- portal: su autor es un usuario con membresía `client` en esa empresa.
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "visibility" varchar(16) NOT NULL DEFAULT 'internal';--> statement-breakpoint
UPDATE "comments" c SET "visibility" = 'client'
WHERE EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."user_id" = c."user_id" AND m."tenant_id" = c."tenant_id" AND m."role" = 'client'
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_record_visibility_ix" ON "comments" ("record_id", "visibility") WHERE "deleted_at" IS NULL;--> statement-breakpoint
-- Archivos subidos a un formulario público que todavía no se envió: no cuentan
-- para el almacenamiento del plan hasta que llegan con su respuesta.
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "pending_form_id" bigint;

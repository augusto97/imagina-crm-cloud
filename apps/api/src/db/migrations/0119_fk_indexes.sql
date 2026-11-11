-- Rendimiento — índices por las FKs que todavía no tenían uno y un índice
-- muerto menos. Sin CONCURRENTLY: el migrador corre cada archivo en una
-- transacción (mismo criterio que 0063); son tablas chicas frente a `records`.

-- (1) `mentions.comment_id` → comments ON DELETE CASCADE. Purgar la papelera
-- borra registros → cascada a sus comentarios → y por CADA comentario borrado
-- el disparador de la FK buscaba en `mentions` por `comment_id` sin índice:
-- un recorrido de la tabla entera (la de todas las empresas) por comentario.
CREATE INDEX IF NOT EXISTS "mentions_comment_fk_ix" ON "mentions" ("comment_id") WHERE "comment_id" IS NOT NULL;--> statement-breakpoint

-- (2) `list_id` → lists ON DELETE CASCADE en tablas que no tenían NINGÚN
-- índice que empezara por esa columna: borrar una lista del todo (purga de la
-- papelera, borrar una empresa) recorría cada una entera. La cascada no pasa
-- por la RLS, así que un índice que empieza por `tenant_id` no le sirve.
CREATE INDEX IF NOT EXISTS "comments_list_fk_ix" ON "comments" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_list_fk_ix" ON "mentions" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurrences_list_fk_ix" ON "recurrences" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_list_fk_ix" ON "payment_links" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_links_list_fk_ix" ON "portal_links" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_slug_history_list_fk_ix" ON "list_slug_history" ("list_id");--> statement-breakpoint

-- (3) El GIN de trigramas sobre `records.description_text` (0051) ya no lo
-- usa nada: la búsqueda compara un texto armado con `~ ALL(...)`
-- (search-sql.ts) y la condición `ILIKE` sobre la descripción dejó de
-- componerse. Se pagaba en cada escritura de una descripción (hasta 512 KB de
-- trigramas) y el planificador lo evaluaba en cada consulta de la tabla
-- compartida (el argumento de ADR-S32).
DROP INDEX IF EXISTS "records_description_text_trgm_idx";

-- v0.1.400 — Los nombres de las conexiones de WhatsApp.
--
-- La app nueva es Whats (whats.imagina.cloud) y WAS (was.imagina.cloud) es la
-- versión ANTERIOR, que sigue funcionando. En v0.1.389 quedaron al revés: la
-- nueva se llamaba «WhatsApp (WAS)» y la anterior «WhatsApp (WAS anterior)», y
-- ese nombre quedó GRABADO en cada conexión (es lo que aparece al elegirla en
-- una automatización). Se corrigen sólo las que siguen con el nombre
-- automático: una conexión que alguien renombró a mano no se toca. El orden
-- importa: primero se libera «WhatsApp (WAS)» y después lo toma la anterior.
-- Si el nombre nuevo ya lo usa otra conexión de la empresa, se deja como está
-- (el nombre es único por empresa).
UPDATE "connections" AS c
SET "name" = left('WhatsApp (Whats)' || substr(c."name", length('WhatsApp (WAS)') + 1), 120)
WHERE c."provider" = 'whatsapp_web'
  AND coalesce(c."config" ->> 'custom_name', '') <> 'true'
  AND c."name" LIKE 'WhatsApp (WAS)%'
  AND NOT EXISTS (
      SELECT 1 FROM "connections" AS o
      WHERE o."tenant_id" = c."tenant_id"
        AND o."id" <> c."id"
        AND lower(o."name") = lower(left('WhatsApp (Whats)' || substr(c."name", length('WhatsApp (WAS)') + 1), 120))
  );--> statement-breakpoint
UPDATE "connections" AS c
SET "name" = 'WhatsApp (WAS)' || substr(c."name", length('WhatsApp (WAS anterior)') + 1)
WHERE c."provider" = 'whatsapp'
  AND coalesce(c."config" ->> 'custom_name', '') <> 'true'
  AND c."name" LIKE 'WhatsApp (WAS anterior)%'
  AND NOT EXISTS (
      SELECT 1 FROM "connections" AS o
      WHERE o."tenant_id" = c."tenant_id"
        AND o."id" <> c."id"
        AND lower(o."name") = lower('WhatsApp (WAS)' || substr(c."name", length('WhatsApp (WAS anterior)') + 1))
  );

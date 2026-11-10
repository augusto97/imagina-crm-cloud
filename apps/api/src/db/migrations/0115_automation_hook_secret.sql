-- v0.1.399 — Webhook entrante: secreto opcional.
--
-- Además del token de la URL, una automatización puede pedir un secreto en la
-- cabecera `X-Webhook-Secret` (o `Authorization: Bearer`). Se guarda sólo su
-- huella (SHA-256) y los últimos 4 caracteres para reconocerlo: nunca el
-- secreto en claro, ni en el `trigger_config` (que leen el asistente y el MCP).
ALTER TABLE "automation_hooks" ADD COLUMN IF NOT EXISTS "secret_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "automation_hooks" ADD COLUMN IF NOT EXISTS "secret_hint" varchar(8);

-- H1 — Notificaciones push (Web Push con VAPID).
--
-- Una SUSCRIPCIÓN es un dispositivo (navegador + origen) de UNA persona en UNA
-- empresa: el endpoint del servicio de push del navegador y sus dos llaves
-- (p256dh y auth) con las que se cifra cada mensaje (RFC 8291). Está atada a
-- la SESIÓN con la que se activó (`session_id` = el id público de la sesión,
-- un hash del token): al cerrar esa sesión —o al vencer, revocarse, cambiar la
-- contraseña o desactivar la cuenta— el dispositivo deja de recibir avisos.
-- Un servicio que responde 404/410 la borra; varios fallos seguidos también.
-- No viaja en la migración de empresa: el endpoint sólo acepta mensajes
-- firmados con las llaves VAPID de ESTE servidor.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "endpoint" text NOT NULL,
    "p256dh" varchar(120) NOT NULL,
    "auth" varchar(60) NOT NULL,
    "endpoint_hash" varchar(32) NOT NULL,
    "session_id" varchar(32),
    "user_agent" varchar(300) NOT NULL DEFAULT '',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "last_used_at" timestamptz,
    "last_error" varchar(300),
    "failures" integer NOT NULL DEFAULT 0,
    CONSTRAINT "push_subscriptions_endpoint_ux" UNIQUE ("tenant_id", "endpoint_hash")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_ix" ON "push_subscriptions" ("tenant_id", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_fk_ix" ON "push_subscriptions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_session_ix" ON "push_subscriptions" ("session_id");--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "push_subscriptions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "push_subscriptions" TO imagina_app;

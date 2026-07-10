-- Auditoría de impersonación de soporte (ADR-S15 F5). Registra quién (operador)
-- impersonó a quién y hasta cuándo. Global (sin RLS): es un log de plataforma,
-- append-only, que sólo ve el superadmin.
CREATE TABLE IF NOT EXISTS "impersonation_log" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "actor_user_id" bigint NOT NULL REFERENCES "users"("id"),
    "target_user_id" bigint NOT NULL REFERENCES "users"("id"),
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "expires_at" timestamptz NOT NULL,
    "ended_at" timestamptz
);

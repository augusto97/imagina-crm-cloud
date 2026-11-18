-- v0.1.441 (G1) — API pública REST con tokens personales.
--
-- Un token sirve para UNA cosa: `mcp` (conectar Claude u otro asistente) o
-- `api` (un programa por la API REST: n8n, Make, un script). Los tokens que ya
-- existían son `mcp` y NO ganan acceso a la API por actualizar.
ALTER TABLE "personal_access_tokens" ADD COLUMN IF NOT EXISTS "use" varchar(8) DEFAULT 'mcp' NOT NULL;

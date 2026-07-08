-- Rol de aplicación NO-superuser: los superusers bypassean RLS por diseño
-- de Postgres (incluso con FORCE), así que toda transacción tenant-scoped
-- hace `SET LOCAL ROLE imagina_app` (ver src/db/tenant-tx.ts). Con esto las
-- policies aplican de verdad aunque la conexión del pool sea superuser
-- (compose de dev, Testcontainers). En producción el usuario de conexión
-- es miembro de este rol.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'imagina_app') THEN
        CREATE ROLE imagina_app NOLOGIN;
    END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO imagina_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO imagina_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO imagina_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO imagina_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO imagina_app;

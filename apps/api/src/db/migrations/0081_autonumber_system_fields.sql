-- v0.1.300 — ID automático, columnas de sistema, valores por defecto y validaciones.
--
-- 1. `records.updated_by`: quién modificó el registro por última vez (la
--    columna «Modificado por»). 0 = el sistema (una automatización, una
--    sincronización), NULL = no se sabe (registros modificados antes de esta
--    versión). NO se rellena acá a propósito: reescribir la tabla de
--    registros entera en una migración traba el servidor; la lectura usa
--    `coalesce(updated_by, created_by si nunca se modificó)`.
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "updated_by" bigint;--> statement-breakpoint

-- 2. Contador del ID automático: uno por campo y período (año, o 0 si el
--    campo no reinicia por año). `next_value` es el próximo número a dar.
CREATE TABLE IF NOT EXISTS "autonumber_counters" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "field_id" bigint NOT NULL REFERENCES "fields" ("id") ON DELETE CASCADE,
    "period" integer NOT NULL DEFAULT 0,
    "next_value" bigint NOT NULL,
    CONSTRAINT "autonumber_counters_pk" PRIMARY KEY ("field_id", "period")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autonumber_counters_tenant_ix" ON "autonumber_counters" ("tenant_id");--> statement-breakpoint
ALTER TABLE "autonumber_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "autonumber_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "autonumber_counters"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "autonumber_counters" TO imagina_app;--> statement-breakpoint

-- 3. Texto del ID: `[prefijo][sep][año][sep]número` (las partes vacías no
--    dejan separador), el número con ceros a la izquierda hasta `digits` y
--    SIN cortarse si es más largo. Gemela de `formatAutonumber`
--    (packages/shared/src/field-types/autonumber.ts): si cambias una, cambia
--    la otra (hay un test de paridad).
CREATE OR REPLACE FUNCTION imcrm_autonumber_text(cfg jsonb, n bigint, period integer) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT array_to_string(ARRAY[
        NULLIF(btrim(CASE WHEN jsonb_typeof(cfg -> 'prefix') = 'string' THEN cfg ->> 'prefix' ELSE '' END), ''),
        CASE WHEN cfg -> 'yearly' = 'true'::jsonb AND period > 0 THEN period::text END,
        CASE WHEN length(n::text) >= d THEN n::text ELSE lpad(n::text, d, '0') END
    ], CASE WHEN jsonb_typeof(cfg -> 'separator') = 'string' THEN cfg ->> 'separator' ELSE '-' END)
    FROM (
        SELECT CASE WHEN jsonb_typeof(cfg -> 'digits') = 'number'
                    THEN LEAST(GREATEST((cfg ->> 'digits')::numeric::int, 1), 10)
                    ELSE 4 END AS d
    ) s
$$;--> statement-breakpoint

-- 4. El número se asigna en un trigger y no en cada servicio: así lo reciben
--    TODOS los caminos que crean registros (alta, import, formularios,
--    portal, automatizaciones, asistente/MCP, duplicar, sincronización de
--    tiendas y SQL, plantillas…) sin depender de que cada uno se acuerde.
--
--    - El contador se toma con un UPSERT, que BLOQUEA su fila hasta el final
--      de la transacción: dos altas a la vez reciben números distintos y un
--      alta que se revierte devuelve su número (sin huecos por carreras).
--    - El número lo pone SIEMPRE el trigger: un valor que llega en el alta se
--      descarta (un clon de una recurrencia, un duplicado o los registros de
--      muestra de una plantilla traen el número del original y lo
--      repetirían). Sólo con `app.keep_autonumber = on` en la transacción se
--      respeta lo que llega: lo usan la numeración de lo existente al crear
--      el campo y la migración de una empresa (que trae los suyos).
--    - En un UPDATE el número es INMUTABLE: si la fila ya tenía uno, se
--      conserva aunque quien escribe mande el `data` sin esa clave o con
--      otro valor. Si no tenía (registros borrados cuando se agregó el campo
--      y restaurados después), se le da uno.
--    - `updated_by`: en el alta, quien lo crea (lo dice `created_by`).
CREATE OR REPLACE FUNCTION imcrm_records_autonumber() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    f record;
    k text;
    cur jsonb;
    per integer;
    st bigint;
    n bigint;
    tz text;
    tz_loaded boolean := false;
    keep boolean := coalesce(current_setting('app.keep_autonumber', true), '') = 'on';
BEGIN
    IF TG_OP = 'INSERT' AND NEW.updated_by IS NULL THEN
        NEW.updated_by := NEW.created_by;
    END IF;
    IF NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    FOR f IN SELECT fl.id, fl.config FROM fields fl WHERE fl.list_id = NEW.list_id AND fl.type = 'autonumber' AND fl.deleted_at IS NULL ORDER BY fl.id LOOP
        k := 'f' || f.id;
        IF TG_OP = 'UPDATE' THEN
            cur := OLD.data -> k;
            IF cur IS NOT NULL AND jsonb_typeof(cur) = 'string' AND (cur #>> '{}') <> '' THEN
                IF (NEW.data -> k) IS DISTINCT FROM cur THEN
                    NEW.data := jsonb_set(NEW.data, ARRAY[k], cur);
                END IF;
                CONTINUE;
            END IF;
        END IF;
        cur := NEW.data -> k;
        IF keep AND cur IS NOT NULL AND jsonb_typeof(cur) = 'string' AND (cur #>> '{}') <> '' THEN
            CONTINUE;
        END IF;
        per := 0;
        IF f.config -> 'yearly' = 'true'::jsonb THEN
            IF NOT tz_loaded THEN
                SELECT t.settings #>> '{format,timezone}' INTO tz FROM tenants t WHERE t.id = NEW.tenant_id;
                tz_loaded := true;
            END IF;
            BEGIN
                per := extract(year FROM (coalesce(NEW.created_at, now()) AT TIME ZONE coalesce(NULLIF(tz, ''), 'UTC')))::integer;
            EXCEPTION WHEN others THEN
                per := extract(year FROM (coalesce(NEW.created_at, now()) AT TIME ZONE 'UTC'))::integer;
            END;
        END IF;
        st := CASE WHEN jsonb_typeof(f.config -> 'start') = 'number'
                   THEN GREATEST((f.config ->> 'start')::numeric, 0)::bigint
                   ELSE 1 END;
        INSERT INTO autonumber_counters AS c (tenant_id, field_id, period, next_value)
            VALUES (NEW.tenant_id, f.id, per, st + 1)
            ON CONFLICT (field_id, period) DO UPDATE SET next_value = GREATEST(c.next_value, st) + 1
            RETURNING c.next_value - 1 INTO n;
        NEW.data := jsonb_set(coalesce(NEW.data, '{}'::jsonb), ARRAY[k], to_jsonb(imcrm_autonumber_text(f.config, n, per)));
    END LOOP;
    RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "records_autonumber" ON "records";--> statement-breakpoint
CREATE TRIGGER "records_autonumber" BEFORE INSERT OR UPDATE ON "records"
    FOR EACH ROW EXECUTE FUNCTION imcrm_records_autonumber();

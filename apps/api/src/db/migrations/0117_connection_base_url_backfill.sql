-- La credencial de una conexión sólo se envía a SU servidor.
--
-- Desde esta versión, «Llamar webhook externo» (y las acciones con nombre de
-- una API personalizada) sólo le ponen la credencial de la conexión a una
-- petición cuyo destino es el mismo servidor (esquema + host + puerto) que la
-- dirección de la conexión. Antes una acción con URL absoluta podía llevarse
-- la credencial a cualquier servidor.
--
-- Hay conexiones hechas a mano SIN dirección (la URL completa se escribía en
-- cada acción): para que sigan funcionando, se les pone como dirección el
-- servidor al que ya llaman sus acciones, cuando TODAS llaman al mismo. Si
-- llaman a varios servidores, o alguna URL empieza con una variable, no se
-- toca: esas acciones fallan con un mensaje claro hasta que un administrador
-- complete la dirección de la conexión.
WITH uses AS (
    SELECT a."tenant_id" AS tenant_id,
           w #>> '{config,connection_id}' AS conn,
           btrim(coalesce(w #>> '{config,url}', '')) AS url
    FROM "automations" AS a,
         LATERAL jsonb_path_query(a."actions", 'strict $.** ? (@.type == "call_webhook")') AS w
    WHERE jsonb_typeof(a."actions") = 'array'
    UNION ALL
    SELECT c."tenant_id", c."id"::text, btrim(coalesce(act ->> 'path', ''))
    FROM "connections" AS c,
         LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(c."config" -> 'actions') = 'array' THEN c."config" -> 'actions' ELSE '[]'::jsonb END
         ) AS act
    WHERE c."provider" = 'http' AND btrim(c."base_url") = ''
),
origins AS (
    SELECT tenant_id,
           conn::bigint AS conn_id,
           CASE
               WHEN url ~* '^https?://[a-z0-9.-]+(:[0-9]+)?([/?#]|$)'
                   THEN lower(substring(url from '^[a-zA-Z]+://[^/?#]+'))
               ELSE NULL
           END AS origin
    FROM uses
    WHERE conn ~ '^[0-9]{1,15}$' AND url <> ''
),
agg AS (
    SELECT tenant_id,
           conn_id,
           count(DISTINCT origin) AS n,
           bool_or(origin IS NULL) AS unknown,
           min(origin) AS origin
    FROM origins
    GROUP BY tenant_id, conn_id
)
UPDATE "connections" AS c
SET "base_url" = agg.origin
FROM agg
WHERE c."tenant_id" = agg.tenant_id
  AND c."id" = agg.conn_id
  AND c."provider" = 'http'
  AND btrim(c."base_url") = ''
  AND agg.n = 1
  AND NOT agg.unknown;

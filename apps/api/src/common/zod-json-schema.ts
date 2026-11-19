import { z } from 'zod';

/**
 * v0.1.465 — Zod 4 trae su propio conversor a JSON Schema (`z.toJSONSchema`);
 * reemplaza a `zod-to-json-schema`, que sólo entendía Zod 3. Un solo lugar
 * para las herramientas de la IA (asistente, MCP, agentes, armado de
 * automatizaciones, importar, sugerencias, primeros pasos) y el OpenAPI.
 *
 * - `io: 'input'`: lo que se MANDA (un campo con valor por defecto es
 *   opcional), igual que antes.
 * - `unrepresentable: 'any'`: un `z.custom`, una fecha o un transform no
 *   rompen el documento; quedan como «cualquier valor».
 * - Sin `$schema` en la raíz (la API de Claude y el OpenAPI no lo quieren).
 * - Un objeto común sigue diciendo `additionalProperties: false`, como con
 *   `zod-to-json-schema` (Zod 4 lo omite en modo `input`): a la IA le marca
 *   que no invente claves. Los objetos `.passthrough()` quedan abiertos.
 * - Sin el `propertyNames: {type: 'string'}` de cada `z.record`: no agrega
 *   nada (toda clave JSON es texto) y el OpenAPI 3.0 no lo conoce.
 */
export function zodToJson(schema: z.ZodType, target: 'draft-7' | 'openapi-3.0' = 'draft-7'): Record<string, unknown> {
    const json = z.toJSONSchema(schema, {
        target,
        io: 'input',
        unrepresentable: 'any',
        override: (ctx) => {
            const js = ctx.jsonSchema as Record<string, unknown>;
            const type = (ctx.zodSchema as { _zod?: { def?: { type?: string } } })._zod?.def?.type;
            if (type === 'object' && js.additionalProperties === undefined) js.additionalProperties = false;
            const names = js.propertyNames as Record<string, unknown> | undefined;
            if (names && Object.keys(names).length === 1 && names.type === 'string') delete js.propertyNames;
        },
    }) as Record<string, unknown>;
    delete json.$schema;
    return json;
}

/** El `input_schema` de una herramienta: siempre un objeto en la raíz. */
export function toolInputSchema(schema: z.ZodType): Record<string, unknown> {
    const json = zodToJson(schema, 'draft-7');
    if (json.type !== 'object') return { type: 'object', properties: {}, ...json };
    return json;
}

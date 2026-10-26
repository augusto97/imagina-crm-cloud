import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Higiene de la ENTRADA, antes de que llegue a un controller.
 *
 * 1) Caracteres que Postgres no acepta. Un `\u0000` (NUL) o una mitad suelta
 *    de un par sustituto UTF-16 (`\uD800` sin su pareja) son JSON válido para
 *    Node, pero Postgres los rechaza: en una columna `text` con «invalid byte
 *    sequence for encoding UTF8: 0x00» y en `jsonb` con «unsupported Unicode
 *    escape sequence». Llegaban hasta la base y respondían 500 al crear un
 *    registro, una lista, un campo, una vista o un comentario (y `?search=%00`
 *    rompía el listado). Ningún dato legítimo los necesita: el NUL se quita y
 *    la mitad suelta se reemplaza por `�` (el mismo carácter que pone el
 *    driver al codificarla en UTF-8 en una columna de texto).
 *
 * 2) Ids imposibles en la ruta. `/lists/99999999999999999999999` o
 *    `/records/9223372036854775808` pasaban el `ParseIntPipe` (es un entero
 *    finito para JS) y explotaban en Postgres con «out of range for type
 *    bigint» → 500. Un id de la ruta hecho sólo de dígitos y más grande que
 *    `Number.MAX_SAFE_INTEGER` no puede existir: 404 sin tocar la base.
 *
 * 3) Cuerpos con demasiados elementos en arrays (v0.1.308). Al validar con
 *    Zod, cada elemento de un array que falla deja un «issue» en memoria: un
 *    cuerpo de 2 MB con un millón de ceros contra un array de objetos ocupa
 *    ~300 MB y 1,5 s de CPU en UNA request (GHSA-mrhx-c7xc-m3w5). Zod 4.6.6
 *    sólo corta los arrays con `.max()`; Zod 3 no corta ninguno. El tope por
 *    cuerpo cierra el vector sin depender de la versión: ningún pedido
 *    legítimo se acerca (el import más grande son 10.000 filas, una
 *    descripción 5.000 nodos).
 *
 * El cuerpo crudo (`rawBody`, para verificar firmas de webhooks) no se toca.
 */

/** Tope de elementos de array (sumados en todo el cuerpo) que se aceptan. */
export const MAX_BODY_ARRAY_ITEMS = 100_000;

// eslint-disable-next-line no-control-regex -- el NUL es justamente lo que se busca.
const NEEDS_CLEANING = /[\u0000\uD800-\uDFFF]/;
// eslint-disable-next-line no-control-regex -- ídem.
const NUL = /\u0000/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** El texto sin NUL y sin mitades sueltas de pares sustitutos. */
export function cleanString(s: string): string {
    if (!NEEDS_CLEANING.test(s)) return s;
    return s.replace(NUL, '').replace(LONE_SURROGATE, '�');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (typeof v !== 'object' || v === null) return false;
    const proto = Object.getPrototypeOf(v) as object | null;
    // El parser de query de Fastify (fast-querystring) crea objetos cuyo
    // prototipo es un objeto vacío sin prototipo: también son "planos".
    return proto === Object.prototype || proto === null || Object.getPrototypeOf(proto) === null;
}

/**
 * Limpia un valor recibido (cuerpo JSON, query o params). Objetos planos y
 * arrays se corrigen EN EL LUGAR —claves incluidas— y los textos se devuelven
 * limpios. Iterativo (no recursivo): un JSON muy anidado no revienta la pila.
 * Lo que no es JSON (Buffers, streams de multipart) se deja tal cual.
 */
export function sanitizeInput<T>(value: T): T {
    if (typeof value === 'string') return cleanString(value) as T;
    if (!Array.isArray(value) && !isPlainObject(value)) return value;
    const stack: Array<Record<string, unknown> | unknown[]> = [value as Record<string, unknown> | unknown[]];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) {
                const v = node[i];
                if (typeof v === 'string') node[i] = cleanString(v);
                else if (Array.isArray(v) || isPlainObject(v)) stack.push(v);
            }
            continue;
        }
        for (const key of Object.keys(node)) {
            const v = node[key];
            const cleanKey = cleanString(key);
            const cleanValue = typeof v === 'string' ? cleanString(v) : v;
            if (cleanKey !== key) {
                delete node[key];
                node[cleanKey] = cleanValue;
            } else if (cleanValue !== v) {
                node[key] = cleanValue;
            }
            if (Array.isArray(v) || isPlainObject(v)) stack.push(v);
        }
    }
    return value;
}

/**
 * ¿El valor tiene más de `limit` elementos de array en total (sumando todos
 * los arrays, a cualquier profundidad)? Iterativo y corta apenas se pasa.
 */
export function exceedsArrayItems(value: unknown, limit: number = MAX_BODY_ARRAY_ITEMS): boolean {
    if (!Array.isArray(value) && !isPlainObject(value)) return false;
    let count = 0;
    const stack: unknown[] = [value];
    while (stack.length > 0) {
        const node = stack.pop();
        if (Array.isArray(node)) {
            count += node.length;
            if (count > limit) return true;
            for (const v of node) if (Array.isArray(v) || isPlainObject(v)) stack.push(v);
        } else if (isPlainObject(node)) {
            for (const v of Object.values(node)) if (Array.isArray(v) || isPlainObject(v)) stack.push(v);
        }
    }
    return false;
}

/** ¿Algún parámetro de la ruta es un "id" (sólo dígitos) que no cabe en un entero seguro? */
export function hasImpossibleId(params: unknown): boolean {
    if (!isPlainObject(params)) return false;
    return Object.values(params).some((v) => typeof v === 'string' && isUnsafeDigits(v));
}

/** Sólo dígitos y más grande que `Number.MAX_SAFE_INTEGER` (no hay fila con ese id). */
export function isUnsafeDigits(v: string): boolean {
    return /^\d+$/.test(v) && !Number.isSafeInteger(Number(v));
}

/** Registra la higiene de entrada como hook global de Fastify (antes de la validación y el handler). */
export function registerRequestInputHooks(fastify: FastifyInstance): void {
    fastify.addHook('preValidation', (req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => {
        req.params = sanitizeInput(req.params);
        if (hasImpossibleId(req.params)) {
            void reply.code(404).send({ code: 'not_found', message: 'No encontrado', data: { status: 404 } });
            return;
        }
        if (exceedsArrayItems(req.body)) {
            void reply.code(413).send({
                code: 'too_many_items',
                message: `El pedido trae demasiados elementos (más de ${MAX_BODY_ARRAY_ITEMS.toLocaleString('es-CO')}). Divídelo en partes más pequeñas.`,
                data: { status: 413 },
            });
            return;
        }
        req.query = sanitizeInput(req.query);
        req.body = sanitizeInput(req.body);
        done();
    });
}

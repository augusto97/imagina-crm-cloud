import { BadRequestException } from '@nestjs/common';
import {
    describePayloadValue,
    isValidPayloadPath,
    normalizePhone,
    parseRecordIdValue,
    readPayloadPath,
    readWebhookRecordConfig,
    WEBHOOK_RECORD_MODES,
    webhookMatchFieldError,
    webhookModeSearches,
    writeWebhookRecordConfig,
    type WebhookRecordConfig,
} from '@imagina-base/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { records } from '../db/schema';
import type { FieldRow } from '../fields/fields.repository';
import { keyExpr, normalizeKey } from '../records/record-key';
import type { Tx } from '../db/client';

/**
 * v0.1.399 — Qué registro le corresponde a un pedido del webhook entrante.
 *
 *  - `found`     — el registro (de ESTA lista y empresa, fuera de la papelera).
 *  - `create`    — no hay que buscar (modo «crear») o no se encontró en
 *                  «actualizar o crear»: se crea uno nuevo.
 *  - `not_found` — modo «actualizar» y no existe (o el JSON no trae la clave):
 *                  la corrida se cancela con el motivo, sin crear nada.
 *  - `error`     — la configuración no sirve (el campo de búsqueda ya no
 *                  existe o dejó de ser «Sin repetidos») o hay registros
 *                  repetidos de antes: la corrida falla y se avisa.
 *
 * Nunca devuelve más de un registro: se busca por el ID (único en toda la app)
 * o por un campo que no se repite; si igual aparecen dos (datos de antes de
 * marcar «Sin repetidos»), no se adivina.
 */
export type WebhookLookup =
    | { kind: 'found'; record: { id: number; data: Record<string, unknown> }; message: string }
    | { kind: 'create'; message: string }
    | { kind: 'not_found'; message: string }
    | { kind: 'error'; message: string };

export async function lookupWebhookRecord(
    tx: Tx,
    input: {
        tenantId: number;
        listId: number;
        listName: string;
        rc: WebhookRecordConfig;
        payload: Record<string, unknown>;
        fields: readonly FieldRow[];
    },
): Promise<WebhookLookup> {
    const { rc, payload } = input;
    if (rc.mode === 'create') return { kind: 'create', message: 'Crea un registro nuevo con los datos del JSON.' };
    if (!webhookModeSearches(rc.mode)) return { kind: 'error', message: 'El disparador no usa un registro.' };
    const upsert = rc.mode === 'upsert';
    const raw = readPayloadPath(payload, rc.matchKey);
    const keyLabel = `«${rc.matchKey}»`;

    if (rc.match.by === 'record_id') {
        if (raw === undefined || raw === null || raw === '') {
            return upsert
                ? { kind: 'create', message: `El JSON no trae ${keyLabel}: crea un registro nuevo.` }
                : { kind: 'not_found', message: `El JSON no trae ${keyLabel}: no se buscó ningún registro.` };
        }
        const id = parseRecordIdValue(raw);
        if (id === null) {
            return upsert
                ? { kind: 'create', message: `«${describePayloadValue(raw)}» no es el id de un registro: crea uno nuevo.` }
                : { kind: 'not_found', message: `«${describePayloadValue(raw)}» no es el id de un registro (se esperaba un número en ${keyLabel}).` };
        }
        // El id es único en toda la app; además tiene que ser de ESTA lista y
        // empresa (uno de otra lista cuenta como «no existe», sin decir más).
        const [row] = await tx
            .select({ id: records.id, data: records.data })
            .from(records)
            .where(and(eq(records.tenantId, input.tenantId), eq(records.listId, input.listId), eq(records.id, id), isNull(records.deletedAt)))
            .limit(1);
        if (row) return { kind: 'found', record: { id: row.id, data: row.data as Record<string, unknown> }, message: `Usó el registro #${row.id} (lo buscó por ${rc.matchKey}=${id}).` };
        return upsert
            ? { kind: 'create', message: `No hay un registro con ${rc.matchKey}=${id} en «${input.listName}»: crea uno nuevo.` }
            : { kind: 'not_found', message: `No encontré el registro con ${rc.matchKey}=${id} en «${input.listName}».` };
    }

    const field = input.fields.find((f) => f.slug === (rc.match as { field: string }).field);
    const err = webhookMatchFieldError(field ? { slug: field.slug, type: field.type, label: field.label, is_unique: field.isUnique } : undefined);
    if (err || !field) return { kind: 'error', message: err ?? 'El campo para buscar el registro ya no existe en la lista.' };
    const shown = describePayloadValue(raw);
    const keys = matchKeysFor(field, raw);
    if (keys.length === 0) {
        return upsert
            ? { kind: 'create', message: `El JSON no trae ${keyLabel}: crea un registro nuevo.` }
            : { kind: 'not_found', message: `El JSON no trae ${keyLabel}: no se buscó ningún registro.` };
    }
    const expr = keyExpr({ id: field.id, type: field.type as never });
    const rows = await tx
        .select({ id: records.id, data: records.data })
        .from(records)
        .where(
            and(
                eq(records.tenantId, input.tenantId),
                eq(records.listId, input.listId),
                isNull(records.deletedAt),
                sql`${expr} IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`,
            ),
        )
        .orderBy(desc(records.id))
        .limit(4);
    if (rows.length > 1) {
        const ids = rows.slice(0, 3).map((r) => `#${r.id}`).join(', ');
        return {
            kind: 'error',
            message: `Hay ${rows.length > 3 ? 'más de 3' : rows.length} registros con «${field.label}» = ${shown} (${ids}): no se actualizó ninguno. Deja uno solo con ese valor.`,
        };
    }
    const row = rows[0];
    if (row) return { kind: 'found', record: { id: row.id, data: row.data as Record<string, unknown> }, message: `Usó el registro #${row.id} (lo buscó por «${field.label}» = ${shown}).` };
    return upsert
        ? { kind: 'create', message: `No hay un registro con «${field.label}» = ${shown}: crea uno nuevo.` }
        : { kind: 'not_found', message: `No encontré ningún registro con «${field.label}» = ${shown} en «${input.listName}».` };
}

/**
 * Las formas comparables del valor que llegó. Un teléfono puede venir con o
 * sin indicativo («3001112233», «573001112233», «+57 300…»): se compara por
 * dígitos contra el valor guardado (canónico E.164) en sus dos formas — con el
 * país del campo y tal cual llegó.
 */
export function matchKeysFor(field: Pick<FieldRow, 'id' | 'type' | 'config'>, raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (typeof raw !== 'string' && typeof raw !== 'number') return [];
    const text = String(raw).trim();
    if (text === '') return [];
    if (field.type === 'phone') {
        const country = (field.config as { default_country?: unknown } | null)?.default_country;
        const norm = normalizePhone(text, typeof country === 'string' ? country : null);
        const keys = new Set<string>();
        if (norm.ok) keys.add(norm.value.replace(/\D/g, ''));
        const digits = text.replace(/\D/g, '');
        if (digits.length >= 4) keys.add(digits);
        return [...keys].filter((k) => k !== '');
    }
    const k = normalizeKey({ id: field.id, type: field.type as never }, text);
    return k === '' ? [] : [k];
}

/**
 * v0.1.399 — Al guardar: la parte «registro» del webhook tiene que poder
 * correr. Lo que no se entiende se rechaza con el motivo (no se adivina) y lo
 * que sí, se guarda en su forma canónica.
 */
export function normalizeWebhookRecordConfig(
    triggerType: string,
    triggerConfig: Record<string, unknown>,
    fields: readonly Pick<FieldRow, 'slug' | 'type' | 'label' | 'isUnique'>[],
): Record<string, unknown> {
    if (triggerType !== 'incoming_webhook') return triggerConfig;
    const raw = triggerConfig.record_mode;
    if (raw !== undefined && raw !== null && raw !== '' && !(WEBHOOK_RECORD_MODES as readonly string[]).includes(String(raw))) {
        throw invalidWebhook('invalid_webhook_mode', 'Qué hacer con el registro: elige «Nada», «Crear», «Actualizar» o «Actualizar o crear».');
    }
    const key = typeof triggerConfig.match_key === 'string' ? triggerConfig.match_key.trim() : '';
    if (key !== '' && !isValidPayloadPath(key)) {
        throw invalidWebhook('invalid_webhook_key', `La clave en el JSON «${key.slice(0, 60)}» sólo admite letras, números, «_» y puntos entre tramos (por ejemplo data.id).`);
    }
    const rc = readWebhookRecordConfig(triggerConfig);
    if (webhookModeSearches(rc.mode) && rc.match.by === 'field') {
        const field = fields.find((f) => f.slug === (rc.match as { field: string }).field);
        const err = webhookMatchFieldError(field ? { slug: field.slug, type: field.type, label: field.label, is_unique: field.isUnique } : undefined);
        if (err) throw invalidWebhook('invalid_webhook_match', err);
    }
    const { record_mode: _m, match: _x, match_key: _k, apply_payload_fields: _a, ...rest } = triggerConfig;
    return { ...rest, ...writeWebhookRecordConfig(rc) };
}

function invalidWebhook(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

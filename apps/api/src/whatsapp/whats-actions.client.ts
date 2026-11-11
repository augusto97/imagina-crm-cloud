import { WHATS_LOOKUP_ABILITY, type WhatsActionStep, type WhatsLookupItem, type WhatsLookupKind, type WhatsLookupResult, whatsNameKey } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { safeWebhookFetch } from '../common/safe-fetch';
import { redactValues } from '../connectors/connection-parts';
import type { IntegrationRequest } from '../connectors/integration-calls';
import {
    describeWhatsPlan,
    parseWaWebContact,
    parseWaWebConversations,
    parseWaWebCreatedId,
    parseWaWebEnroll,
    parseWaWebFlowRun,
    parseWaWebList,
    parseWaWebMessageId,
    pickConversation,
    waWebConsentRequest,
    waWebContactNoteRequest,
    waWebContactTagsRequest,
    waWebConversationStatusRequest,
    waWebCreateGroupRequest,
    waWebCreateTagRequest,
    waWebEnrollDripRequest,
    waWebFindConversationsRequest,
    waWebGroupContactsRequest,
    waWebListRequest,
    waWebLookupContactRequest,
    waWebGetContactRequest,
    waWebReplyRequest,
    waWebResumeFlowRequest,
    waWebTriggerFlowRequest,
    waWebUnsubscribeRequest,
    waWebUpsertContactRequest,
    type WhatsPlan,
} from './whats-actions';
import { isSystemicWaWebError, parseWaWebError, parseWaWebMe, waWebErrorText, waWebMeRequest, type WaWebCreds, type WaWebError } from './whatsapp-web';

/**
 * v0.1.401 — La parte de RED del conector completo de Whats: ejecuta un plan
 * (`planWhatsAction`), busca o crea el contacto por teléfono y trae las listas
 * de la cuenta (etiquetas, grupos, flujos, goteos, campos).
 *
 * Lo que se recuerda en Redis, para no pedirlo cada vez (Whats permite 60
 * pedidos por minuto por clave):
 *  - el id del contacto por teléfono (30 días; si Whats dice que ya no existe,
 *    se olvida y se vuelve a buscar UNA vez),
 *  - las listas de la cuenta (2 minutos; crear una etiqueta o un grupo las
 *    renueva),
 *  - los permisos de la clave (1 minuto).
 */

const SEND_TIMEOUT_MS = 20_000;
const CONTACT_TTL_S = 30 * 24 * 3600;
const LIST_TTL_S = 120;
const ME_TTL_S = 60;
/** Hasta cuántas páginas de 100 se traen de una lista (el resto se escribe a mano). */
const LIST_MAX_PAGES = 5;

type Store = Partial<Pick<Redis, 'get' | 'set' | 'del'>>;

export interface WhatsExecResult {
    ok: boolean;
    /** Lo que pasó, en palabras (o el motivo de la falla). */
    message: string;
    /** Lo que deja para los pasos siguientes (`{{whats.*}}`). */
    outputs: Record<string, string>;
    steps: WhatsActionStep[];
    /** Una falla de la CONEXIÓN (clave, permiso, plan): abre un problema. */
    systemic: boolean;
    errorCode: string | null;
    /** No había nada que hacer (por ejemplo, quitar algo de un contacto que no existe). */
    skipped?: boolean;
}

class WhatsCallError extends Error {
    constructor(
        readonly err: WaWebError,
        readonly label: string,
    ) {
        super(waWebErrorText(err));
    }
}

class WhatsNetworkError extends Error {}

export class WhatsActionsClient {
    constructor(private readonly store: Store | null) {}

    private async cacheGet(key: string): Promise<string | null> {
        if (!this.store?.get) return null;
        try {
            return await this.store.get(key);
        } catch {
            return null;
        }
    }

    private async cacheSet(key: string, value: string, ttlS: number): Promise<void> {
        if (!this.store?.set) return;
        try {
            await this.store.set(key, value, 'EX', ttlS);
        } catch {
            // Sin Redis, la próxima vez se vuelve a preguntar: nada se rompe.
        }
    }

    private async cacheDel(key: string): Promise<void> {
        if (!this.store?.del) return;
        try {
            await this.store.del(key);
        } catch {
            /* ídem */
        }
    }

    private contactKey(connectionId: number, digits: string): string {
        return `whats:ct:${connectionId}:${digits.replace(/\D/g, '')}`;
    }

    private listKey(connectionId: number, kind: WhatsLookupKind): string {
        return `whats:lk:${connectionId}:${kind}`;
    }

    private contactByIdKey(connectionId: number, contactId: number): string {
        return `whats:cp:${connectionId}:${contactId}`;
    }

    /**
     * v0.1.402 — El teléfono, nombre y correo de un contacto por su id (los
     * avisos de contactos, conversaciones o formularios a veces traen sólo el
     * id). Se recuerda 30 días: el mismo contacto no se pregunta de nuevo.
     * `null` = no existe, la clave no tiene `contacts.view` o Whats no respondió.
     */
    async contactById(creds: WaWebCreds, connectionId: number, contactId: number): Promise<{ phone: string; name: string; email: string } | null> {
        const key = this.contactByIdKey(connectionId, contactId);
        const hit = await this.cacheGet(key);
        if (hit) {
            try {
                const parsed = JSON.parse(hit) as { phone?: unknown; name?: unknown; email?: unknown };
                if (typeof parsed.phone === 'string' && parsed.phone !== '') {
                    return { phone: parsed.phone, name: typeof parsed.name === 'string' ? parsed.name : '', email: typeof parsed.email === 'string' ? parsed.email : '' };
                }
            } catch {
                /* se vuelve a preguntar */
            }
        }
        let res: { status: number; body: string };
        try {
            res = await this.call(creds, waWebGetContactRequest(creds, contactId), 'Leer el contacto', []);
        } catch {
            return null;
        }
        if (res.status < 200 || res.status >= 300) return null;
        const c = parseWaWebContact(res.body);
        const phone = (c?.phone ?? '').replace(/\D/g, '');
        if (!c || phone === '') return null;
        const out = { phone, name: c.name ?? '', email: c.email ?? '' };
        await this.cacheSet(key, JSON.stringify(out), CONTACT_TTL_S);
        await this.cacheSet(this.contactKey(connectionId, phone), String(c.id), CONTACT_TTL_S);
        return out;
    }

    /** El contacto de un envío (Whats lo crea solo): las acciones siguientes no lo buscan. */
    async rememberContact(connectionId: number, digits: string, contactId: number): Promise<void> {
        await this.cacheSet(this.contactKey(connectionId, digits), String(contactId), CONTACT_TTL_S);
    }

    // ── Red ───────────────────────────────────────────────────────────

    private async call(creds: WaWebCreds, req: IntegrationRequest, label: string, steps: WhatsActionStep[], maxBytes = 256 * 1024): Promise<{ status: number; body: string }> {
        const step: WhatsActionStep = { label, method: req.method, url: req.url, body: req.body ?? null, status: null };
        steps.push(step);
        try {
            const res = await safeWebhookFetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
                captureBody: true,
                maxCaptureBytes: maxBytes,
                timeoutMs: SEND_TIMEOUT_MS,
            });
            step.status = res.status;
            return { status: res.status, body: res.body ?? '' };
        } catch (err) {
            throw new WhatsNetworkError(`No pudimos comunicarnos con el servidor de Whats (${redactValues(err instanceof Error ? err.message : String(err), [creds.key])}).`);
        }
    }

    /** Hace el pedido y, si salió mal, corta con el motivo en palabras. */
    private async expectOk(creds: WaWebCreds, req: IntegrationRequest, label: string, steps: WhatsActionStep[]): Promise<string> {
        const res = await this.call(creds, req, label, steps);
        const err = parseWaWebError(res.status, res.body);
        if (err) throw new WhatsCallError(err, label);
        return res.body;
    }

    // ── El contacto ───────────────────────────────────────────────────

    /**
     * El contacto de Whats de un teléfono: el recordado, el que ya está o (con
     * `create`) uno nuevo con el teléfono y el nombre del registro.
     * `null` = no existe y no se pidió crearlo.
     */
    async resolveContact(
        creds: WaWebCreds,
        connectionId: number,
        digits: string,
        opts: { create: boolean; name: string; useCache?: boolean },
        steps: WhatsActionStep[],
    ): Promise<{ id: number; created: boolean; cached: boolean } | null> {
        const key = this.contactKey(connectionId, digits);
        if (opts.useCache !== false) {
            const hit = Number(await this.cacheGet(key));
            if (Number.isInteger(hit) && hit > 0) return { id: hit, created: false, cached: true };
        }
        const res = await this.call(creds, waWebLookupContactRequest(creds, digits), 'Buscar el contacto', steps);
        if (res.status >= 200 && res.status < 300) {
            const c = parseWaWebContact(res.body);
            if (c) {
                await this.cacheSet(key, String(c.id), CONTACT_TTL_S);
                return { id: c.id, created: false, cached: false };
            }
        } else {
            const err = parseWaWebError(res.status, res.body);
            if (err && err.code !== 'not_found' && res.status !== 404) throw new WhatsCallError(err, 'Buscar el contacto');
        }
        if (!opts.create) return null;
        const body = await this.expectOk(
            creds,
            waWebUpsertContactRequest(creds, { phone: digits, name: opts.name }),
            'Crear el contacto',
            steps,
        );
        const created = parseWaWebContact(body);
        if (!created) throw new WhatsCallError({ status: 200, code: 'unexpected_response', message: 'La respuesta no trae el id del contacto.', details: {} }, 'Crear el contacto');
        await this.cacheSet(key, String(created.id), CONTACT_TTL_S);
        return { id: created.id, created: true, cached: false };
    }

    // ── Etiquetas y grupos por nombre ─────────────────────────────────

    /** Los ids de unos nombres (y, con `create`, crea los que falten). */
    private async idsByName(
        creds: WaWebCreds,
        connectionId: number,
        kind: 'tags' | 'groups',
        names: string[],
        create: boolean,
        steps: WhatsActionStep[],
    ): Promise<{ ids: number[]; created: string[]; missing: string[] }> {
        const found = await this.listItems(creds, connectionId, kind, steps);
        const byName = new Map(found.items.filter((i) => i.id !== null).map((i) => [whatsNameKey(i.name), i.id!]));
        const ids: number[] = [];
        const created: string[] = [];
        const missing: string[] = [];
        for (const name of names) {
            const id = byName.get(whatsNameKey(name));
            if (id !== undefined) {
                ids.push(id);
                continue;
            }
            if (!create) {
                missing.push(name);
                continue;
            }
            const res = await this.call(
                creds,
                kind === 'tags' ? waWebCreateTagRequest(creds, name) : waWebCreateGroupRequest(creds, name),
                kind === 'tags' ? `Crear la etiqueta «${name}»` : `Crear el grupo «${name}»`,
                steps,
            );
            const err = parseWaWebError(res.status, res.body);
            if (err) {
                // Otra corrida la creó entre medio (el nombre es único): se vuelve a leer la lista.
                if (err.status === 422 || err.status === 409) {
                    await this.cacheDel(this.listKey(connectionId, kind));
                    const again = await this.listItems(creds, connectionId, kind, steps);
                    const id2 = again.items.find((i) => i.id !== null && whatsNameKey(i.name) === whatsNameKey(name))?.id;
                    if (id2) {
                        ids.push(id2);
                        continue;
                    }
                }
                throw new WhatsCallError(err, kind === 'tags' ? 'Crear la etiqueta' : 'Crear el grupo');
            }
            const newId = parseWaWebCreatedId(res.body);
            if (newId === null) throw new WhatsCallError({ status: res.status, code: 'unexpected_response', message: 'La respuesta no trae el id.', details: {} }, 'Crear');
            ids.push(newId);
            created.push(name);
        }
        if (created.length > 0) await this.cacheDel(this.listKey(connectionId, kind));
        return { ids, created, missing };
    }

    // ── Listas de la cuenta ───────────────────────────────────────────

    private async listItems(
        creds: WaWebCreds,
        connectionId: number,
        kind: WhatsLookupKind,
        steps: WhatsActionStep[],
    ): Promise<{ items: Array<{ id: number | null; key: string | null; name: string; status: string | null; type: string | null }>; truncated: boolean }> {
        const cached = await this.cacheGet(this.listKey(connectionId, kind));
        if (cached) {
            try {
                return JSON.parse(cached) as { items: Array<{ id: number | null; key: string | null; name: string; status: string | null; type: string | null }>; truncated: boolean };
            } catch {
                /* se vuelve a pedir */
            }
        }
        const items: Array<{ id: number | null; key: string | null; name: string; status: string | null; type: string | null }> = [];
        let cursor: string | null = null;
        let truncated = false;
        for (let page = 0; page < LIST_MAX_PAGES; page++) {
            const body = await this.expectOk(creds, waWebListRequest(creds, kind, cursor), 'Leer la lista', steps);
            const parsed = parseWaWebList(body);
            items.push(...parsed.items);
            cursor = parsed.next;
            if (!cursor) break;
            if (page === LIST_MAX_PAGES - 1) truncated = true;
        }
        const out = { items, truncated };
        await this.cacheSet(this.listKey(connectionId, kind), JSON.stringify(out), LIST_TTL_S);
        return out;
    }

    /** Las opciones para el editor (con el motivo si no se pudieron traer). */
    async options(creds: WaWebCreds, connectionId: number, kind: WhatsLookupKind): Promise<WhatsLookupResult> {
        try {
            const { items, truncated } = await this.listItems(creds, connectionId, kind, []);
            const out: WhatsLookupItem[] = [];
            for (const i of items) {
                if (kind === 'tags' || kind === 'groups') out.push({ value: i.name, label: i.name, hint: null });
                else if (kind === 'contact_fields') {
                    if (i.key) out.push({ value: i.key, label: i.name, hint: i.type });
                } else if (i.id !== null) {
                    // Flujos y goteos: el id es la verdad (renombrarlos en Whats no rompe nada).
                    out.push({ value: String(i.id), label: i.name, hint: statusLabel(i.status) });
                }
            }
            return { items: out, truncated, error: null };
        } catch (err) {
            if (err instanceof WhatsCallError) {
                const ab = String(err.err.details.ability ?? '') || (err.err.code === 'missing_ability' ? WHATS_LOOKUP_ABILITY[kind] : '');
                return { items: [], truncated: false, error: ab && err.err.code === 'missing_ability' ? waWebErrorText({ ...err.err, details: { ...err.err.details, ability: ab } }) : err.message };
            }
            return { items: [], truncated: false, error: err instanceof Error ? err.message : String(err) };
        }
    }

    /** Los permisos de la clave (para avisar en el editor qué le falta a cada acción). */
    async abilities(creds: WaWebCreds, connectionId: number): Promise<{ abilities: string[]; error: string | null }> {
        const key = `whats:me:${connectionId}`;
        const cached = await this.cacheGet(key);
        if (cached) {
            try {
                return { abilities: JSON.parse(cached) as string[], error: null };
            } catch {
                /* se vuelve a pedir */
            }
        }
        try {
            const body = await this.expectOk(creds, waWebMeRequest(creds), 'Leer la cuenta', []);
            const abilities = parseWaWebMe(body).abilities;
            await this.cacheSet(key, JSON.stringify(abilities), ME_TTL_S);
            return { abilities, error: null };
        } catch (err) {
            return { abilities: [], error: err instanceof Error ? err.message : String(err) };
        }
    }

    // ── Ejecutar un plan ──────────────────────────────────────────────

    async execute(creds: WaWebCreds, connectionId: number, plan: WhatsPlan): Promise<WhatsExecResult> {
        const steps: WhatsActionStep[] = [];
        try {
            const out = await this.run(creds, connectionId, plan, steps, true);
            return { ...out, steps: redactSteps(steps, creds), systemic: false, errorCode: null };
        } catch (err) {
            if (err instanceof WhatsCallError) {
                return { ok: false, message: err.message, outputs: {}, steps: redactSteps(steps, creds), systemic: isSystemicWaWebError(err.err), errorCode: err.err.code };
            }
            if (err instanceof WhatsNetworkError) return { ok: false, message: err.message, outputs: {}, steps: redactSteps(steps, creds), systemic: false, errorCode: 'network' };
            throw err;
        }
    }

    private async run(
        creds: WaWebCreds,
        connectionId: number,
        plan: WhatsPlan,
        steps: WhatsActionStep[],
        useCache: boolean,
    ): Promise<{ ok: boolean; message: string; outputs: Record<string, string>; skipped?: boolean }> {
        if (plan.action === 'resume_flow') {
            const body = await this.expectOk(creds, waWebResumeFlowRequest(creds, plan.runId, plan.token, plan.variables), 'Reanudar el flujo', steps);
            const run = parseWaWebFlowRun(body);
            return { ok: true, message: `Se reanudó la ejecución ${plan.runId} del flujo.`, outputs: { ejecucion_id: String(run.id ?? plan.runId) } };
        }
        if (plan.action === 'upsert_contact') {
            // Saber si ya estaba: un contacto nuevo nace con el título del registro y «contacto_nuevo» lo dice.
            const before = await this.resolveContact(creds, connectionId, plan.phone, { create: false, name: '', useCache }, steps);
            const body = await this.expectOk(
                creds,
                waWebUpsertContactRequest(creds, {
                    phone: plan.phone,
                    // Un contacto nuevo nace con el título del registro; uno existente sólo cambia si se escribió un nombre.
                    name: plan.name || (before ? '' : plan.fallbackName),
                    email: plan.email,
                    language: plan.language,
                    fields: plan.fields,
                }),
                'Crear o actualizar el contacto',
                steps,
            );
            const c = parseWaWebContact(body);
            if (!c) throw new WhatsCallError({ status: 200, code: 'unexpected_response', message: 'La respuesta no trae el id del contacto.', details: {} }, 'Contacto');
            await this.rememberContact(connectionId, plan.phone, c.id);
            const isNew = before === null;
            return { ok: true, message: `Contacto +${plan.phone} ${isNew ? 'creado' : 'actualizado'} en Whats (#${c.id}).`, outputs: { contacto_id: String(c.id), contacto_nuevo: isNew ? 'Sí' : 'No' } };
        }
        if (plan.action === 'unsubscribe') {
            await this.expectOk(creds, waWebUnsubscribeRequest(creds, plan.phone, plan.reason), 'Dar de baja', steps);
            return { ok: true, message: `El número +${plan.phone} quedó dado de baja en Whats.`, outputs: {} };
        }

        // El resto trabaja sobre el contacto (lo crea si hace falta).
        const create = !['remove_tags', 'remove_from_group', 'reply_conversation', 'conversation_status'].includes(plan.action);
        const name = 'createName' in plan ? plan.createName : '';
        const contact = await this.resolveContact(creds, connectionId, plan.phone, { create, name, useCache }, steps);
        if (!contact) {
            const what =
                plan.action === 'remove_tags'
                    ? 'no había etiquetas que quitar'
                    : plan.action === 'remove_from_group'
                      ? 'no estaba en ningún grupo'
                      : 'no tiene una conversación';
            return { ok: true, skipped: true, message: `El contacto +${plan.phone} no está en Whats: ${what}.`, outputs: {} };
        }
        const outputs: Record<string, string> = { contacto_id: String(contact.id) };
        const newNote = contact.created ? ' (se creó el contacto)' : '';
        try {
            switch (plan.action) {
                case 'add_tags':
                case 'remove_tags': {
                    const add = plan.action === 'add_tags';
                    const r = await this.idsByName(creds, connectionId, 'tags', plan.tags, plan.createMissing, steps);
                    if (r.ids.length === 0) {
                        return { ok: true, skipped: true, message: `Ninguna de esas etiquetas existe en Whats (${r.missing.map((m) => `«${m}»`).join(', ')}).`, outputs };
                    }
                    await this.expectOk(creds, waWebContactTagsRequest(creds, contact.id, r.ids, add), add ? 'Poner las etiquetas' : 'Quitar las etiquetas', steps);
                    const names = plan.tags.filter((t) => !r.missing.includes(t)).map((t) => `«${t}»`).join(', ');
                    const extra = [
                        r.created.length > 0 ? `se crearon ${r.created.map((t) => `«${t}»`).join(', ')}` : '',
                        r.missing.length > 0 ? `no existen ${r.missing.map((t) => `«${t}»`).join(', ')}` : '',
                    ]
                        .filter(Boolean)
                        .join('; ');
                    return { ok: true, message: `${add ? 'Se pusieron' : 'Se quitaron'} ${names} al contacto +${plan.phone}${newNote}${extra ? ` (${extra})` : ''}.`, outputs };
                }
                case 'add_to_group':
                case 'remove_from_group': {
                    const add = plan.action === 'add_to_group';
                    const r = await this.idsByName(creds, connectionId, 'groups', [plan.group], plan.createMissing, steps);
                    if (r.ids.length === 0) return { ok: true, skipped: true, message: `El grupo «${plan.group}» no existe en Whats.`, outputs };
                    await this.expectOk(creds, waWebGroupContactsRequest(creds, r.ids[0]!, [contact.id], add), add ? 'Agregar al grupo' : 'Quitar del grupo', steps);
                    return {
                        ok: true,
                        message: `${add ? 'Se agregó' : 'Se sacó'} el contacto +${plan.phone} ${add ? 'al' : 'del'} grupo «${plan.group}»${newNote}${r.created.length > 0 ? ' (se creó el grupo)' : ''}.`,
                        outputs,
                    };
                }
                case 'add_note':
                    await this.expectOk(creds, waWebContactNoteRequest(creds, contact.id, plan.note), 'Agregar la nota', steps);
                    return { ok: true, message: `Se agregó la nota al contacto +${plan.phone}${newNote}.`, outputs };
                case 'record_consent':
                    await this.expectOk(creds, waWebConsentRequest(creds, contact.id, { text: plan.text, source: plan.source, grantedAt: plan.grantedAt }), 'Registrar el consentimiento', steps);
                    return { ok: true, message: `Se registró el consentimiento del contacto +${plan.phone}${newNote}.`, outputs };
                case 'trigger_flow': {
                    const body = await this.expectOk(creds, waWebTriggerFlowRequest(creds, plan.flowId, contact.id, plan.variables), 'Activar el flujo', steps);
                    const run = parseWaWebFlowRun(body);
                    if (run.id !== null) outputs.ejecucion_id = String(run.id);
                    return { ok: true, message: `Se activó el flujo «${plan.flowLabel}» para el contacto +${plan.phone}${newNote}${run.id !== null ? ` (ejecución ${run.id})` : ''}.`, outputs };
                }
                case 'enroll_drip': {
                    const body = await this.expectOk(creds, waWebEnrollDripRequest(creds, plan.dripId, contact.id), 'Inscribir en el goteo', steps);
                    const r = parseWaWebEnroll(body);
                    outputs.inscrito = r.enrolled > 0 ? 'Sí' : 'No';
                    if (r.enrolled > 0) return { ok: true, message: `Se inscribió el contacto +${plan.phone} en el goteo «${plan.dripLabel}»${newNote}.`, outputs };
                    return {
                        ok: true,
                        skipped: true,
                        message: `Whats no inscribió al contacto +${plan.phone} en el goteo «${plan.dripLabel}»: está bloqueado o ya estuvo inscrito y el goteo no permite repetir.`,
                        outputs,
                    };
                }
                case 'reply_conversation':
                case 'conversation_status': {
                    let convId = plan.conversationId;
                    if (convId === null) {
                        const body = await this.expectOk(creds, waWebFindConversationsRequest(creds, plan.phone), 'Buscar la conversación', steps);
                        convId = pickConversation(parseWaWebConversations(body), contact.id)?.id ?? null;
                    }
                    if (convId === null) return { ok: true, skipped: true, message: `El contacto +${plan.phone} no tiene una conversación de WhatsApp en Whats.`, outputs };
                    outputs.conversacion_id = String(convId);
                    if (plan.action === 'reply_conversation') {
                        const body = await this.expectOk(creds, waWebReplyRequest(creds, convId, plan.message), 'Responder', steps);
                        const mid = parseWaWebMessageId(body);
                        if (mid) outputs.mensaje_id = mid;
                        return { ok: true, message: `Se respondió en la conversación de +${plan.phone}.`, outputs };
                    }
                    await this.expectOk(creds, waWebConversationStatusRequest(creds, convId, plan.operation), plan.operation === 'resolve' ? 'Resolver' : 'Reabrir', steps);
                    return { ok: true, message: `Se ${plan.operation === 'resolve' ? 'resolvió' : 'reabrió'} la conversación de +${plan.phone}.`, outputs };
                }
            }
        } catch (err) {
            // El id recordado ya no existe en Whats (borraron el contacto): se olvida y se busca de nuevo, una vez.
            if (err instanceof WhatsCallError && contact.cached && (err.err.status === 404 || err.err.code === 'contact_not_found' || err.err.code === 'contact_deleted')) {
                await this.cacheDel(this.contactKey(connectionId, plan.phone));
                return this.run(creds, connectionId, plan, steps, false);
            }
            throw err;
        }
        return { ok: false, message: describeWhatsPlan(plan), outputs };
    }
}

function statusLabel(status: string | null): string | null {
    if (!status) return null;
    const map: Record<string, string> = { active: 'Activo', published: 'Publicado', draft: 'Borrador', paused: 'Pausado', inactive: 'Inactivo' };
    return map[status] ?? status;
}

/** Los pasos sin la clave (ni en la URL ni en el cuerpo). */
function redactSteps(steps: WhatsActionStep[], creds: WaWebCreds): WhatsActionStep[] {
    const hide = [creds.key].filter((x) => x.length >= 4);
    return steps.map((s) => ({ ...s, url: redactValues(s.url, hide), body: s.body !== null ? redactValues(s.body, hide) : null }));
}

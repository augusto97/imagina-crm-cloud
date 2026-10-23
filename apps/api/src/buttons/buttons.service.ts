import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    BUTTON_ROLES,
    FALLBACK_TIME_ZONE,
    buttonActionProblem,
    buttonChangesRecord,
    buttonConfigSchema,
    buttonDisabledState,
    buttonLabel,
    buttonSupportsBulk,
    computeButtonValue,
    jsonbKeyForField,
    readStoreListMarker,
    roleHasCapability,
    storeCellAccess,
    tenantFormatSchema,
    zonedToday,
    type ButtonAction,
    type ButtonActionResult,
    type ButtonConfig,
    type ButtonPressStatus,
    type Field,
    type List,
    type PressButtonBulkResult,
    type PressButtonResult,
    type RecordDto,
    type TenantFormat,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { AutomationsService } from '../automations/automations.service';
import { coerceFieldValue } from '../automations/field-coercion';
import { applyMergeTags, labelResolverFor, regionalFormatterFor, singleTagToken, type LabelFieldLike } from '../automations/merge-tags';
import { automationRuns, automations, memberships, tenants, users } from '../db/schema';
import { DocumentsService } from '../documents/documents.service';
import { FieldsService } from '../fields/fields.service';
import { effectivePermissions, hiddenFieldsFor, resolvePermissions, rowInScope } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { buildButtonUrl } from './button-url';

const DEFAULT_FORMAT: Pick<TenantFormat, 'number_format' | 'date_format' | 'time_format'> = {
    number_format: 'comma_dot',
    date_format: 'ymd',
    time_format: 'h24',
};

/** Lo que el botón necesita del lugar donde se presiona (equipo o portal). */
export interface PressScope {
    /** Portal del cliente: las variables del enlace sólo ven estos campos. */
    visibleFieldIds?: ReadonlySet<number>;
    /** Portal: cómo se escriben los campos (el PATCH del portal, con su whitelist). */
    writeFields?: (patch: Record<string, unknown>) => Promise<void>;
    /** Portal: el PDF de una plantilla publicada (descarga). */
    portalPdf?: (templateId: number) => Promise<{ filename: string; pdf: string; number: string | null }>;
    /** El presionado viene del lote: sin realtime por fila (se emite al final). */
    silent?: boolean;
    /** Portal: no se re-chequean roles del equipo (los decide el diseño del portal). */
    portal?: boolean;
    /**
     * Portal: con quién se LEE el registro. El rol `client` no ve registros por
     * el ACL de la lista (lo autoriza el vínculo del portal, ya verificado):
     * se lee completo para evaluar «deshabilitado si…», y las variables del
     * enlace sólo ven `visibleFieldIds`.
     */
    readAs?: Actor;
}

/** El estado de un botón para presionar: lista, campo, config y registro. */
interface Prepared {
    list: List;
    fields: Field[];
    field: Field;
    config: ButtonConfig;
    label: string;
    /** Por acción «Correr una automatización» (índice): las que se ponen en marcha. */
    listening: Map<number, Array<{ id: number; name: string }>>;
}

/**
 * Campo «Botón» (A5) — presionar un botón de un registro.
 *
 * El servidor RE-CHEQUEA todo lo que la interfaz ya mostró (roles, «deshabilitado
 * si…», poder editar el registro, lo que acepta la tienda) y recién después
 * ejecuta las acciones EN ORDEN. Cada escritura va por los caminos de siempre:
 * `RecordsService.update` (ACL, validaciones de campo, actividad, realtime,
 * automatizaciones y envío de la tienda), el motor de automatizaciones por la
 * cola, y los documentos PDF. Si una acción falla, las siguientes no corren y
 * la respuesta dice cuál y por qué.
 */
@Injectable()
export class ButtonsService {
    private readonly logger = new Logger(ButtonsService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fieldsService: FieldsService,
        private readonly records: RecordsService,
        private readonly activity: ActivityService,
        private readonly dispatcher: AutomationDispatcher,
        private readonly automations: AutomationsService,
        private readonly documents: DocumentsService,
        private readonly realtime: RealtimeService,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ── Presionar ────────────────────────────────────────────────────────

    async press(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        fieldId: number,
        scope: PressScope = {},
    ): Promise<PressButtonResult> {
        const prep = await this.prepare(tenantId, actor, listIdOrSlug, fieldId, scope);
        const record = await this.records.get(tenantId, scope.readAs ?? actor, String(prep.list.id), recordId);
        await this.preflight(tenantId, actor, prep, record, scope);
        return this.execute(tenantId, actor, prep, record, scope);
    }

    /**
     * Presionar sobre varios registros (la selección de la tabla). Sólo para
     * botones que no abren enlaces ni descargan (ver `buttonSupportsBulk`).
     * Cada fila pasa por TODOS los chequeos; una que falla no frena al resto.
     */
    async pressBulk(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        fieldId: number,
        ids: number[],
    ): Promise<PressButtonBulkResult> {
        const prep = await this.prepare(tenantId, actor, listIdOrSlug, fieldId, {});
        if (!buttonSupportsBulk(prep.config)) {
            throw new BadRequestException({
                code: 'button_no_bulk',
                message: `«${prep.label}» abre un enlace o descarga un PDF: se presiona de a un registro.`,
                data: { status: 400 },
            });
        }
        const results: PressButtonBulkResult['results'] = [];
        for (const id of [...new Set(ids)]) {
            try {
                const record = await this.records.get(tenantId, actor, String(prep.list.id), id);
                await this.preflight(tenantId, actor, prep, record, {});
                const res = await this.execute(tenantId, actor, prep, record, { silent: true });
                results.push({ id, ok: res.ok, message: res.message });
            } catch (err) {
                results.push({ id, ok: false, message: errorMessage(err) });
            }
        }
        this.realtime.records(tenantId, prep.list.id);
        const ok = results.filter((r) => r.ok).length;
        return { results, ok, failed: results.length - ok };
    }

    /** Cómo terminaron las automatizaciones que inició un botón. */
    async pressStatus(tenantId: number, listIdOrSlug: string, pressId: string): Promise<ButtonPressStatus> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const job = await this.dispatcher.buttonJob(tenantId, pressId);
        if (job.state !== 'done') return { state: job.state, runs: [] };
        const runIds = job.runs.map((r) => r.run_id);
        if (runIds.length === 0) return { state: 'done', runs: [] };
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ runId: automationRuns.id, automationId: automationRuns.automationId, status: automationRuns.status, error: automationRuns.error, name: automations.name })
                .from(automationRuns)
                .innerJoin(automations, eq(automations.id, automationRuns.automationId))
                .where(and(eq(automationRuns.tenantId, tenantId), eq(automations.listId, list.id), inArray(automationRuns.id, runIds))),
        );
        return {
            state: rows.some((r) => r.status === 'running' || r.status === 'pending') ? 'running' : 'done',
            runs: rows.map((r) => ({ automation_id: r.automationId, name: r.name, status: r.status, error: r.error ?? null })),
        };
    }

    // ── Preparación y chequeos ───────────────────────────────────────────

    private async prepare(tenantId: number, actor: Actor, listIdOrSlug: string, fieldId: number, scope: PressScope): Promise<Prepared> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fieldsService.listByListId(tenantId, list.id);
        const field = fields.find((f) => f.id === fieldId && f.type === 'button');
        if (!field) {
            throw new NotFoundException({ code: 'button_not_found', message: 'Ese botón no existe en esta lista.', data: { status: 404 } });
        }
        const parsed = buttonConfigSchema.safeParse(field.config ?? {});
        if (!parsed.success) {
            throw new BadRequestException({ code: 'button_misconfigured', message: `El botón «${field.label}» está mal configurado: revísalo en los ajustes del campo.`, data: { status: 400 } });
        }
        const config = parsed.data;
        const label = buttonLabel(config, field.label);
        if (!scope.portal) {
            // Roles: admin siempre; el resto según el botón (sin elegir, todo el equipo).
            if (actor.role === 'client') throw forbidden('button_forbidden', 'El portal tiene sus propios botones.');
            if (actor.role !== 'admin') {
                const roles = config.roles ?? [...BUTTON_ROLES];
                if (!(roles as readonly string[]).includes(actor.role)) {
                    throw forbidden('button_forbidden', `Tu rol no puede presionar «${label}».`);
                }
                // Un botón oculto para el rol (permisos de la lista) tampoco se presiona.
                if (hiddenFieldsFor(list.settings, actor.role, actor.userId).has(field.slug)) {
                    throw forbidden('button_forbidden', `«${label}» no está disponible para tu rol.`);
                }
            }
        }
        if (config.actions.length === 0) {
            throw new BadRequestException({ code: 'button_no_actions', message: `«${label}» todavía no hace nada: agrégale una acción en los ajustes del campo.`, data: { status: 400 } });
        }
        for (const action of config.actions) {
            const problem = buttonActionProblem(action);
            if (problem) {
                throw new BadRequestException({ code: 'button_incomplete', message: `«${label}» está incompleto: ${lowerFirst(problem)}.`, data: { status: 400 } });
            }
        }
        // Las automatizaciones se resuelven ANTES de ejecutar nada: si no hay
        // ninguna que escuche el botón, no se cambia ni se abre nada.
        const listening = new Map<number, Array<{ id: number; name: string }>>();
        for (const [i, action] of config.actions.entries()) {
            if (action.type !== 'run_automation') continue;
            const found = await this.listeningAutomations(tenantId, { list, field }, action.automation_id ?? null);
            if (found.length === 0) {
                throw new BadRequestException({
                    code: 'button_no_automation',
                    message: action.automation_id
                        ? 'La automatización del botón ya no existe, está pausada o no escucha este botón.'
                        : 'Ninguna automatización activa escucha este botón. Crea una con el disparador «Al presionar el botón».',
                    data: { status: 400 },
                });
            }
            listening.set(i, found);
        }
        return { list, fields, field, config, label, listening };
    }

    /** Lo que se re-chequea por registro ANTES de ejecutar nada. */
    private async preflight(tenantId: number, actor: Actor, prep: Prepared, record: RecordDto, scope: PressScope): Promise<void> {
        const timeZone = await this.timeZone(tenantId);
        const byId = new Map(prep.fields.map((f) => [f.id, f]));
        const state = buttonDisabledState(prep.config, (id) => fieldValueOf(byId.get(id), record), { timeZone });
        if (state.disabled) {
            throw new ConflictException({ code: 'button_disabled', message: `No se puede presionar «${prep.label}»: ${state.reason ?? ''}`.trim(), data: { status: 409, reason: state.reason } });
        }
        if (scope.portal) return;
        if (buttonChangesRecord(prep.config)) {
            const caps = roleHasCapability(actor.role, 'edit_records') || roleHasCapability(actor.role, 'edit_own_records');
            const scopeEdit = effectivePermissions(prep.list.settings, actor.role, actor.userId).edit;
            const assignmentId = resolvePermissions(prep.list.settings).assignment_field_id;
            const reach = rowInScope(scopeEdit, actor.userId, {
                createdBy: record.created_by,
                assignmentValue: assignmentId ? record.data[jsonbKeyForField(assignmentId)] : null,
            });
            if (!caps || !reach) {
                throw forbidden('button_needs_edit', `«${prep.label}» cambia el registro y tú no puedes editarlo.`);
            }
            // La tienda (WooCommerce) manda: sólo las columnas que acepta.
            const marker = readStoreListMarker(prep.list.settings);
            if (marker) {
                const row = (slug: string): unknown => {
                    const id = marker.fields[slug];
                    return id ? record.data[`f${id}`] : undefined;
                };
                for (const id of writtenIds(prep.config)) {
                    const access = storeCellAccess(marker, id, row);
                    if (access.access === 'locked') {
                        throw forbidden('store_field_locked', `${byId.get(id)?.label ?? 'Esa columna'}: ${access.reason}`);
                    }
                }
            }
        }
    }

    // ── Ejecutar ─────────────────────────────────────────────────────────

    private async execute(tenantId: number, actor: Actor, prep: Prepared, record: RecordDto, scope: PressScope): Promise<PressButtonResult> {
        const results: ButtonActionResult[] = [];
        let current = record;
        let changed = false;
        let failed: string | null = null;
        const env = await this.env(tenantId, actor);

        for (const action of prep.config.actions) {
            if (failed !== null) {
                results.push({ type: action.type, ok: false, skipped: true, error: 'No se ejecutó porque falló una acción anterior.' });
                continue;
            }
            try {
                const res = await this.runAction(tenantId, actor, prep, current, action, env, scope);
                results.push(res.result);
                if (res.record) {
                    current = res.record;
                    changed = true;
                }
            } catch (err) {
                failed = errorMessage(err);
                results.push({ type: action.type, ok: false, error: failed });
            }
        }

        await this.logPress(tenantId, actor, prep, record.id, results).catch((err: unknown) =>
            this.logger.warn(`No se pudo registrar la actividad del botón ${prep.field.id}: ${String(err)}`),
        );
        // La actividad nueva y el cambio (si lo hubo) llegan a las pestañas abiertas.
        if (!changed && !scope.silent) this.realtime.records(tenantId, prep.list.id);

        const ok = failed === null;
        return {
            ok,
            message: ok ? `Listo: «${prep.label}».` : `«${prep.label}» no terminó. ${failed ?? ''}`.trim(),
            actions: results,
            record: changed ? (current as unknown as Record<string, unknown>) : null,
        };
    }

    private async runAction(
        tenantId: number,
        actor: Actor,
        prep: Prepared,
        record: RecordDto,
        action: ButtonAction,
        env: PressEnv,
        scope: PressScope,
    ): Promise<{ result: ButtonActionResult; record?: RecordDto }> {
        switch (action.type) {
            case 'open_url': {
                const ctx = this.mergeContext(prep, record, env, scope);
                const built = buildButtonUrl(action.url, {
                    valueOf: ctx.valueOf,
                    typeOf: ctx.typeOf,
                    recordId: record.id,
                    resolveLabel: labelResolverFor(ctx.fieldsBySlug),
                    formatValue: regionalFormatterFor(ctx.fieldsBySlug, env.format, env.timeZone),
                });
                if (!built.ok) throw new BadRequestException({ code: 'button_bad_url', message: built.error, data: { status: 400 } });
                return { result: { type: 'open_url', ok: true, url: built.url } };
            }
            case 'update_fields': {
                const { patch, labels } = this.buildPatch(prep, record, action, env, scope);
                if (Object.keys(patch).length === 0) return { result: { type: 'update_fields', ok: true, changed: [] } };
                if (scope.writeFields) {
                    await scope.writeFields(patch);
                    const fresh = { ...record, data: { ...record.data, ...patch } };
                    return { result: { type: 'update_fields', ok: true, changed: labels }, record: fresh };
                }
                const updated = await this.records.update(tenantId, actor, String(prep.list.id), record.id, { data: patch } as never, {
                    silent: scope.silent === true,
                });
                return { result: { type: 'update_fields', ok: true, changed: labels }, record: updated };
            }
            case 'run_automation': {
                const listening = prep.listening.get(prep.config.actions.indexOf(action)) ?? [];
                const pressId = await this.dispatcher.dispatchButton({
                    tenantId,
                    listId: prep.list.id,
                    recordId: record.id,
                    trigger: 'button_pressed',
                    after: record.data,
                    button: { field_id: prep.field.id, label: prep.label, user_id: actor.userId, user_name: env.user.name, user_email: env.user.email },
                    automation_ids: listening.map((a) => a.id),
                });
                if (pressId === null) {
                    throw new BadRequestException({ code: 'automations_unavailable', message: 'Las automatizaciones no están disponibles en este momento.', data: { status: 400 } });
                }
                return { result: { type: 'run_automation', ok: true, automations: listening, press_id: pressId } };
            }
            case 'generate_pdf': {
                const templateId = action.document_template_id!;
                if (scope.portalPdf) {
                    const doc = await scope.portalPdf(templateId);
                    return { result: { type: 'generate_pdf', ok: true, filename: doc.filename, number: doc.number, pdf: doc.pdf, file_id: null } };
                }
                const saveField = action.mode === 'save' ? prep.fields.find((f) => f.id === action.save_field_id && f.type === 'file') : null;
                if (action.mode === 'save' && !saveField) {
                    throw new BadRequestException({ code: 'invalid_save_field', message: 'El campo Archivo donde se guarda el PDF ya no existe.', data: { status: 400 } });
                }
                const doc = await this.documents.generateForRecord(tenantId, actor, String(prep.list.id), record.id, templateId, {
                    record_id: record.id,
                    save_field: saveField?.slug ?? null,
                    save_mode: action.save_mode,
                });
                const result: ButtonActionResult = {
                    type: 'generate_pdf',
                    ok: true,
                    filename: doc.filename,
                    number: doc.number,
                    pdf: action.mode === 'download' ? doc.pdf : null,
                    file_id: doc.file_id,
                };
                if (saveField) {
                    const fresh = await this.records.get(tenantId, actor, String(prep.list.id), record.id);
                    return { result, record: fresh };
                }
                return { result };
            }
            default:
                throw new BadRequestException({ code: 'button_unknown_action', message: 'Acción desconocida.', data: { status: 400 } });
        }
    }

    /**
     * El cambio de UNA acción «Cambiar campos»: el valor nuevo de cada campo,
     * validado y convertido al tipo del campo (con las mismas reglas que una
     * automatización). Un valor que no entra frena el botón con el motivo.
     */
    private buildPatch(
        prep: Prepared,
        record: RecordDto,
        action: Extract<ButtonAction, { type: 'update_fields' }>,
        env: PressEnv,
        scope: PressScope,
    ): { patch: Record<string, unknown>; labels: string[] } {
        const byId = new Map(prep.fields.map((f) => [f.id, f]));
        const patch: Record<string, unknown> = {};
        const labels: string[] = [];
        const ctx = this.mergeContext(prep, record, env, scope);
        for (const v of action.values) {
            const field = byId.get(v.field_id);
            if (!field) throw badRequest('button_field_gone', 'Uno de los campos que cambia el botón ya no existe.');
            const key = jsonbKeyForField(field.id);
            const computed = computeButtonValue(v.mode, field, record.data[key], {
                configured: v.value,
                today: env.today,
                nowIso: new Date().toISOString(),
                userId: env.user.id,
            });
            if (!computed.ok) throw badRequest('button_bad_value', `${field.label}: ${computed.error}`);
            let value = computed.value;
            if (v.mode === 'set' && typeof value === 'string') {
                const single = singleTagToken(value);
                value = single !== null
                    ? ctx.valueOf(single)
                    : applyMergeTags(value, ctx.valueOf, record.id, undefined, labelResolverFor(ctx.fieldsBySlug), regionalFormatterFor(ctx.fieldsBySlug, env.format, env.timeZone));
            }
            if (value !== null) {
                const coerced = coerceFieldValue(field, value, { timeZone: env.timeZone, format: env.format, fromVariable: v.mode !== 'set' || singleTagToken(String(v.value ?? '')) !== null });
                if (!coerced.ok) throw badRequest('button_bad_value', `${field.label}: ${coerced.error}`);
                value = coerced.value;
            }
            patch[key] = value;
            labels.push(field.label);
        }
        return { patch, labels };
    }

    /** Las automatizaciones activas que escuchan este botón (o la elegida). */
    private async listeningAutomations(tenantId: number, prep: Pick<Prepared, 'list' | 'field'>, wanted: number | null): Promise<Array<{ id: number; name: string }>> {
        const all = await this.automations.list(tenantId, String(prep.list.id));
        return all
            .filter((a) => a.is_active && a.trigger_type === 'button_pressed')
            .filter((a) => {
                const target = Number((a.trigger_config as { button_field_id?: unknown }).button_field_id);
                return !(Number.isInteger(target) && target > 0) || target === prep.field.id;
            })
            .filter((a) => wanted === null || a.id === wanted)
            .map((a) => ({ id: a.id, name: a.name }));
    }

    /** «Ana presionó «Marcar como pagado»» en la actividad del registro. */
    private async logPress(tenantId: number, actor: Actor, prep: Prepared, recordId: number, results: ButtonActionResult[]): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            this.activity.logInTx(tx, {
                tenantId,
                listId: prep.list.id,
                recordId,
                userId: actor.userId > 0 ? actor.userId : null,
                action: 'button_pressed',
                diff: {
                    button: {
                        field_id: prep.field.id,
                        label: prep.label,
                        ok: results.every((r) => r.ok),
                        actions: results.map((r) => r.type),
                        ...(results.some((r) => !r.ok && !('skipped' in r))
                            ? { error: (results.find((r) => !r.ok && !('skipped' in r)) as { error?: string } | undefined)?.error ?? null }
                            : {}),
                    },
                },
            }),
        );
    }

    // ── Variables ────────────────────────────────────────────────────────

    /**
     * Acceso a las variables `{{slug}}` del registro (las claves que ve quien
     * presiona: lo oculto por su rol no viene en el registro). En el portal,
     * sólo los campos que el diseño le muestra al cliente.
     */
    private mergeContext(prep: Prepared, record: RecordDto, env: PressEnv, scope: PressScope) {
        const visible = (f: Field): boolean => !scope.visibleFieldIds || scope.visibleFieldIds.has(f.id);
        const bySlug = new Map(prep.fields.filter(visible).map((f) => [f.slug, f]));
        const fieldsBySlug = new Map<string, LabelFieldLike>([...bySlug].map(([slug, f]) => [slug, { type: f.type, config: f.config, label: f.label }]));
        const valueOf = (token: string): unknown => {
            if (token === 'date.today') return env.today;
            if (token === 'date.now') return new Date().toISOString().slice(0, 19).replace('T', ' ');
            if (token === 'boton.nombre') return prep.label;
            if (token === 'boton.persona') return env.user.name;
            if (token === 'boton.email') return env.user.email;
            const person = /^([a-zA-Z0-9_]+)\.(email|nombre)$/.exec(token);
            if (person) {
                const f = bySlug.get(person[1]!);
                if (!f || (f.type !== 'user' && f.type !== 'created_by' && f.type !== 'updated_by')) return '';
                const info = env.people.get(Number(record.data[jsonbKeyForField(f.id)]));
                return info ? (person[2] === 'email' ? info.email : info.name) : '';
            }
            const f = bySlug.get(token);
            if (!f) return undefined;
            return record.data[jsonbKeyForField(f.id)];
        };
        const typeOf = (token: string): string | undefined => bySlug.get(token)?.type;
        return { valueOf, typeOf, fieldsBySlug };
    }

    private async env(tenantId: number, actor: Actor): Promise<PressEnv> {
        const timeZone = await this.timeZone(tenantId);
        const { format, people, user } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
            const parsed = tenantFormatSchema.safeParse((tenant?.settings as Record<string, unknown> | null | undefined)?.format ?? {});
            // Las personas del equipo (para `{{responsable.nombre}}`): pocas y cacheables.
            const rows = await tx
                .select({ id: users.id, name: users.name, email: users.email })
                .from(users)
                .innerJoin(memberships, eq(memberships.userId, users.id))
                .where(and(eq(memberships.tenantId, tenantId), ne(memberships.role, 'client'), isNull(users.disabledAt)));
            const people = new Map(rows.map((r) => [r.id, { name: r.name ?? '', email: r.email }]));
            let user = people.get(actor.userId);
            if (!user && actor.userId > 0) {
                const [u] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1);
                user = u ? { name: u.name ?? '', email: u.email } : undefined;
            }
            return { format: parsed.success ? parsed.data : DEFAULT_FORMAT, people, user: { id: actor.userId, name: user?.name ?? '', email: user?.email ?? '' } };
        });
        return { timeZone, today: zonedToday(timeZone), format, people, user };
    }

    private timeZone(tenantId: number): Promise<string> {
        return this.timeZones ? this.timeZones.orUtc(tenantId) : Promise.resolve(FALLBACK_TIME_ZONE);
    }
}

interface PressEnv {
    timeZone: string;
    today: string;
    format: Pick<TenantFormat, 'number_format' | 'date_format' | 'time_format'>;
    people: Map<number, { name: string; email: string }>;
    user: { id: number; name: string; email: string };
}

/** El valor de un campo en el registro, como lo espera el evaluador de condiciones. */
export function fieldValueOf(field: Field | undefined, record: RecordDto): { type: string; value: unknown } | undefined {
    if (!field) return undefined;
    const key = jsonbKeyForField(field.id);
    if (field.type === 'relation') return { type: field.type, value: record.relations?.[key] ?? [] };
    return { type: field.type, value: record.data[key] };
}

function writtenIds(config: ButtonConfig): number[] {
    const ids = new Set<number>();
    for (const a of config.actions) {
        if (a.type === 'update_fields') for (const v of a.values) ids.add(v.field_id);
        if (a.type === 'generate_pdf' && a.mode === 'save' && a.save_field_id) ids.add(a.save_field_id);
    }
    return [...ids];
}

function forbidden(code: string, message: string): ForbiddenException {
    return new ForbiddenException({ code, message, data: { status: 403 } });
}

function badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

function lowerFirst(s: string): string {
    return s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** El motivo legible de un error (el `message` de una excepción HTTP de la app). */
export function errorMessage(err: unknown): string {
    const resp = (err as { getResponse?: () => unknown }).getResponse?.();
    if (resp && typeof resp === 'object') {
        const r = resp as { message?: unknown; data?: { errors?: Record<string, unknown> } };
        const errors = r.data?.errors;
        if (errors && typeof errors === 'object' && Object.keys(errors).length > 0) {
            return Object.entries(errors)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join('; ');
        }
        if (typeof r.message === 'string') return r.message;
    }
    return err instanceof Error ? err.message : 'Error desconocido';
}

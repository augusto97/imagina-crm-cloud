import { isIP } from 'node:net';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    helpdeskSettingsSchema,
    readHelpdeskMailboxMarker,
    readHelpdeskSettings,
    SLA_STATUS_OPTIONS,
    type Field,
    type HelpdeskMailboxDto,
    type HelpdeskMailboxInput,
    type HelpdeskMailboxMarker,
    type HelpdeskMailboxTestInput,
    type HelpdeskMessageDto,
    type HelpdeskSettings,
    type ImapDiagnostic,
    type ImapPresetKey,
    type ImapSecurity,
    type List,
    type UpdateHelpdeskSettingsInput,
} from '@imagina-base/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { resolvePublicHost } from '../common/safe-fetch';
import { decryptSecret, encryptSecret, isEncrypted } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import { helpdeskMailboxes, helpdeskMessages, memberships, teams, type HelpdeskMailboxRow, type HelpdeskMessageRow } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { IncidentHub } from '../incidents/incident-hub';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { HelpdeskQueue } from './helpdesk.queue';
import { helpdeskSettingsErrors } from './helpdesk-validate';
import { IMAP_READER, imapErrorDiagnostic, type ImapReader, type ImapSession } from './imap-reader';
import { staffRoleSql } from './staff-roles';

/** Tope de la prueba de conexión (un servidor que no contesta no cuelga el botón). */
const TEST_TIMEOUT_MS = 30_000;

export type MailboxPassword = { state: 'ok'; pass: string } | { state: 'none' } | { state: 'unreadable'; reason: string };

/** La conexión no se pudo abrir: el diagnóstico en lenguaje claro. */
export class HelpdeskConnectError extends Error {
    constructor(readonly diagnostic: ImapDiagnostic) {
        super(`${diagnostic.message} ${diagnostic.hints[0] ?? ''}`.trim());
    }
}

function bad(message: string, errors?: Record<string, string>): BadRequestException {
    return new BadRequestException({ code: 'invalid_helpdesk_settings', message, data: { status: 400, ...(errors ? { errors } : {}) } });
}

/**
 * D2/E5 — Configuración de la mesa de ayuda de una lista: el BUZÓN (conexión
 * IMAP con la contraseña cifrada) y los AJUSTES (mapeo a campos, estados,
 * protecciones, plantillas de respuesta y política de SLA) que viven en
 * `lists.settings.helpdesk`. Todo lo maneja quien arma la lista
 * (`manage_lists`): conectar el buzón es decidir que los correos de los
 * clientes entren a la app.
 */
@Injectable()
export class HelpdeskConfigService {
    private readonly logger = new Logger(HelpdeskConfigService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(ENV) private readonly env: Env,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly audit: AuditService,
        @Inject(IMAP_READER) private readonly reader: ImapReader,
        private readonly queue: HelpdeskQueue,
        @Optional() private readonly incidents?: IncidentHub,
    ) {}

    // ── Ajustes ──────────────────────────────────────────────────────────

    async getSettings(tenantId: number, listIdOrSlug: string): Promise<{ settings: HelpdeskSettings; mailbox: HelpdeskMailboxMarker | null }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return { settings: readHelpdeskSettings(list.settings), mailbox: readHelpdeskMailboxMarker(list.settings) };
    }

    async updateSettings(tenantId: number, actorId: number, listIdOrSlug: string, patch: UpdateHelpdeskSettingsInput): Promise<HelpdeskSettings> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = readHelpdeskSettings(list.settings);
        const parsed = helpdeskSettingsSchema.safeParse({
            ...current,
            ...patch,
            sla: { ...current.sla, ...(patch.sla ?? {}), calendar: { ...current.sla.calendar, ...(patch.sla?.calendar ?? {}) } },
        });
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            throw bad(`La configuración no es válida: ${issue?.message ?? 'forma inesperada'}.`, { [(issue?.path ?? []).join('.')]: issue?.message ?? '' });
        }
        const next = parsed.data;
        const fields = await this.fields.listByListId(tenantId, list.id);
        const errors = helpdeskSettingsErrors(next, fields);
        await this.checkContactMatch(tenantId, next, fields, errors);
        await this.checkMembers(tenantId, next, errors);
        await this.checkTeams(tenantId, next, errors);
        if (Object.keys(errors).length > 0) {
            const first = Object.values(errors)[0]!;
            throw bad(first, errors);
        }
        await this.writeSettings(tenantId, list, next);
        await this.audit.log({
            tenantId,
            userId: actorId,
            action: 'helpdesk.settings',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { sla_enabled: next.sla.enabled },
        });
        // El SLA cambió (política, horario, columnas): se recalculan los tickets.
        if (JSON.stringify(current.sla) !== JSON.stringify(next.sla) || JSON.stringify(current.closed_statuses) !== JSON.stringify(next.closed_statuses) || JSON.stringify(current.paused_statuses) !== JSON.stringify(next.paused_statuses)) {
            this.queue.enqueueSlaList(tenantId, list.id);
        }
        return next;
    }

    /**
     * «Crear columnas del SLA»: los dos vencimientos (fecha y hora) y el estado
     * (selección con sus colores). Son columnas GUARDADAS de la lista: filtran,
     * ordenan, agrupan, entran al calendario, a «Mi trabajo» y al export sin
     * nada especial (ver el ADR). Las que ya existen no se duplican.
     */
    async createSlaColumns(tenantId: number, actorId: number, listIdOrSlug: string): Promise<HelpdeskSettings> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const s = readHelpdeskSettings(list.settings);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const alive = (id: number | null): boolean => id !== null && fields.some((f) => f.id === id);
        const sla = { ...s.sla };
        // La resolución primero: «Mi trabajo» toma el primer «Vence…» como vencimiento.
        if (!alive(sla.resolution_due_field_id)) {
            sla.resolution_due_field_id = (await this.fields.create(tenantId, String(list.id), { label: 'Vence resolución', type: 'datetime' })).id;
        }
        if (!alive(sla.first_due_field_id)) {
            sla.first_due_field_id = (await this.fields.create(tenantId, String(list.id), { label: 'Vence primera respuesta', type: 'datetime' })).id;
        }
        if (!alive(sla.sla_status_field_id)) {
            sla.sla_status_field_id = (
                await this.fields.create(tenantId, String(list.id), {
                    label: 'Estado del SLA',
                    type: 'select',
                    config: { options: SLA_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label, color: o.color })) },
                })
            ).id;
        }
        return this.updateSettings(tenantId, actorId, String(list.id), { sla });
    }

    private async writeSettings(tenantId: number, list: List, next: HelpdeskSettings): Promise<void> {
        const fresh = await this.lists.get(tenantId, String(list.id));
        const marker = readHelpdeskMailboxMarker(fresh.settings);
        await this.lists.update(
            tenantId,
            String(list.id),
            { settings: { ...fresh.settings, helpdesk: { ...next, ...(marker ? { mailbox: marker } : {}) } } },
            { helpdeskMailbox: true },
        );
    }

    /** El vínculo al contacto: el campo de búsqueda tiene que ser un correo de la OTRA lista. */
    private async checkContactMatch(tenantId: number, s: HelpdeskSettings, fields: readonly Field[], errors: Record<string, string>): Promise<void> {
        if (s.contact_field_id === null) {
            if (s.contact_match_field_id !== null) errors.contact_match_field_id = 'Primero elige el campo de vínculo al contacto.';
            return;
        }
        const rel = fields.find((f) => f.id === s.contact_field_id);
        const target = Number((rel?.config as { target_list_id?: unknown } | undefined)?.target_list_id);
        if (!rel || !Number.isInteger(target) || target <= 0) return;
        const targetFields = await this.fields.listByListId(tenantId, target).catch(() => [] as Field[]);
        if (s.contact_match_field_id === null) {
            if (!targetFields.some((f) => f.type === 'email')) errors.contact_field_id = 'La lista de contactos no tiene un campo de correo para buscar.';
            return;
        }
        const m = targetFields.find((f) => f.id === s.contact_match_field_id);
        if (!m || (m.type !== 'email' && m.type !== 'text')) errors.contact_match_field_id = 'Elige un campo de correo de la lista de contactos.';
    }

    /** Las personas de los avisos y del escalamiento tienen que ser del EQUIPO. */
    private async checkMembers(tenantId: number, s: HelpdeskSettings, errors: Record<string, string>): Promise<void> {
        const ids = [...new Set([...s.sla.notify_user_ids, ...s.sla.escalate_user_ids, ...(s.sla.escalate_set_user_id ? [s.sla.escalate_set_user_id] : [])])];
        if (ids.length === 0) return;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ userId: memberships.userId })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids), staffRoleSql())),
        );
        const ok = new Set(rows.map((r) => r.userId));
        const missing = ids.filter((id) => !ok.has(id));
        if (missing.length > 0) errors['sla.notify_user_ids'] = 'Sólo se puede avisar o escalar a personas del equipo de esta empresa.';
    }

    /** C1 — los equipos a los que se avisa o escala tienen que ser de la empresa. */
    private async checkTeams(tenantId: number, s: HelpdeskSettings, errors: Record<string, string>): Promise<void> {
        const ids = [...new Set([...s.sla.notify_team_ids, ...s.sla.escalate_team_ids])];
        if (ids.length === 0) return;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ id: teams.id }).from(teams).where(and(eq(teams.tenantId, tenantId), inArray(teams.id, ids))),
        );
        const ok = new Set(rows.map((r) => r.id));
        if (ids.some((id) => !ok.has(id))) errors['sla.notify_team_ids'] = 'Ese equipo ya no existe en esta empresa.';
    }

    // ── Buzón ────────────────────────────────────────────────────────────

    async getMailbox(tenantId: number, listIdOrSlug: string): Promise<HelpdeskMailboxDto | null> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.rowByList(tenantId, list.id);
        if (!row) return null;
        const recent = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(helpdeskMessages)
                .where(and(eq(helpdeskMessages.tenantId, tenantId), eq(helpdeskMessages.mailboxId, row.id)))
                .orderBy(desc(helpdeskMessages.id))
                .limit(15),
        );
        return this.toDto(row, recent);
    }

    async saveMailbox(tenantId: number, actorId: number, listIdOrSlug: string, input: HelpdeskMailboxInput): Promise<HelpdeskMailboxDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        if ((list.settings as Record<string, unknown>).store) {
            throw bad('Una lista sincronizada con una tienda no puede recibir correos: los registros nacen en la tienda.');
        }
        const existing = await this.rowByList(tenantId, list.id);
        const password = (input.password ?? '').trim();
        if (!existing && password === '') throw bad('Escribe la contraseña de aplicación del buzón.', { password: 'Obligatoria' });
        if (existing && password === '' && this.password(existing).state === 'unreadable') {
            throw bad('No se puede leer la contraseña guardada (cambió la clave de cifrado del servidor). Escríbela de nuevo.', { password: 'Obligatoria' });
        }
        // SEC-27 — el mismo guard que el SMTP de la empresa: sólo servidores públicos.
        const target = await resolvePublicHost(input.host, { allowPrivate: this.env.SMTP_ALLOW_PRIVATE_HOSTS });
        if (!target.ok && target.reason === 'blocked') {
            throw bad(`«${input.host}» apunta a una dirección interna. El buzón tiene que estar en un servidor accesible desde internet (el de tu proveedor de correo).`, { host: 'Dirección interna' });
        }
        const values = {
            preset: input.preset,
            host: input.host.trim().toLowerCase(),
            port: input.port,
            security: input.security,
            username: input.username.trim(),
            folder: input.folder.trim() || 'INBOX',
            supportAddress: input.support_address,
            markSeen: input.mark_seen,
            allowInvalidCert: input.allow_invalid_cert,
            enabled: input.enabled,
            updatedAt: new Date(),
            nextCheckAt: input.enabled ? new Date() : null,
            ...(password !== '' ? { passwordEnc: encryptSecret(password, this.env.SECRETS_KEY) } : {}),
        };
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (existing) {
                // Cambiar de buzón o de carpeta: el cursor por UID ya no vale (otro buzón, otros UID).
                const moved = existing.host !== values.host || existing.username !== values.username || existing.folder !== values.folder;
                const [r] = await tx
                    .update(helpdeskMailboxes)
                    .set({ ...values, ...(moved ? { state: {} } : {}) })
                    .where(and(eq(helpdeskMailboxes.tenantId, tenantId), eq(helpdeskMailboxes.id, existing.id)))
                    .returning();
                return r!;
            }
            const [r] = await tx
                .insert(helpdeskMailboxes)
                .values({ tenantId, listId: list.id, ...values, createdBy: actorId > 0 ? actorId : null, state: {} })
                .returning();
            return r!;
        });
        // La ficha muestra «Responder por correo» sólo con buzón: la marca en la lista (sin secretos).
        await this.writeMarker(tenantId, list.id, { id: row.id, support_address: row.supportAddress });
        await this.audit.log({
            tenantId,
            userId: actorId,
            action: existing ? 'helpdesk.mailbox_update' : 'helpdesk.mailbox_connect',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { host: row.host, username: row.username, support_address: row.supportAddress, enabled: row.enabled },
        });
        if (row.enabled) this.queue.enqueuePoll(tenantId, row.id);
        return (await this.getMailbox(tenantId, String(list.id)))!;
    }

    async removeMailbox(tenantId: number, actorId: number, listIdOrSlug: string): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.rowByList(tenantId, list.id);
        if (!row) throw new NotFoundException({ code: 'mailbox_not_found', message: 'La lista no tiene un buzón conectado.', data: { status: 404 } });
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(helpdeskMailboxes).where(and(eq(helpdeskMailboxes.tenantId, tenantId), eq(helpdeskMailboxes.id, row.id))),
        );
        await this.writeMarker(tenantId, list.id, null);
        this.incidents?.resolvePrefix(tenantId, `helpdesk:${row.id}`);
        await this.audit.log({
            tenantId,
            userId: actorId,
            action: 'helpdesk.mailbox_delete',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { host: row.host, username: row.username },
        });
    }

    /** «Revisar ahora»: encola una lectura (sin esperar el minuto). */
    async checkNow(tenantId: number, listIdOrSlug: string): Promise<{ queued: boolean }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.rowByList(tenantId, list.id);
        if (!row) throw new NotFoundException({ code: 'mailbox_not_found', message: 'La lista no tiene un buzón conectado.', data: { status: 404 } });
        this.queue.enqueuePoll(tenantId, row.id);
        return { queued: true };
    }

    /**
     * «Probar conexión» con lo que hay en el formulario (sin guardar). Si falta
     * la contraseña se usa la guardada. Prueba en orden: el servidor existe y
     * es público, conecta, TLS, usuario y contraseña, la carpeta.
     */
    async test(tenantId: number, listIdOrSlug: string, input: HelpdeskMailboxTestInput): Promise<ImapDiagnostic> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        let pass = (input.password ?? '').trim();
        if (pass === '') {
            const row = await this.rowByList(tenantId, list.id);
            const stored = row ? this.password(row) : { state: 'none' as const };
            if (stored.state !== 'ok') {
                return {
                    ok: false,
                    step: 'auth',
                    message: stored.state === 'unreadable' ? 'No se puede leer la contraseña guardada.' : 'Falta la contraseña.',
                    hints: ['Escribe la contraseña de aplicación del buzón y vuelve a probar.'],
                };
            }
            pass = stored.pass;
        }
        const ctx = { host: input.host, port: input.port, security: input.security, folder: input.folder || 'INBOX' };
        let session: ImapSession | null = null;
        const work = (async (): Promise<ImapDiagnostic> => {
            try {
                session = await this.connect({ host: input.host, port: input.port, security: input.security, username: input.username, pass, allowInvalidCert: input.allow_invalid_cert });
            } catch (err) {
                return err instanceof HelpdeskConnectError ? err.diagnostic : imapErrorDiagnostic(err, ctx);
            }
            let folders: string[] = [];
            try {
                folders = await session.folders();
            } catch {
                folders = [];
            }
            try {
                const box = await session.open(ctx.folder, { writable: false });
                return {
                    ok: true,
                    step: 'ok',
                    message: `Conexión correcta: la carpeta «${ctx.folder}» tiene ${box.exists === 1 ? '1 correo' : `${box.exists} correos`}.`,
                    hints: ['Al guardar, se leen los correos que lleguen DESDE AHORA (los que ya están en el buzón no crean tickets).'],
                    folders,
                    messages: box.exists,
                };
            } catch (err) {
                const d = imapErrorDiagnostic(err, ctx);
                return { ...d, ...(d.step === 'folder' ? { folders } : {}) };
            }
        })();
        const timeout = new Promise<ImapDiagnostic>((resolve) =>
            setTimeout(
                () => resolve({ ok: false, step: 'connect', message: 'El servidor tardó demasiado en responder.', hints: ['Revisa el servidor y el puerto (lo habitual es 993 con SSL/TLS).'] }),
                TEST_TIMEOUT_MS,
            ).unref(),
        );
        try {
            return await Promise.race([work, timeout]);
        } finally {
            const s = session as ImapSession | null;
            if (s) await s.close().catch(() => undefined);
        }
    }

    // ── Para el motor ────────────────────────────────────────────────────

    /** Abre la sesión IMAP con el guard anti-SSRF (IP fijada, TLS contra el nombre). */
    async connect(p: { host: string; port: number; security: ImapSecurity; username: string; pass: string; allowInvalidCert: boolean }): Promise<ImapSession> {
        const host = p.host.trim();
        const target = await resolvePublicHost(host, { allowPrivate: this.env.SMTP_ALLOW_PRIVATE_HOSTS });
        if (!target.ok) {
            throw new HelpdeskConnectError(
                target.reason === 'dns'
                    ? { ok: false, step: 'dns', message: `El servidor «${host}» no existe (no resuelve).`, hints: ['Revisa que esté bien escrito: va sólo el nombre, como imap.gmail.com.'] }
                    : { ok: false, step: 'dns', message: `«${host}» apunta a una dirección interna.`, hints: ['El buzón tiene que estar en un servidor accesible desde internet.'] },
            );
        }
        const bare = host.replace(/^\[|\]$/g, '');
        return this.reader.connect({
            host: target.address,
            servername: isIP(bare) ? '' : bare,
            port: p.port,
            security: p.security,
            user: p.username,
            pass: p.pass,
            allowInvalidCert: p.allowInvalidCert,
        });
    }

    /** La contraseña guardada, distinguiendo «no hay» de «no se puede leer» (v0.1.150). */
    password(row: Pick<HelpdeskMailboxRow, 'passwordEnc'>): MailboxPassword {
        const raw = row.passwordEnc ?? '';
        if (raw === '') return { state: 'none' };
        if (isEncrypted(raw) && !this.env.SECRETS_KEY) {
            return { state: 'unreadable', reason: 'el servidor no tiene SECRETS_KEY para descifrar la contraseña del buzón' };
        }
        try {
            return { state: 'ok', pass: decryptSecret(raw, this.env.SECRETS_KEY) };
        } catch {
            return { state: 'unreadable', reason: 'la contraseña guardada no se puede descifrar con la clave actual del servidor' };
        }
    }

    async rowByList(tenantId: number, listId: number): Promise<HelpdeskMailboxRow | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(helpdeskMailboxes)
                .where(and(eq(helpdeskMailboxes.tenantId, tenantId), eq(helpdeskMailboxes.listId, listId)))
                .limit(1),
        );
        return row ?? null;
    }

    private async writeMarker(tenantId: number, listId: number, marker: HelpdeskMailboxMarker | null): Promise<void> {
        const list = await this.lists.get(tenantId, String(listId));
        const current = ((list.settings as Record<string, unknown>).helpdesk ?? {}) as Record<string, unknown>;
        const { mailbox: _old, ...rest } = current;
        await this.lists.update(
            tenantId,
            String(listId),
            { settings: { ...list.settings, helpdesk: marker ? { ...rest, mailbox: marker } : rest } },
            { helpdeskMailbox: true },
        );
    }

    toDto(row: HelpdeskMailboxRow, recent: HelpdeskMessageRow[]): HelpdeskMailboxDto {
        const st = (row.state ?? {}) as Record<string, unknown>;
        const counts = (st.counts ?? {}) as Record<string, unknown>;
        const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
        return {
            id: row.id,
            list_id: row.listId,
            preset: row.preset as ImapPresetKey,
            host: row.host,
            port: row.port,
            security: row.security as ImapSecurity,
            username: row.username,
            folder: row.folder,
            support_address: row.supportAddress,
            mark_seen: row.markSeen,
            allow_invalid_cert: row.allowInvalidCert,
            enabled: row.enabled,
            password_state: this.password(row).state,
            state: {
                last_check_at: str(st.last_check_at),
                last_ok_at: str(st.last_ok_at),
                last_error: str(st.last_error),
                pending_reason: str(st.pending_reason),
                running: st.running === true,
                counts: { tickets: num(counts.tickets), replies: num(counts.replies), ignored: num(counts.ignored), failed: num(counts.failed) },
            },
            recent: recent.map(messageDto),
        };
    }
}

export function messageDto(m: HelpdeskMessageRow): HelpdeskMessageDto {
    return {
        id: m.id,
        direction: m.direction === 'out' ? 'out' : 'in',
        status: m.status as HelpdeskMessageDto['status'],
        reason: m.reason,
        record_id: m.recordId,
        from_email: m.fromEmail,
        from_name: m.fromName,
        to: m.toAddr,
        subject: m.subject,
        at: m.createdAt.toISOString(),
    };
}

import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    EMAIL_FONT_STACKS,
    emailSignatureHtml,
    emailThemeSchema,
    htmlToPlainText,
    jsonbKeyForField,
    readHelpdeskMailboxMarker,
    readHelpdeskSettings,
    replySubject,
    resolveTitleFieldId,
    tenantFormatSchema,
    ticketToken,
    type EmailEventInfo,
    type Field,
    type HelpdeskMailboxMarker,
    type HelpdeskReplyInput,
    type HelpdeskReplyResult,
    type HelpdeskSettings,
    type HelpdeskTicketDto,
    type List,
} from '@imagina-base/shared';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { applyMergeTags, escapeHtml, labelForFieldValue, regionalFormatterFor, type LabelFieldLike } from '../automations/merge-tags';
import { CommentsRepository } from '../comments/comments.repository';
import { emailList } from '../connectors/integration-calls';
import { comments, helpdeskMessages, helpdeskTickets, records, tenants, users, type HelpdeskTicketRow } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { errorText } from '../incidents/incident-hub';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
import { NotifyHub } from '../notifications/notify-hub';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { HelpdeskSlaService, slaDtoOf } from './helpdesk-sla.service';
import { HELPDESK_HEADER } from './inbound-mail';
import { messageDto } from './helpdesk-config.service';

const SYSTEM_ACTOR: Actor = { userId: 0, role: 'admin' };

/** Un correo de respuesta ya armado (lo que se envía, o lo que se mostraría en una prueba). */
export interface ComposedReply {
    to: string[];
    cc: string[];
    subject: string;
    text: string;
    html: string;
    messageId: string;
    inReplyTo: string | null;
    references: string[];
    from: string;
    fromName: string;
}

interface TicketCtx {
    list: List;
    fields: Field[];
    settings: HelpdeskSettings;
    marker: HelpdeskMailboxMarker | null;
    record: { id: number; data: Record<string, unknown>; createdBy: number };
    ticket: HelpdeskTicketRow | null;
    token: string;
    title: string;
}

/**
 * El cliente del ticket: el del correo que lo abrió y, si el ticket se creó a
 * mano (o por un formulario), el de los campos mapeados como «correo» y
 * «nombre» del remitente en la configuración de la mesa de ayuda.
 */
function customerOf(ctx: TicketCtx): { email: string | null; name: string | null } {
    const read = (id: number | null): string | null => {
        if (id === null) return null;
        const v = ctx.record.data[`f${id}`];
        return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
    };
    const email = ctx.ticket?.customerEmail || read(ctx.settings.from_email_field_id);
    const name = ctx.ticket?.customerName || read(ctx.settings.from_name_field_id);
    return { email: email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null, name: name ?? null };
}

function replyError(code: string, message: string, status = 400): HttpException {
    return new HttpException({ code, message, data: { status } }, status);
}

/**
 * D2 — Responder por correo desde la ficha del ticket (y desde una
 * automatización). Sale por el correo de la EMPRESA — su cuenta de Google o
 * Microsoft, su SMTP propio o, si no tiene, el de la plataforma (con las
 * reglas de SEC-33: la dirección de soporte va como Reply-To y cuenta la
 * cuota). Lleva `In-Reply-To` / `References` para que el cliente lo vea en el
 * mismo hilo y el asunto con `[TCK-0001]`. Cada respuesta queda como
 * comentario visible para el cliente (origen «correo saliente») y la primera
 * marca la «primera respuesta» del SLA.
 *
 * Una nota interna NUNCA sale por aquí: sólo se envía lo que se escribe en
 * este compositor.
 */
@Injectable()
export class HelpdeskReplyService {
    private readonly logger = new Logger(HelpdeskReplyService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly comments: CommentsRepository,
        private readonly mail: MailService,
        private readonly sla: HelpdeskSlaService,
        private readonly realtime: RealtimeService,
        @Optional() private readonly notify?: NotifyHub,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ── La ficha ─────────────────────────────────────────────────────────

    /** El hilo del ticket, su SLA y si quien mira puede responder. Pide VER el registro. */
    async ticket(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<HelpdeskTicketDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        // Mismo criterio que la ficha (404 si no lo ve).
        await this.records.get(tenantId, actor, String(list.id), recordId);
        const ctx = await this.loadCtx(tenantId, list, recordId);
        const messages = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(helpdeskMessages)
                .where(and(eq(helpdeskMessages.tenantId, tenantId), eq(helpdeskMessages.recordId, recordId)))
                .orderBy(desc(helpdeskMessages.id))
                .limit(50),
        );
        return {
            record_id: recordId,
            support_address: ctx.marker?.support_address ?? null,
            customer_email: customerOf(ctx).email,
            customer_name: customerOf(ctx).name,
            subject: ctx.ticket?.subject ?? null,
            token: ctx.token,
            messages: messages.reverse().map(messageDto),
            sla: ctx.settings.sla.enabled && ctx.ticket ? slaDtoOf(ctx.ticket) : null,
            templates: ctx.settings.reply_templates.map((t) => ({ id: t.id, name: t.name })),
            can_reply: ctx.marker !== null && this.records.canReach(list, actor, 'edit', ctx.record),
            include_signature: ctx.settings.include_signature,
        };
    }

    /** El texto de una plantilla con las variables del ticket ya resueltas (para el compositor). */
    async renderTemplate(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number, templateId: string): Promise<{ body: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        await this.records.get(tenantId, actor, String(list.id), recordId);
        const ctx = await this.loadCtx(tenantId, list, recordId);
        const tpl = ctx.settings.reply_templates.find((t) => t.id === templateId);
        if (!tpl) throw new NotFoundException({ code: 'template_not_found', message: 'La plantilla ya no existe.', data: { status: 404 } });
        return { body: await this.resolveVars(tenantId, ctx, tpl.body, actor.userId) };
    }

    /** «Responder por correo» desde la ficha. Pide EDITAR el registro. */
    async reply(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number, input: HelpdeskReplyInput): Promise<HelpdeskReplyResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const ctx = await this.loadCtx(tenantId, list, recordId);
        if (!this.records.canReach(list, actor, 'edit', ctx.record)) {
            throw new NotFoundException({ code: 'record_not_found', message: 'Registro no encontrado', data: { status: 404 } });
        }
        if (!ctx.marker) throw replyError('helpdesk_no_mailbox', 'Esta lista no tiene un buzón de soporte conectado: configúralo en Ajustes de la lista → Correo entrante.');
        const body = await this.resolveVars(tenantId, ctx, input.body, actor.userId);
        const wantsSignature = input.signature ?? ctx.settings.include_signature;
        const signature = wantsSignature ? await this.signatureOf(tenantId, actor.userId) : null;
        const composed = await this.compose(tenantId, ctx, { body, to: input.to, cc: input.cc, subject: input.subject, signature });
        await this.send(tenantId, composed, {});
        const saved = await this.record(tenantId, ctx, composed, body, actor.userId > 0 ? actor.userId : null, null);
        let warning: string | undefined;
        if (input.set_status && ctx.settings.status_field_id !== null) {
            try {
                await this.records.update(tenantId, actor, String(list.id), recordId, { data: { [jsonbKeyForField(ctx.settings.status_field_id)]: input.set_status } });
            } catch (err) {
                warning = `El correo salió, pero no se pudo cambiar el estado: ${errorText(err, 200)}`;
            }
        }
        return {
            ok: true,
            message_id: saved.messageRowId,
            comment_id: saved.commentId,
            to: composed.to.join(', '),
            subject: composed.subject,
            ...(warning ? { warning } : {}),
        };
    }

    // ── Automatizaciones ─────────────────────────────────────────────────

    /**
     * La acción «Responder por correo al hilo del registro». `body` y
     * `subject` ya vienen con las variables del motor resueltas. Con `simulate`
     * arma el correo y no lo envía («Probar»).
     */
    async replyFromAutomation(
        tenantId: number,
        listId: number,
        recordId: number,
        cfg: { body: string; subject?: string; cc?: string; automationName?: string },
        opts: { simulate?: boolean } = {},
    ): Promise<ComposedReply> {
        const list = await this.lists.get(tenantId, String(listId));
        const ctx = await this.loadCtx(tenantId, list, recordId);
        if (!ctx.marker) throw new Error('La lista no tiene un buzón de soporte conectado (Ajustes de la lista → Correo entrante).');
        const composed = await this.compose(tenantId, ctx, { body: cfg.body, cc: cfg.cc, subject: cfg.subject, signature: null });
        if (opts.simulate) return composed;
        // Una respuesta automática se marca como tal (RFC 3834): los autorespondedores del cliente no contestan.
        await this.send(tenantId, composed, { 'Auto-Submitted': 'auto-generated' });
        await this.record(tenantId, ctx, composed, cfg.body, null, cfg.automationName ?? null);
        return composed;
    }

    /**
     * El último correo que llegó a un ticket, como lo vería el disparador
     * «Cuando llega un correo» (lo usa «Probar» en el editor de automatizaciones).
     */
    async lastInbound(tenantId: number, recordId: number): Promise<EmailEventInfo | null> {
        const [m] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    status: helpdeskMessages.status,
                    fromEmail: helpdeskMessages.fromEmail,
                    fromName: helpdeskMessages.fromName,
                    subject: helpdeskMessages.subject,
                    messageId: helpdeskMessages.messageId,
                    commentBody: comments.body,
                    description: records.descriptionText,
                })
                .from(helpdeskMessages)
                .leftJoin(comments, eq(comments.id, helpdeskMessages.commentId))
                .leftJoin(records, eq(records.id, helpdeskMessages.recordId))
                .where(and(eq(helpdeskMessages.tenantId, tenantId), eq(helpdeskMessages.recordId, recordId), eq(helpdeskMessages.direction, 'in')))
                .orderBy(desc(helpdeskMessages.id))
                .limit(1),
        );
        if (!m || (m.status !== 'ticket' && m.status !== 'reply')) return null;
        return {
            tipo: m.status === 'ticket' ? 'nuevo' : 'respuesta',
            de: m.fromEmail ?? '',
            nombre: m.fromName ?? '',
            asunto: m.subject ?? '',
            texto: ((m.status === 'reply' ? m.commentBody : m.description) ?? '').slice(0, 5000),
            message_id: m.messageId,
        };
    }

    /** El vencimiento y la prioridad del SLA de un ticket (para «Probar»). */
    async slaSnapshot(tenantId: number, recordId: number, kind: 'first_response' | 'resolution'): Promise<{ due: string | null; priority: string | null } | null> {
        const [t] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(helpdeskTickets).where(and(eq(helpdeskTickets.tenantId, tenantId), eq(helpdeskTickets.recordId, recordId))).limit(1),
        );
        if (!t) return null;
        const dto = slaDtoOf(t);
        let priority = dto.priority;
        if (priority) {
            const list = await this.lists.get(tenantId, String(t.listId)).catch(() => null);
            const fieldId = list ? readHelpdeskSettings(list.settings).sla.priority_field_id : null;
            const field = fieldId ? (await this.fields.listByListId(tenantId, t.listId)).find((f) => f.id === fieldId) : undefined;
            const opts = ((field?.config as { options?: Array<{ value?: string; label?: string }> } | undefined)?.options ?? []);
            priority = opts.find((o) => o.value === priority)?.label ?? priority;
        }
        return { due: kind === 'first_response' ? dto.first_response_due : dto.resolution_due, priority };
    }

    // ── Internos ─────────────────────────────────────────────────────────

    private async loadCtx(tenantId: number, list: List, recordId: number): Promise<TicketCtx> {
        const fields = await this.fields.listByListId(tenantId, list.id);
        const { rec, ticket } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx
                .select({ id: records.id, data: records.data, createdBy: records.createdBy, deletedAt: records.deletedAt })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), eq(records.id, recordId)))
                .limit(1);
            const [t] = await tx.select().from(helpdeskTickets).where(and(eq(helpdeskTickets.tenantId, tenantId), eq(helpdeskTickets.recordId, recordId))).limit(1);
            return { rec: r, ticket: t ?? null };
        });
        if (!rec || rec.deletedAt !== null) throw new NotFoundException({ code: 'record_not_found', message: 'Registro no encontrado', data: { status: 404 } });
        const data = (rec.data ?? {}) as Record<string, unknown>;
        const auto = fields.find((f) => f.type === 'autonumber');
        const autoText = auto ? data[jsonbKeyForField(auto.id)] : null;
        const titleId = resolveTitleFieldId(fields, list.settings);
        const rawTitle = titleId ? data[jsonbKeyForField(titleId)] : null;
        return {
            list,
            fields,
            settings: readHelpdeskSettings(list.settings),
            marker: readHelpdeskMailboxMarker(list.settings),
            record: { id: rec.id, data, createdBy: rec.createdBy },
            ticket,
            token: ticketToken(typeof autoText === 'string' ? autoText : null, rec.id),
            title: typeof rawTitle === 'string' && rawTitle.trim() !== '' ? rawTitle.trim() : '',
        };
    }

    /**
     * Las variables de una respuesta: `{{campo}}` (con la ETIQUETA de una
     * opción: el texto va a un cliente), `{{ticket.numero}}`,
     * `{{ticket.asunto}}`, `{{cliente.nombre}}`, `{{cliente.correo}}`,
     * `{{agente.nombre}}` y los formatos regionales (`|fecha`, `|moneda`).
     */
    private async resolveVars(tenantId: number, ctx: TicketCtx, text: string, agentId: number): Promise<string> {
        if (!text.includes('{{')) return text;
        const bySlug = new Map<string, LabelFieldLike & { id: number }>(ctx.fields.map((f) => [f.slug, { id: f.id, type: f.type, config: f.config, label: f.label }]));
        const special = await this.specialVars(tenantId, ctx, agentId);
        const accessor = (token: string): unknown => {
            if (token in special) return special[token];
            const f = bySlug.get(token);
            return f ? labelForFieldValue(f, ctx.record.data[jsonbKeyForField(f.id)]) : undefined;
        };
        const [tenant] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1));
        const fmt = tenantFormatSchema.safeParse(((tenant?.settings ?? {}) as Record<string, unknown>).format ?? {});
        const tz = this.timeZones ? await this.timeZones.orUtc(tenantId) : 'UTC';
        const formatter = regionalFormatterFor(bySlug, fmt.success ? fmt.data : tenantFormatSchema.parse({}), tz);
        return applyMergeTags(text, accessor, ctx.record.id, undefined, undefined, formatter);
    }

    /** Las variables propias del ticket (`{{ticket.numero}}`, `{{cliente.correo}}`…). */
    private async specialVars(tenantId: number, ctx: TicketCtx, agentId: number): Promise<Record<string, string>> {
        const agent = agentId > 0 ? await this.userName(tenantId, agentId) : '';
        return {
            'ticket.numero': ctx.token,
            'ticket.asunto': ctx.ticket?.subject ?? ctx.title,
            'cliente.nombre': customerOf(ctx).name || (customerOf(ctx).email ?? ''),
            'cliente.correo': customerOf(ctx).email ?? '',
            'agente.nombre': agent,
        };
    }

    /**
     * Las variables del ticket para el motor de automatizaciones: se suman a
     * las suyas, así «Responder por correo» usa `{{ticket.numero}}` y
     * `{{cliente.nombre}}` además de los campos y `{{correo.*}}`.
     */
    async ticketVars(tenantId: number, listId: number, recordId: number): Promise<Record<string, string>> {
        const list = await this.lists.get(tenantId, String(listId));
        const ctx = await this.loadCtx(tenantId, list, recordId);
        return this.specialVars(tenantId, ctx, 0);
    }

    /** Arma el correo: destinatarios, asunto con el token, hilo y cuerpo en texto + HTML. */
    async compose(
        tenantId: number,
        ctx: TicketCtx,
        p: { body: string; to?: string; cc?: string; subject?: string; signature: string | null },
    ): Promise<ComposedReply> {
        const to = emailList(p.to && p.to.trim() !== '' ? p.to : (customerOf(ctx).email ?? ''));
        if (to.length === 0) {
            throw replyError('helpdesk_no_recipient', 'El ticket no tiene a quién responder: escribe la dirección del cliente en «Para».');
        }
        const support = ctx.marker!.support_address;
        const cc = emailList(p.cc ?? '').filter((e) => e !== support && !to.includes(e));
        let subject = (p.subject ?? '').replace(/[\r\n]+/g, ' ').trim();
        if (subject === '') subject = replySubject(ctx.ticket?.subject || ctx.title, ctx.token);
        else if (!subject.includes(`[${ctx.token}]`)) subject = `${subject} [${ctx.token}]`;
        // El hilo: lo que ya pasó por este ticket (del cliente y nuestro), en orden.
        const thread = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ messageId: helpdeskMessages.messageId, direction: helpdeskMessages.direction })
                .from(helpdeskMessages)
                .where(and(eq(helpdeskMessages.tenantId, tenantId), eq(helpdeskMessages.recordId, ctx.record.id), isNotNull(helpdeskMessages.messageId)))
                .orderBy(asc(helpdeskMessages.id))
                .limit(200),
        );
        const ids = thread.map((t) => t.messageId!).filter((id) => !id.endsWith('@helpdesk.invalid'));
        const lastIn = [...thread].reverse().find((t) => t.direction === 'in' && !t.messageId!.endsWith('@helpdesk.invalid'))?.messageId ?? null;
        const domain = support.includes('@') ? support.slice(support.lastIndexOf('@') + 1) : 'helpdesk.local';
        const messageId = `hd.${ctx.record.id}.${randomBytes(8).toString('hex')}@${domain}`;
        const [tenant] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1));

        const theme = emailThemeSchema.parse({});
        const bodyHtml = escapeHtml(p.body).replace(/\r?\n/g, '<br>');
        const sigHtml = p.signature ? emailSignatureHtml(p.signature, EMAIL_FONT_STACKS.sans, theme) : '';
        const html = `<div style="font-family:${EMAIL_FONT_STACKS.sans};font-size:14px;line-height:1.55;color:#1f2937;">${bodyHtml}</div>${sigHtml ? `<br>${sigHtml}` : ''}`;
        const text = p.signature ? `${p.body}\n\n-- \n${htmlToPlainText(p.signature)}` : p.body;
        return {
            to,
            cc,
            subject: subject.slice(0, 400),
            text,
            html,
            messageId,
            inReplyTo: lastIn ?? ids[ids.length - 1] ?? null,
            references: ids.slice(-20),
            from: support,
            fromName: (tenant?.name ?? '').trim(),
        };
    }

    private async send(tenantId: number, c: ComposedReply, extraHeaders: Record<string, string>): Promise<void> {
        try {
            await this.mail.sendNow({
                tenantId,
                to: c.to.join(', '),
                ...(c.cc.length > 0 ? { cc: c.cc.join(', ') } : {}),
                subject: c.subject,
                text: c.text,
                html: c.html,
                // Con correo propio sale DE la dirección de soporte; por el correo
                // compartido de la plataforma, SEC-33 la pasa a Reply-To. En los
                // dos casos la respuesta del cliente vuelve al buzón.
                from: c.from,
                replyTo: c.from,
                ...(c.fromName ? { fromName: c.fromName, fromNameSoft: true } : {}),
                messageId: c.messageId,
                ...(c.inReplyTo ? { inReplyTo: c.inReplyTo } : {}),
                references: c.references,
                headers: { [HELPDESK_HEADER]: '1', ...extraHeaders },
            });
        } catch (err) {
            throw replyError('mail_send_failed', `No se pudo enviar el correo: ${errorText(err, 300)}`, HttpStatus.BAD_GATEWAY);
        }
    }

    /** Lo que quedó: el comentario visible para el cliente, el correo en el hilo y la primera respuesta del SLA. */
    private async record(
        tenantId: number,
        ctx: TicketCtx,
        c: ComposedReply,
        body: string,
        authorId: number | null,
        automationName: string | null,
    ): Promise<{ commentId: number; messageRowId: number }> {
        const now = new Date();
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const comment = await this.comments.insert(tx, {
                tenantId,
                listId: ctx.list.id,
                recordId: ctx.record.id,
                userId: authorId ?? 0,
                body: body.slice(0, 10_000),
                kind: 'email',
                parentId: null,
                visibility: 'client',
                metadata: {
                    email: {
                        direction: 'out',
                        from: c.from,
                        to: c.to.join(', '),
                        cc: c.cc.join(', '),
                        subject: c.subject,
                        message_id: c.messageId,
                        ...(automationName ? { automation: automationName } : {}),
                    },
                },
            });
            const [msg] = await tx
                .insert(helpdeskMessages)
                .values({
                    tenantId,
                    listId: ctx.list.id,
                    mailboxId: ctx.marker?.id ?? null,
                    recordId: ctx.record.id,
                    commentId: comment.id,
                    direction: 'out',
                    status: 'sent',
                    messageId: c.messageId,
                    inReplyTo: c.inReplyTo,
                    refs: c.references,
                    fromEmail: c.from,
                    fromName: c.fromName || null,
                    toAddr: c.to.join(', '),
                    ccAddr: c.cc.join(', ') || null,
                    subject: c.subject,
                    sentBy: authorId,
                })
                .returning({ id: helpdeskMessages.id });
            await tx
                .insert(helpdeskTickets)
                .values({
                    tenantId,
                    listId: ctx.list.id,
                    recordId: ctx.record.id,
                    customerEmail: c.to[0] ?? null,
                    subject: ctx.ticket?.subject ?? (ctx.title || null),
                    mailboxId: ctx.marker?.id ?? null,
                    lastOutboundAt: now,
                })
                .onConflictDoUpdate({ target: helpdeskTickets.recordId, set: { lastOutboundAt: now, updatedAt: now } });
            return { commentId: comment.id, messageRowId: msg!.id };
        });
        // La primera respuesta del SLA la da una PERSONA: un acuse automático
        // («recibimos tu solicitud») no detiene el reloj (como Zendesk/Freshdesk).
        if (authorId !== null) await this.sla.markFirstResponse(tenantId, ctx.record.id, now);
        this.realtime.records(tenantId, ctx.list.id);
        // A quienes siguen el ticket (sin volver a mandarle un correo al cliente: ya le llegó éste).
        if (authorId !== null) {
            this.notify?.emit({
                type: 'comment',
                tenantId,
                listId: ctx.list.id,
                recordId: ctx.record.id,
                actorId: authorId,
                body: `Respondió por correo: ${body.slice(0, 300)}`,
                mentioned: [],
                commentId: out.commentId,
                visibility: 'internal',
            });
        }
        return out;
    }

    private async signatureOf(tenantId: number, userId: number): Promise<string | null> {
        if (userId <= 0) return null;
        const [u] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ signature: users.emailSignature }).from(users).where(eq(users.id, userId)).limit(1)).catch(() => []);
        const html = (u?.signature ?? '').trim();
        return html !== '' ? html : null;
    }

    private async userName(tenantId: number, userId: number): Promise<string> {
        const [u] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1)).catch(() => []);
        return (u?.name || u?.email || '').trim();
    }
}

export { SYSTEM_ACTOR as HELPDESK_SYSTEM_ACTOR };

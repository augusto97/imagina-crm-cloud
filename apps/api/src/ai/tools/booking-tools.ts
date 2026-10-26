import { Injectable } from '@nestjs/common';
import {
    BOOKING_MAPPING_TYPES,
    BOOKING_SLOT_INTERVALS,
    bookingConfigSchema,
    bookingProblems,
    defaultBookingConfig,
    defaultBookingWeek,
    isBookingQuestionType,
    minutesToHhmm,
    newBookingItemId,
    newFormItemId,
    type AiProposal,
    type AiProposalKind,
    type AiProposalPreview,
    type BookingConfig,
    type BookingInterval,
    type BookingMappingKey,
    type BookingPageDto,
    type BookingStaff,
    type Field,
    type List,
} from '@imagina-base/shared';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { BookingService } from '../../booking/booking.service';
import { sanitizeBookingConfig } from '../../booking/booking-config';
import { FieldsService } from '../../fields/fields.service';
import { ListsService } from '../../lists/lists.service';
import { ProposalsStore, type AiApplyOutcome, type AiProposalApplier, type StoredProposal } from '../proposals.store';
import { AiToolError, AiToolRegistry, type AiToolContext, type AiToolResult } from './registry';

/**
 * D5 — La agenda de citas en el asistente y el MCP: armar o cambiar una página
 * de agenda de una lista en el vocabulario de quien la pide (servicios con su
 * duración, quién atiende con su horario semanal, reglas y qué campo guarda
 * cada dato). Mismo contrato que el resto: `propose_*` NO escribe; aplicar pasa
 * por `BookingService` (validación contra los campos reales, sólo personas del
 * equipo que pueden editar la lista, opciones creadas al publicar).
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_LABELS: Record<(typeof DAYS)[number], string> = { sun: 'dom', mon: 'lun', tue: 'mar', wed: 'mié', thu: 'jue', fri: 'vie', sat: 'sáb' };

const tramo = z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, 'Usa «HH:MM-HH:MM»');
const scheduleSpec = z
    .object(Object.fromEntries(DAYS.map((d) => [d, z.array(tramo).max(6).optional()])) as Record<(typeof DAYS)[number], z.ZodOptional<z.ZodArray<typeof tramo>>>)
    .describe('Horario semanal en la ZONA DE LA EMPRESA: {mon: ["08:00-12:00", "14:00-18:00"], sat: ["09:00-13:00"]}; un día que no aparece no se atiende.');

const staffSpec = z.object({
    user_id: z.number().int().positive().optional().describe('Persona del equipo (id de list_members); tiene que poder editar la lista'),
    resource: z.string().max(120).optional().describe('O un RECURSO por nombre (una sala, un consultorio, un vehículo)'),
    services: z.array(z.string().max(120)).max(30).optional().describe('Nombres de los servicios que ofrece; sin él, todos'),
    schedule: scheduleSpec.optional().describe('Sin él: lunes a viernes de 8 a 12 y de 14 a 18'),
    days_off: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(60).optional().describe('Días que no atiende (vacaciones), AAAA-MM-DD'),
    work_holidays: z.boolean().optional().describe('true = atiende también los festivos de Colombia (por defecto no)'),
});

const writesSpec = z
    .object({
        start: z.string().max(63).optional().describe('Slug del campo Fecha y hora donde va el INICIO (obligatorio para publicar)'),
        end: z.string().max(63).optional().describe('Fecha y hora del fin'),
        duration: z.string().max(63).optional().describe('Campo Duración (o número) con los minutos'),
        person: z.string().max(63).optional().describe('Campo Persona: quién atiende'),
        resource: z.string().max(63).optional().describe('Campo selección o texto con el recurso'),
        service: z.string().max(63).optional().describe('Campo selección o texto con el servicio'),
        client_name: z.string().max(63).optional(),
        client_email: z.string().max(63).optional(),
        client_phone: z.string().max(63).optional(),
        status: z.string().max(63).optional().describe('Campo selección del estado (se crean Confirmada / Reprogramada / Cancelada al publicar)'),
    })
    .describe('Qué campo de la lista guarda cada dato de la cita (slugs)');

const WRITE_KEYS: Record<keyof z.infer<typeof writesSpec>, BookingMappingKey> = {
    start: 'start_field_id',
    end: 'end_field_id',
    duration: 'duration_field_id',
    person: 'person_field_id',
    resource: 'resource_field_id',
    service: 'service_field_id',
    client_name: 'name_field_id',
    client_email: 'email_field_id',
    client_phone: 'phone_field_id',
    status: 'status_field_id',
};

const pageSpec = z.object({
    list: z.string().max(63).describe('Slug de la lista donde caen las citas'),
    page: z
        .union([z.number().int().positive(), z.string().max(120)])
        .optional()
        .describe('Página EXISTENTE a cambiar (id o nombre, de booking_pages en get_list_schema). Sin él se crea una nueva.'),
    name: z.string().min(1).max(120).optional().describe('Nombre interno de la página'),
    title: z.string().max(200).optional().describe('Título que ve el cliente'),
    description: z.string().max(2000).optional(),
    location: z.string().max(500).optional().describe('Dónde es la cita (dirección o «Videollamada»)'),
    services: z
        .array(
            z.object({
                name: z.string().min(1).max(120),
                duration_min: z.number().int().min(5).max(720),
                description: z.string().max(1000).optional(),
                price: z.number().min(0).optional().describe('Sólo informativo (no se cobra)'),
            }),
        )
        .max(30)
        .optional()
        .describe('Reemplaza los servicios (los que ya existían con el mismo nombre conservan su id)'),
    staff: z.array(staffSpec).max(30).optional().describe('Reemplaza quién atiende'),
    choose_staff: z.enum(['visitor', 'auto']).optional().describe('visitor = el cliente elige (o «el primero disponible»); auto = se asigna solo'),
    rules: z
        .object({
            buffer_before_min: z.number().int().min(0).max(240).optional(),
            buffer_after_min: z.number().int().min(0).max(240).optional().describe('Margen después de cada cita (limpieza, traslado)'),
            min_notice_min: z.number().int().min(0).max(86_400).optional().describe('Aviso mínimo en minutos (por defecto 120)'),
            max_days_ahead: z.number().int().min(1).max(365).optional(),
            slot_interval_min: z.number().int().optional().describe(`Cada cuánto empieza un horario: ${BOOKING_SLOT_INTERVALS.join(', ')}`),
            max_per_day: z.number().int().min(1).max(200).nullable().optional().describe('Tope de citas por día por persona o recurso'),
            allow_reschedule: z.boolean().optional(),
            allow_cancel: z.boolean().optional(),
        })
        .optional(),
    writes: writesSpec.optional(),
    questions: z.array(z.string().max(63)).max(30).optional().describe('Slugs de los campos que se le preguntan además (motivo, empresa…)'),
    reminders_min_before: z.array(z.number().int().min(10).max(20_160)).max(5).optional().describe('Recordatorios por correo al cliente, minutos antes (por defecto 1440 y 60)'),
    confirm_email: z.boolean().optional(),
    email_note: z.string().max(2000).optional().describe('Indicaciones que van en el correo de confirmación'),
    allowed_domains: z.array(z.string().max(253)).max(50).optional().describe('Sitios que pueden insertarla por iframe; vacío = cualquiera'),
    publish: z.boolean().optional().describe('true = publicarla (cualquiera con el enlace puede agendar); false = sacarla de línea'),
});
type PageSpec = z.infer<typeof pageSpec>;

type Payload = { kind: 'configure_booking_page'; listId: number; listSlug: string; pageId: number | null; name: string; config: BookingConfig; publish: boolean | null };

@Injectable()
export class BookingTools implements AiProposalApplier {
    static readonly KINDS: ReadonlySet<AiProposalKind> = new Set(['configure_booking_page']);

    constructor(
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly booking: BookingService,
        private readonly store: ProposalsStore,
    ) {}

    registerInto(registry: AiToolRegistry): void {
        registry.register({
            name: 'propose_configure_booking_page',
            label: 'Preparando la agenda de citas',
            description:
                'Crea o cambia una PÁGINA DE AGENDA de una lista (estilo Calendly): un enlace público donde el cliente elige servicio, quién lo atiende, día y hora libres, deja sus datos y la cita cae como un registro de la lista (con correo de confirmación, .ics, recordatorios y enlaces para cambiarla o cancelarla). ' +
                'Define servicios con su duración, quién atiende (personas del equipo por id o recursos por nombre) con su horario semanal en la zona de la empresa, reglas (margen entre citas, aviso mínimo, días hacia adelante, tope diario) y `writes` (qué campo guarda cada dato). ' +
                'Ejemplo «consultorio con dos doctoras»: services [{name: "Consulta", duration_min: 30}, {name: "Control", duration_min: 20}], staff [{user_id: 12, schedule: {mon: ["08:00-12:00"], …}}, {user_id: 15, schedule: {…}}], rules {buffer_after_min: 10}, writes {start: "fecha", person: "profesional", service: "servicio", client_name: "paciente", client_email: "email", status: "estado"}. Los horarios exactos se ajustan después en el editor visual.',
            capability: 'manage_lists',
            input: pageSpec,
            run: (ctx, input) => this.propose(ctx, input as PageSpec),
        });
    }

    private async propose(ctx: AiToolContext, input: PageSpec): Promise<AiToolResult> {
        const list = await this.resolveList(ctx, input.list);
        const fields = await this.fields.listByListId(ctx.tenantId, list.id);
        const members = await this.booking.eligibleMembers(ctx.tenantId, list);
        const memberIds = new Set(members.map((m) => m.id));
        const pages = await this.booking.list(ctx.tenantId, String(list.id));
        const current = input.page !== undefined ? findPage(pages, input.page) : null;
        const base: BookingConfig = current
            ? current.config
            : defaultBookingConfig({ listName: list.name, userId: memberIds.has(ctx.userId) ? ctx.userId : null, fields });
        const config: BookingConfig = structuredClone(base);
        const changes: AiProposalPreview['changes'] = [];
        const bySlug = new Map(fields.map((f) => [f.slug, f]));
        const fieldOf = (slug: string, where: string): Field => {
            const f = bySlug.get(slug);
            if (!f) throw new AiToolError(`${where}: el campo «${slug}» no existe en «${list.name}». Campos: ${fields.map((x) => x.slug).join(', ')}.`);
            return f;
        };

        for (const k of ['title', 'description', 'location'] as const) {
            if (input[k] !== undefined) config.settings[k] = input[k]!;
        }
        if (input.choose_staff !== undefined) config.settings.choose_staff = input.choose_staff;
        if (input.allowed_domains !== undefined) config.settings.allowed_domains = input.allowed_domains;
        if (input.confirm_email !== undefined) config.notifications.confirm_email = input.confirm_email;
        if (input.email_note !== undefined) config.notifications.email_note = input.email_note;

        if (input.services !== undefined) {
            if (input.services.length === 0) throw new AiToolError('Una agenda necesita al menos un servicio.');
            const names = new Set<string>();
            config.services = input.services.map((s) => {
                const key = s.name.trim().toLowerCase();
                if (names.has(key)) throw new AiToolError(`El servicio «${s.name}» está repetido.`);
                names.add(key);
                const prev = base.services.find((x) => x.name.trim().toLowerCase() === key);
                return {
                    id: prev?.id ?? newBookingItemId('svc'),
                    name: s.name.trim(),
                    duration_min: s.duration_min,
                    description: s.description ?? prev?.description ?? '',
                    price: s.price ?? prev?.price ?? null,
                    option_value: prev?.option_value ?? null,
                    active: true,
                };
            });
        }
        const serviceIdByName = new Map(config.services.map((s) => [s.name.trim().toLowerCase(), s.id]));

        if (input.staff !== undefined) {
            if (input.staff.length === 0) throw new AiToolError('Una agenda necesita al menos una persona o recurso que atienda.');
            config.staff = input.staff.map((s, i) => this.buildStaff(s, i, base.staff, memberIds, members, serviceIdByName));
        }

        if (input.rules) {
            const r = input.rules;
            if (r.slot_interval_min !== undefined && !(BOOKING_SLOT_INTERVALS as readonly number[]).includes(r.slot_interval_min)) {
                throw new AiToolError(`slot_interval_min tiene que ser uno de: ${BOOKING_SLOT_INTERVALS.join(', ')}.`);
            }
            config.rules = { ...config.rules, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) };
        }

        if (input.writes) {
            for (const [key, slug] of Object.entries(input.writes) as Array<[keyof typeof WRITE_KEYS, string | undefined]>) {
                if (slug === undefined) continue;
                const mk = WRITE_KEYS[key];
                const f = fieldOf(slug, `writes.${key}`);
                const allowed = BOOKING_MAPPING_TYPES[mk] as readonly string[];
                if (!allowed.includes(f.type)) throw new AiToolError(`writes.${key}: «${f.slug}» es ${f.type}; tiene que ser ${allowed.join(' o ')}.`);
                if (mk === 'status_field_id' && config.mapping.status_field_id !== f.id) {
                    config.mapping.status_confirmed = null;
                    config.mapping.status_rescheduled = null;
                    config.mapping.status_cancelled = null;
                }
                config.mapping[mk] = f.id;
            }
        }

        if (input.questions !== undefined) {
            const mapped = new Set(Object.values(WRITE_KEYS).map((k) => config.mapping[k]).filter((v): v is number => v !== null));
            config.questions = input.questions.map((slug) => {
                const f = fieldOf(slug, 'questions');
                if (!isBookingQuestionType(f.type)) throw new AiToolError(`questions: «${f.slug}» (${f.type}) no se puede preguntar en la agenda.`);
                if (mapped.has(f.id)) throw new AiToolError(`questions: «${f.slug}» ya lo llena la agenda (writes); no hace falta preguntarlo.`);
                return { id: newFormItemId(), type: 'field' as const, field_id: f.id, label: '', help: '', placeholder: '', required: false, hidden: false, display: 'auto' as const, show_if: null };
            }) as BookingConfig['questions'];
        }

        if (input.reminders_min_before !== undefined) {
            config.notifications.reminders = [...new Set(input.reminders_min_before)].map((m) => ({ id: `rem${m}`.slice(0, 24), minutes_before: m }));
        }

        const parsed = bookingConfigSchema.safeParse(config);
        if (!parsed.success) throw new AiToolError(`La configuración no es válida: ${parsed.error.issues[0]?.message ?? 'revisa los datos'}.`);
        const clean = sanitizeBookingConfig(parsed.data, fields, memberIds);
        const problems = bookingProblems(clean, fields);
        if (input.publish === true && problems.length > 0) throw new AiToolError(`Todavía no se puede publicar: ${problems[0]}`);

        // Vista previa en lenguaje claro.
        const names = new Map(members.map((m) => [m.id, m.name]));
        changes.push({ label: 'Servicios', from: null, to: clean.services.filter((s) => s.active).map((s) => `${s.name} (${s.duration_min} min)`).join(', ') || '(ninguno)' });
        changes.push({
            label: 'Quién atiende',
            from: null,
            to: clean.staff.map((s) => (s.kind === 'resource' ? s.name : names.get(s.staff_user_id ?? -1) ?? 'persona sin elegir')).join(', ') || '(nadie)',
        });
        const rows = clean.staff.map((s) => ({
            Atiende: s.kind === 'resource' ? s.name : (names.get(s.staff_user_id ?? -1) ?? 'persona sin elegir'),
            Horario: describeWeek(s.availability.week),
        }));
        const r = clean.rules;
        changes.push({
            label: 'Reglas',
            from: null,
            to: [
                `cada ${r.slot_interval_min} min`,
                r.buffer_after_min || r.buffer_before_min ? `margen ${r.buffer_before_min}/${r.buffer_after_min} min` : null,
                `aviso mínimo ${r.min_notice_min} min`,
                `hasta ${r.max_days_ahead} días`,
                r.max_per_day ? `máx. ${r.max_per_day} por día` : null,
            ]
                .filter(Boolean)
                .join(' · '),
        });
        const byId = new Map(fields.map((f) => [f.id, f]));
        changes.push({
            label: 'Campos de la lista',
            from: null,
            to:
                (Object.entries(WRITE_KEYS) as Array<[string, BookingMappingKey]>)
                    .filter(([, k]) => clean.mapping[k] !== null)
                    .map(([w, k]) => `${w} → ${byId.get(clean.mapping[k] as number)?.label ?? '?'}`)
                    .join(', ') || '(ninguno)',
        });
        changes.push({ label: 'Recordatorios', from: null, to: clean.notifications.reminders.map((x) => minutesLabel(x.minutes_before)).join(', ') || 'ninguno' });
        if (input.publish !== undefined) changes.push({ label: 'Publicada', from: current ? (current.enabled ? 'sí' : 'no') : 'no', to: input.publish ? 'sí' : 'no' });
        if (problems.length > 0 && input.publish !== true) changes.push({ label: 'Falta para publicar', from: null, to: problems.join(' ') });

        const name = input.name ?? current?.name ?? 'Agenda en línea';
        const proposal: AiProposal = {
            id: randomBytes(9).toString('base64url'),
            kind: 'configure_booking_page',
            title: current ? `Cambiar la agenda «${current.name}» de «${list.name}»` : `Agenda de citas «${name}» en «${list.name}»`,
            summary: input.publish
                ? 'Al aplicar queda PUBLICADA: cualquiera con el enlace puede agendar y la cita cae como un registro de la lista.'
                : 'Al aplicar queda guardada; se publica desde el editor o pidiéndolo.',
            // Publicar abre la lista a cualquiera con el enlace: confirmación reforzada.
            destructive: input.publish === true,
            list_slug: list.slug,
            preview: { lists: [], fields: [], widgets: [], automation: null, changes, affected_count: 0, rows, blocks: [] },
            applied: false,
            result: null,
            created_at: new Date().toISOString(),
        };
        const payload: Payload = { kind: 'configure_booking_page', listId: list.id, listSlug: list.slug, pageId: current?.id ?? null, name, config: clean, publish: input.publish ?? null };
        await this.store.save({
            proposal,
            kind: 'configure_booking_page',
            payload,
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            capability: 'manage_lists',
            conversationId: ctx.conversationId ?? null,
        });
        return {
            content: {
                ok: true,
                proposal_id: proposal.id,
                title: proposal.title,
                problems,
                note: 'La propuesta quedó lista como TARJETA para la persona. No la apliques tú ni digas que ya está hecho: cuéntale brevemente qué contiene y que puede aplicarla con el botón.',
            },
            proposal,
        };
    }

    async apply(ctx: AiToolContext, stored: StoredProposal): Promise<AiApplyOutcome> {
        const p = stored.payload as Payload;
        let page: BookingPageDto;
        if (p.pageId === null) {
            page = await this.booking.create(ctx.tenantId, ctx.userId, String(p.listId), { name: p.name, config: p.config });
            if (p.publish === true) page = await this.booking.update(ctx.tenantId, String(p.listId), page.id, { enabled: true });
        } else {
            page = await this.booking.update(ctx.tenantId, String(p.listId), p.pageId, {
                name: p.name,
                config: p.config,
                ...(p.publish !== null ? { enabled: p.publish } : {}),
            });
        }
        return {
            message: page.enabled ? `La agenda «${page.name}» quedó publicada.` : `La agenda «${page.name}» quedó guardada (sin publicar).`,
            links: [
                { label: 'Abrir en el editor de la agenda', href: `/lists/${p.listSlug}/edit?s=agenda&page=${page.id}` },
                ...(page.enabled ? [{ label: 'Ver la página pública', href: page.public_url ?? page.public_path }] : []),
            ],
            warnings: page.problems,
        };
    }

    private buildStaff(
        s: z.infer<typeof staffSpec>,
        i: number,
        prev: readonly BookingStaff[],
        memberIds: ReadonlySet<number>,
        members: ReadonlyArray<{ id: number; name: string }>,
        serviceIdByName: ReadonlyMap<string, string>,
    ): BookingStaff {
        const where = `staff[${i}]`;
        if ((s.user_id === undefined) === (s.resource === undefined || s.resource.trim() === '')) {
            throw new AiToolError(`${where}: indica user_id (una persona) O resource (un recurso), no los dos.`);
        }
        if (s.user_id !== undefined && !memberIds.has(s.user_id)) {
            throw new AiToolError(
                `${where}: la persona ${s.user_id} no puede atender (no es del equipo o no puede editar la lista). Pueden: ${members.map((m) => `${m.id} ${m.name}`).join(', ') || 'nadie'}.`,
            );
        }
        const old =
            s.user_id !== undefined
                ? prev.find((x) => x.kind === 'user' && x.staff_user_id === s.user_id)
                : prev.find((x) => x.kind === 'resource' && x.name.trim().toLowerCase() === s.resource!.trim().toLowerCase());
        const services = (s.services ?? []).map((n) => {
            const id = serviceIdByName.get(n.trim().toLowerCase());
            if (!id) throw new AiToolError(`${where}: el servicio «${n}» no existe. Servicios: ${[...serviceIdByName.keys()].join(', ')}.`);
            return id;
        });
        const availability = old?.availability ?? { week: defaultBookingWeek(), exceptions: [], skip_holidays: true };
        const week = s.schedule ? DAYS.map((d) => (s.schedule![d] ?? []).map((t) => parseTramo(t, `${where}.schedule.${d}`))) : availability.week;
        return {
            id: old?.id ?? newBookingItemId('stf'),
            kind: s.user_id !== undefined ? 'user' : 'resource',
            staff_user_id: s.user_id ?? null,
            name: s.resource?.trim() ?? old?.name ?? '',
            option_value: old?.option_value ?? null,
            services,
            availability: {
                week,
                exceptions: s.days_off ? s.days_off.map((date) => ({ date, closed: true, intervals: [], note: '' })) : availability.exceptions,
                skip_holidays: s.work_holidays === undefined ? availability.skip_holidays : !s.work_holidays,
            },
            connection_id: old?.connection_id ?? null,
            read_busy: old?.read_busy ?? true,
            create_events: old?.create_events ?? true,
            active: true,
        };
    }

    private async resolveList(ctx: AiToolContext, slug: string): Promise<List> {
        try {
            return await this.lists.get(ctx.tenantId, slug);
        } catch {
            throw new AiToolError(`La lista «${slug}» no existe. Usa list_lists para ver las listas.`);
        }
    }
}

function findPage(pages: readonly BookingPageDto[], ref: number | string): BookingPageDto {
    const hit =
        typeof ref === 'number' || /^\d+$/.test(String(ref))
            ? pages.find((p) => p.id === Number(ref))
            : pages.find((p) => p.name.toLowerCase() === String(ref).trim().toLowerCase());
    if (!hit) throw new AiToolError(`La página de agenda «${String(ref)}» no existe en la lista. Páginas: ${pages.map((p) => `${p.id} «${p.name}»`).join(', ') || 'ninguna'}.`);
    return hit;
}

function parseTramo(t: string, where: string): BookingInterval {
    const [start, end] = t.split('-') as [string, string];
    const ok = (v: string) => /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(v);
    if (!ok(start) || !ok(end) || end <= start) throw new AiToolError(`${where}: «${t}» no es un tramo válido (HH:MM-HH:MM, el fin después del inicio).`);
    return { start, end };
}

/** «lun–vie 08:00–12:00, 14:00–18:00 · sáb 09:00–13:00». */
export function describeWeek(week: BookingInterval[][]): string {
    const groups: Array<{ days: string[]; text: string }> = [];
    // De lunes a domingo (como se lee una semana de trabajo).
    [1, 2, 3, 4, 5, 6, 0].forEach((i) => {
        const d = DAYS[i]!;
        const text = (week[i] ?? []).map((t) => `${t.start}–${t.end}`).join(', ');
        if (!text) return;
        const last = groups.at(-1);
        if (last && last.text === text) last.days.push(DAY_LABELS[d]);
        else groups.push({ days: [DAY_LABELS[d]], text });
    });
    return groups.map((g) => `${g.days.length > 2 ? `${g.days[0]}–${g.days.at(-1)}` : g.days.join(', ')} ${g.text}`).join(' · ') || 'sin horario';
}

function minutesLabel(m: number): string {
    if (m % 1440 === 0) return `${m / 1440} día${m === 1440 ? '' : 's'} antes`;
    if (m % 60 === 0) return `${m / 60} h antes`;
    return `${minutesToHhmm(m)} antes`;
}

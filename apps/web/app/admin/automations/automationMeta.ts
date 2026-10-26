import {
    CalendarCheck,
    CalendarClock,
    Clock,
    FileText,
    FilePlus2,
    GitBranch,
    Hourglass,
    Mail,
    PenLine,
    Plug,
    Repeat,
    Replace,
    Sparkles,
    Wand2,
    Webhook,
    BadgeDollarSign,
    ClipboardList,
    ClipboardCheck,
    MessageCircle,
    MousePointerClick,
    Stamp,
    ListTodo,
    ListTree,
    Zap,
    type LucideIcon,
} from 'lucide-react';

import { APPROVAL_STATUS_LABELS, describeWait, describeWaitApproval, readApprovalTriggerResults, scheduleParts } from '@imagina-base/shared';

import { __, _n, sprintf } from '@/lib/i18n';
import type { ActionMeta, ActionSpec, TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

/**
 * Metadata visual + resúmenes en lenguaje humano del módulo de
 * automatizaciones. El flujo vertical del editor y las tarjetas del
 * índice muestran cada paso como una frase entendible ("Enviar un
 * correo a {{email}}") en vez del slug técnico.
 */

export interface StepMeta {
    icon: LucideIcon;
    /** Título corto de tarjeta (el catálogo del backend puede sobreescribirlo). */
    title: string;
    /** Una línea de qué hace — para el picker de acciones. */
    description: string;
}

export const TRIGGER_META: Record<string, StepMeta> = {
    record_created: {
        icon: Sparkles,
        title: 'Se crea un registro',
        description: 'Dispara cada vez que alguien crea un registro en esta lista.',
    },
    record_updated: {
        icon: PenLine,
        title: 'Se modifica un registro',
        description: 'Dispara cuando un registro cambia (opcionalmente solo ciertos campos).',
    },
    field_changed: {
        icon: Replace,
        title: 'Cambia un campo específico',
        description: 'Dispara cuando un campo pasa de un valor a otro.',
    },
    scheduled: {
        icon: Clock,
        title: 'De forma programada',
        description: 'Corre cada hora, dos veces al día, diario o semanal sobre todos los registros.',
    },
    due_date_reached: {
        icon: CalendarClock,
        title: 'Llega una fecha',
        description: 'Dispara cuando la fecha de un campo llega, se acerca o ya pasó.',
    },
    incoming_webhook: {
        icon: Webhook,
        title: 'Llega un webhook',
        description: 'Dispara cuando otro sistema (un formulario, Zapier, etc.) llama una URL pública única.',
    },
    // D3 — un contacto escribió por WhatsApp oficial.
    whatsapp_message_received: {
        icon: MessageCircle,
        title: 'Llega un mensaje de WhatsApp',
        description: 'Dispara cuando un contacto le escribe a tu número de WhatsApp Business (el registro ya se encontró o creó por su teléfono).',
    },
    payment_received: {
        icon: BadgeDollarSign,
        title: 'Se recibe un pago',
        description: 'Dispara cuando un cliente paga un link de Mercado Pago o Wompi de un registro de esta lista.',
    },
    // v0.1.275 — formularios públicos (ADR-S39).
    form_submitted: {
        icon: ClipboardList,
        title: 'Se envía un formulario',
        description: 'Dispara cuando alguien llena un formulario público de esta lista (el registro ya está creado).',
    },
    // Campo «Botón»: alguien lo presiona en la tabla, la ficha o el portal.
    button_pressed: {
        icon: MousePointerClick,
        title: 'Al presionar el botón',
        description: 'Dispara cuando alguien presiona un campo «Botón» de un registro de esta lista.',
    },
    // C5 — aprobaciones.
    approval_resolved: {
        icon: ClipboardCheck,
        title: 'Cuando se aprueba o se rechaza',
        description: 'Dispara cuando una solicitud de aprobación de esta lista se aprueba, se rechaza, se devuelve o se cancela.',
    },
    // D5 — agenda de citas pública.
    booking_event: {
        icon: CalendarCheck,
        title: 'Se agenda, reprograma o cancela una cita',
        description: 'Dispara cuando un cliente agenda en una página de agenda de esta lista, o cuando la cita se mueve o se cancela.',
    },
    // A9 — checklists del registro.
    checklist_completed: {
        icon: ListTodo,
        title: 'Se completa un checklist',
        description: 'Dispara cuando se marca el último ítem de un checklist de un registro (cualquiera, uno por nombre o todos).',
    },
};

export const ACTION_META: Record<string, StepMeta> = {
    update_field: {
        icon: PenLine,
        title: 'Actualizar campos',
        description: 'Cambia valores del registro que disparó la automatización.',
    },
    create_record: {
        icon: FilePlus2,
        title: 'Crear un registro',
        description: 'Crea un registro nuevo en esta u otra lista, con valores del registro origen.',
    },
    bulk_edit: {
        icon: Wand2,
        title: 'Editar en lote',
        description: 'Cambia muchos registros de la lista de una vez (sumar, porcentajes, poner valores…), por ejemplo cada semana.',
    },
    send_email: {
        icon: Mail,
        title: 'Enviar un correo',
        description: 'Envía un email con asunto y cuerpo personalizables con variables.',
    },
    // v0.1.266 — documentos PDF (ADR-S35).
    generate_pdf: {
        icon: FileText,
        title: 'Generar un PDF',
        description: 'Arma un documento (cuenta de cobro, recibo…) con los datos del registro y lo guarda o lo deja para el correo.',
    },
    call_webhook: {
        icon: Webhook,
        title: 'Llamar un webhook',
        description: 'Hace una petición HTTP a un sistema externo con datos del registro.',
    },
    if_else: {
        icon: GitBranch,
        title: 'Condición Si / Si no',
        description: 'Divide el flujo en dos ramas según una condición sobre el registro.',
    },
    // v0.1.288 — esperas durables y bucle por los vinculados.
    wait: {
        icon: Hourglass,
        title: 'Esperar',
        description: 'Pausa el flujo unos minutos, horas o días, o hasta una fecha del registro; después sigue con los pasos de abajo.',
    },
    // C5 — aprobaciones: pedir una y esperar a que alguien decida.
    request_approval: {
        icon: Stamp,
        title: 'Pedir aprobación',
        description: 'Pide el visto bueno con un flujo de aprobación de la lista: les llega el aviso a quienes aprueban el primer paso.',
    },
    wait_approval: {
        icon: ClipboardCheck,
        title: 'Esperar aprobación',
        description: 'Pausa el flujo hasta que alguien aprueba, rechaza o devuelve la solicitud (con un tope de días opcional); después usa el resultado en un «Si / Si no».',
    },
    // C6 — plantillas de registro.
    create_subtasks_from_template: {
        icon: ListTree,
        title: 'Crear subtareas desde una plantilla',
        description: 'Agrega al registro las subtareas (y, si quieres, los checklists) de una plantilla de registro de la lista.',
    },
    for_each_linked: {
        icon: Repeat,
        title: 'Repetir por cada registro vinculado',
        description: 'Corre los pasos de adentro una vez por cada registro vinculado (las facturas de un cliente, las tareas de un proyecto…).',
    },
    // v0.1.198 — el título real ("Enviar WhatsApp") lo pone el catálogo del
    // backend por conexión; esto es el fallback cuando no está a mano.
    connector_action: {
        icon: Plug,
        title: 'Acción de un conector',
        description: 'Ejecuta una acción con nombre de una conexión configurada en Ajustes.',
    },
};

export function triggerMetaFor(slug: string): StepMeta {
    return TRIGGER_META[slug] ?? { icon: Zap, title: slug, description: '' };
}

export function actionMetaFor(slug: string): StepMeta {
    return ACTION_META[slug] ?? { icon: Zap, title: slug, description: '' };
}

function fieldLabel(fields: FieldEntity[], slug: string): string {
    return fields.find((f) => f.slug === slug)?.label ?? slug;
}

function conditionCount(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return 0;
}

function offsetHuman(offsetMinutes: number): string {
    if (offsetMinutes === 0) return __('el mismo día');
    const abs = Math.abs(offsetMinutes);
    const suffix = offsetMinutes < 0 ? __('antes') : __('después');
    if (abs % 1440 === 0) {
        const days = abs / 1440;
        return days === 1
            ? sprintf(__('1 día %s'), suffix)
            : sprintf(__('%1$d días %2$s'), days, suffix);
    }
    if (abs % 60 === 0) {
        const hours = abs / 60;
        return hours === 1
            ? sprintf(__('1 hora %s'), suffix)
            : sprintf(__('%1$d horas %2$s'), hours, suffix);
    }
    return sprintf(__('%1$d min %2$s'), abs, suffix);
}

const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** v0.1.221 — «cada lunes a las 07:30» (con la misma lectura que el motor). */
export function describeSchedule(config: Record<string, unknown>): string {
    if (typeof config.cron === 'string' && config.cron.trim() !== '') return sprintf(__('según «%s»'), config.cron.trim());
    const p = scheduleParts(config);
    const hhmm = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    switch (p.frequency) {
        case 'hourly':
            return p.minute === 0 ? __('cada hora') : sprintf(__('cada hora, al minuto %02d'), p.minute);
        case 'twicedaily':
            return sprintf(__('dos veces al día (%1$s y 12 horas después)'), hhmm);
        case 'weekly':
            return sprintf(__('cada %1$s a las %2$s'), __(WEEKDAY_NAMES[p.weekday] ?? ''), hhmm);
        case 'monthly':
            return sprintf(__('el día %1$d de cada mes a las %2$s'), p.day, hhmm);
        default:
            return sprintf(__('todos los días a las %s'), hhmm);
    }
}

/**
 * Frase humana del trigger, ej.:
 *  - "Cuando se crea un registro"
 *  - "Cuando se modifica «Estado» o «Monto»"
 *  - "Cuando «Vence» llega (20 días después)"
 */
export function summarizeTrigger(
    triggerType: string,
    config: TriggerConfig,
    fields: FieldEntity[],
): string {
    switch (triggerType) {
        case 'record_created':
            return __('Cuando se crea un registro');
        case 'record_updated': {
            const changed = Array.isArray(config.changed_fields) ? config.changed_fields : [];
            if (changed.length === 0) return __('Cuando se modifica un registro');
            const labels = changed.map((s) => `«${fieldLabel(fields, s)}»`);
            return sprintf(
                /* translators: %s: field names */
                __('Cuando cambia %s'),
                labels.slice(0, 3).join(', ') + (labels.length > 3 ? '…' : ''),
            );
        }
        case 'field_changed': {
            const slug = typeof config.field === 'string' ? config.field : '';
            return slug === ''
                ? __('Cuando cambia un campo')
                : sprintf(__('Cuando cambia «%s»'), fieldLabel(fields, slug));
        }
        case 'scheduled': {
            const base = sprintf(__('De forma programada, %s'), describeSchedule(config));
            // v0.1.288 — «para cada registro que cumpla…»: una corrida por registro.
            if (config.for_each_record !== true) return base;
            return `${base} · ${config.records_filter ? __('por cada registro que cumpla el filtro') : __('por cada registro de la lista')}`;
        }
        case 'due_date_reached': {
            const slug = typeof config.due_field === 'string' ? config.due_field : '';
            const offset = typeof config.offset_minutes === 'number' ? config.offset_minutes : 0;
            if (slug === '') return __('Cuando llega una fecha');
            return sprintf(
                /* translators: 1: date field name, 2: offset like "20 días después" */
                __('Cuando «%1$s» llega (%2$s)'),
                fieldLabel(fields, slug),
                offsetHuman(offset),
            );
        }
        case 'incoming_webhook':
            return __('Cuando llega un webhook entrante');
        case 'payment_received':
            return __('Cuando un cliente paga un link de cobro');
        case 'whatsapp_message_received':
            return __('Cuando llega un mensaje de WhatsApp');
        case 'form_submitted':
            return __('Cuando alguien envía un formulario');
        case 'booking_event': {
            const events = Array.isArray(config.events) ? (config.events as string[]) : [];
            const words: Record<string, string> = { booked: __('se agenda'), rescheduled: __('se reprograma'), cancelled: __('se cancela') };
            const which = events.filter((e) => words[e]).map((e) => words[e]!);
            if (which.length === 0 || which.length === 3) return __('Cuando se agenda, reprograma o cancela una cita');
            return sprintf(__('Cuando %s una cita'), which.join(` ${__('o')} `));
        }
        case 'approval_resolved': {
            const results = readApprovalTriggerResults(config).map((r) => APPROVAL_STATUS_LABELS[r].toLowerCase());
            return sprintf(
                /* translators: %s: resultados («aprobada o rechazada») */
                __('Cuando una solicitud de aprobación queda %s'),
                results.length <= 1 ? (results[0] ?? '') : `${results.slice(0, -1).join(', ')} ${__('o')} ${results[results.length - 1]}`,
            );
        }
        case 'checklist_completed': {
            const mode = typeof config.checklist_mode === 'string' ? config.checklist_mode : 'any';
            const name = typeof config.checklist_name === 'string' ? config.checklist_name.trim() : '';
            if (mode === 'all') return __('Cuando el registro tiene todos sus checklists completos');
            if (mode === 'named' && name !== '') return sprintf(__('Cuando se completa el checklist «%s»'), name);
            return __('Cuando se completa un checklist');
        }
        case 'button_pressed': {
            const id = typeof config.button_field_id === 'number' ? config.button_field_id : 0;
            const button = id > 0 ? fields.find((f) => f.id === id) : undefined;
            if (!button) return __('Cuando alguien presiona un botón');
            return sprintf(
                /* translators: %s: nombre del campo botón */
                __('Cuando alguien presiona «%s»'),
                button.label,
            );
        }
        default:
            return triggerType;
    }
}

/** Cantidad de condiciones (filtros) del trigger, para el chip "· N condiciones". */
export function triggerConditionCount(config: TriggerConfig): number {
    return conditionCount(config.field_filters);
}

/**
 * Frase humana de una acción, ej.:
 *  - "Actualiza «Próximo cobro»"
 *  - "Crea un registro en «Facturas» (4 valores)"
 *  - "Envía un correo a {{email}}"
 *  - "POST https://hooks.example.com/…"
 *  - "Si «estado» = pendiente → 2 acciones, si no → 1"
 */
export function summarizeAction(
    spec: ActionSpec,
    fields: FieldEntity[],
    lists: ListSummary[],
    /**
     * v0.1.198 — el catálogo resuelve la ETIQUETA de una acción de conector
     * ("Enviar WhatsApp") en vez de su clave técnica. Es opcional porque el
     * índice de automatizaciones no lo carga: ahí cae a la clave, que sigue
     * siendo legible.
     */
    catalog?: ActionMeta[],
    /**
     * v0.1.288 — los caminos de relación de la lista: el bucle nombra la lista
     * vinculada aunque la relación viva en la otra lista (sentido inverso).
     */
    relationPaths?: Array<{ relation_field_id: number; relation_label: string; other_list_name: string }>,
): string {
    const cfg = spec.config;
    switch (spec.type) {
        case 'wait': {
            const slug = typeof cfg.date_field === 'string' ? cfg.date_field : '';
            return describeWait(cfg, slug !== '' ? fieldLabel(fields, slug) : undefined);
        }
        case 'request_approval': {
            const note = typeof cfg.note === 'string' && cfg.note.trim() !== '' ? ` · «${cfg.note.trim().slice(0, 60)}»` : '';
            return `${__('Pide una aprobación')}${note}`;
        }
        case 'wait_approval':
            return describeWaitApproval(cfg);
        case 'for_each_linked': {
            const relId = Number(cfg.relation_field_id);
            const path = (relationPaths ?? []).find((p) => p.relation_field_id === relId);
            const own = fields.find((f) => f.id === relId);
            const n = Array.isArray(cfg.actions) ? cfg.actions.length : 0;
            const name = path?.other_list_name ?? own?.label ?? '';
            const base = name !== ''
                ? sprintf(__('Repite por cada registro vinculado de «%s»'), name)
                : __('Repite por cada registro vinculado');
            const extra = [
                ...(cfg.filter_tree ? [__('que cumpla el filtro')] : []),
                sprintf(_n('%d paso', '%d pasos', n), n),
            ];
            return `${base} · ${extra.join(' · ')}`;
        }
        case 'update_field': {
            const values = cfg.values && typeof cfg.values === 'object' ? Object.keys(cfg.values as object) : [];
            // v0.1.288 — dentro de un bucle puede cambiar el registro VINCULADO.
            const onItem = cfg.target === 'item';
            if (values.length === 0) return onItem ? __('Actualiza campos del registro vinculado') : __('Actualiza campos del registro');
            const labels = values.map((s) => `«${onItem ? s : fieldLabel(fields, s)}»`);
            return sprintf(
                /* translators: %s: field names */
                onItem ? __('Actualiza %s del registro vinculado') : __('Actualiza %s'),
                labels.slice(0, 3).join(', ') + (labels.length > 3 ? '…' : ''),
            );
        }
        case 'create_record': {
            const targetId = typeof cfg.target_list === 'number' ? cfg.target_list : undefined;
            const listName = lists.find((l) => l.id === targetId)?.name;
            const values = cfg.values && typeof cfg.values === 'object' ? Object.keys(cfg.values as object).length : 0;
            const base = listName !== undefined
                ? sprintf(__('Crea un registro en «%s»'), listName)
                : __('Crea un registro en esta lista');
            // C6 — con plantilla: el registro trae sus subtareas y checklists.
            const withTpl = cfg.template_id ? `${base} · ${__('desde una plantilla')}` : base;
            return values > 0 ? `${withTpl} · ${sprintf(__('%d valores'), values)}` : withTpl;
        }
        case 'create_subtasks_from_template': {
            if (!cfg.template_id) return __('Crea subtareas desde una plantilla (elige la plantilla)');
            return cfg.include_checklists === true
                ? __('Crea las subtareas y los checklists de una plantilla')
                : __('Crea las subtareas de una plantilla');
        }
        case 'bulk_edit': {
            const n = Array.isArray(cfg.operations) ? cfg.operations.length : 0;
            const base = cfg.filter_tree ? __('Edita en lote los que cumplen el filtro') : __('Edita en lote toda la lista');
            return n > 0 ? `${base} · ${sprintf(n === 1 ? __('%d cambio') : __('%d cambios'), n)}` : base;
        }
        case 'send_email': {
            const to = typeof cfg.to === 'string' ? cfg.to : '';
            const base = to === ''
                ? __('Envía un correo')
                : sprintf(__('Envía un correo a %s'), to);
            const pdfs = Array.isArray(cfg.pdf_templates) ? cfg.pdf_templates.length : 0;
            return pdfs > 0 ? `${base} · ${pdfs === 1 ? __('con un PDF adjunto') : sprintf(__('con %d PDF adjuntos'), pdfs)}` : base;
        }
        case 'generate_pdf': {
            const save = typeof cfg.save_field === 'string' ? cfg.save_field : '';
            if (!cfg.document_template_id) return __('Genera un PDF (elige la plantilla)');
            return save !== ''
                ? sprintf(__('Genera un PDF y lo guarda en «%s»'), fieldLabel(fields, save))
                : __('Genera un PDF');
        }
        case 'connector_action': {
            const key = typeof cfg.action_key === 'string' ? cfg.action_key : '';
            const connId = Number(cfg.connection_id);
            if (key === '') return __('Acción de un conector');
            const hit = (catalog ?? []).find(
                (a) => a.connector?.action_key === key && a.connector.connection_id === connId,
            );
            // Con catálogo cargado y sin coincidencia, la acción ya no existe
            // en el conector: decirlo aquí evita que alguien crea que anda.
            if (!hit && (catalog ?? []).length > 0) {
                return sprintf(
                    /* translators: %s: action key */
                    __('La acción «%s» ya no existe en el conector'),
                    key,
                );
            }
            if (!hit) return sprintf(/* translators: %s: action key */ __('Ejecuta «%s»'), key);
            return sprintf(
                /* translators: 1: action label, 2: connection name */
                __('%1$s · %2$s'),
                hit.label,
                hit.connector!.connection_name,
            );
        }
        case 'call_webhook': {
            const method = typeof cfg.method === 'string' ? cfg.method : 'POST';
            const url = typeof cfg.url === 'string' ? cfg.url : '';
            if (url === '') return __('Llama un webhook');
            const short = url.length > 48 ? `${url.slice(0, 48)}…` : url;
            return `${method} ${short}`;
        }
        case 'if_else': {
            const thenN = Array.isArray(cfg.then_actions) ? cfg.then_actions.length : 0;
            const elseN = Array.isArray(cfg.else_actions) ? cfg.else_actions.length : 0;
            return sprintf(
                /* translators: 1: «N acción/acciones» si se cumple, 2: «N» si no */
                __('Divide el flujo: %1$s si se cumple, %2$s si no'),
                sprintf(_n('%d acción', '%d acciones', thenN), thenN),
                sprintf(_n('%d acción', '%d acciones', elseN), elseN),
            );
        }
        default:
            return spec.type;
    }
}

/** Cantidad de condiciones de ejecución de una acción (chip "N cond."). */
export function actionConditionCount(spec: ActionSpec): number {
    return conditionCount(spec.condition);
}

// --- v0.1.288: historial de versiones ---

interface VersionLike {
    name: string;
    description: string | null;
    trigger_type: string;
    trigger_config: Record<string, unknown>;
    actions: ActionSpec[];
    is_active: boolean;
}

/** JSON estable (claves ordenadas): la base de datos reordena las claves de un jsonb. */
export function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/**
 * Qué cambió entre dos versiones, en lenguaje claro: «Renombró…», «La
 * pausó», «Cambió el disparador…», «Agregó: Envía un correo a…», «Quitó…»,
 * «Cambió: …», «Reordenó los pasos». Compara los pasos de primer nivel por
 * su contenido (un cambio dentro de un si/sino o de un bucle se ve como un
 * cambio de ese paso).
 */
export function describeVersionChanges(
    prev: VersionLike | null,
    next: VersionLike,
    fields: FieldEntity[],
    lists: ListSummary[],
    catalog?: ActionMeta[],
): string[] {
    if (!prev) return [__('Primera versión guardada.')];
    const out: string[] = [];
    if (prev.name !== next.name) out.push(sprintf(__('Cambió el nombre: «%1$s» → «%2$s».'), prev.name, next.name));
    if ((prev.description ?? '') !== (next.description ?? '')) out.push(__('Cambió la descripción.'));
    if (prev.is_active !== next.is_active) out.push(next.is_active ? __('La activó.') : __('La pausó.'));
    if (prev.trigger_type !== next.trigger_type || stableJson(prev.trigger_config) !== stableJson(next.trigger_config)) {
        out.push(sprintf(__('Cambió el disparador: %s.'), summarizeTrigger(next.trigger_type, next.trigger_config as TriggerConfig, fields)));
    }
    const sig = (a: ActionSpec): string => stableJson(a);
    const prevSigs = prev.actions.map(sig);
    const nextSigs = next.actions.map(sig);
    if (prevSigs.join('|') !== nextSigs.join('|')) {
        // Multiconjuntos: lo que sobra en la nueva se agregó; lo que falta, se quitó.
        const pool = [...prevSigs];
        const added: ActionSpec[] = [];
        next.actions.forEach((a, i) => {
            const at = pool.indexOf(nextSigs[i]!);
            if (at >= 0) pool.splice(at, 1);
            else added.push(a);
        });
        const nextPool = [...nextSigs];
        const removed: ActionSpec[] = [];
        prev.actions.forEach((a, i) => {
            const at = nextPool.indexOf(prevSigs[i]!);
            if (at >= 0) nextPool.splice(at, 1);
            else removed.push(a);
        });
        const describe = (a: ActionSpec): string => summarizeAction(a, fields, lists, catalog);
        // Un agregado y un quitado del mismo tipo se leen como «cambió».
        const changed: ActionSpec[] = [];
        for (const a of [...added]) {
            const twin = removed.findIndex((r) => r.type === a.type);
            if (twin >= 0) {
                removed.splice(twin, 1);
                added.splice(added.indexOf(a), 1);
                changed.push(a);
            }
        }
        for (const a of changed) out.push(sprintf(__('Cambió un paso: %s.'), describe(a)));
        for (const a of added) out.push(sprintf(__('Agregó un paso: %s.'), describe(a)));
        for (const a of removed) out.push(sprintf(__('Quitó un paso: %s.'), describe(a)));
        if (changed.length + added.length + removed.length === 0) out.push(__('Reordenó los pasos.'));
    }
    if (out.length === 0) return [__('Sin cambios respecto de la versión anterior.')];
    const MAX = 6;
    return out.length > MAX ? [...out.slice(0, MAX), sprintf(__('…y %d cambios más.'), out.length - MAX)] : out;
}

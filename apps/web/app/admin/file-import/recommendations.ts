import type { DashboardTemplateSummary, FileImportDataKind, RoleListMapping } from '@imagina-base/shared';

import { suggestRoleMapping } from '@/admin/templates/roleMapping';
import { IDEAS } from '@/admin/ideas/catalog';
import { ideasThatFit } from '@/admin/ideas/IdeasForList';
import type { IdeaDef } from '@/admin/ideas/types';
import type { FieldEntity } from '@/types/field';

/**
 * v0.1.339 (ADR-S88) — Lo que se le RECOMIENDA a quien acaba de crear listas
 * desde un archivo: vistas que encajan con sus campos, un tablero de la
 * galería que se arma solo, ideas de automatizaciones y algún ajuste. Cada
 * recomendación usa piezas que ya existen (vistas, plantillas de tablero,
 * ideas): se aprueba con un clic y se puede deshacer como cualquier cosa.
 * Puro: decide; la pantalla aplica.
 */

export type RecField = Pick<FieldEntity, 'id' | 'slug' | 'label' | 'type'>;

export interface RecList {
    id: number;
    slug: string;
    name: string;
    fields: RecField[];
}

export type Recommendation =
    | { kind: 'view_kanban'; id: string; list: RecList; field: RecField; name: string }
    | { kind: 'view_calendar'; id: string; list: RecList; field: RecField; name: string }
    | { kind: 'dashboard'; id: string; list: RecList; template: DashboardTemplateSummary; mapping: Record<string, RoleListMapping>; name: string }
    | { kind: 'idea'; id: string; list: RecList; idea: IdeaDef }
    | { kind: 'form'; id: string; list: RecList }
    | { kind: 'invite'; id: string };

const STATUS = /(estado|etapa|status|fase|prioridad|pipeline)/;
/** Fechas para el calendario, de la más útil a la menos: un vencimiento gana a una «Fecha» suelta. */
const DUE = [/(venc|entrega|limite|cita|evento|programad|cierre|proxim)/, /(inicio|comienzo)/];
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Qué categorías de tablero encajan con cada clase de datos (la primera manda). */
const KIND_CATEGORIES: Record<FileImportDataKind, string[]> = {
    contacts: ['clientes', 'ventas'],
    sales: ['ventas', 'clientes'],
    invoices: ['finanzas', 'ventas'],
    projects: ['proyectos', 'operaciones'],
    support: ['clientes', 'operaciones'],
    inventory: ['operaciones', 'finanzas'],
    appointments: ['clientes', 'operaciones'],
    recruiting: ['personas'],
    events: ['operaciones', 'clientes'],
    expenses: ['finanzas'],
    generic: [],
};

/** Categorías de ideas (galería «Ideas para tu negocio») que tienen sentido para cada clase de datos. */
const KIND_IDEA_CATEGORIES: Record<FileImportDataKind, readonly IdeaDef['category'][]> = {
    contacts: ['clientes', 'ventas'],
    sales: ['ventas', 'clientes'],
    invoices: ['cobros', 'ventas'],
    projects: ['proyectos', 'equipo'],
    support: ['clientes', 'equipo'],
    inventory: ['tienda'],
    appointments: ['agenda', 'clientes'],
    recruiting: ['equipo'],
    events: ['agenda', 'clientes'],
    expenses: ['cobros'],
    generic: [],
};

/** Clases de datos donde recibir registros desde un formulario es lo natural. */
const FORM_KINDS = new Set<FileImportDataKind>(['contacts', 'support', 'events', 'recruiting', 'appointments']);

export function buildRecommendations(input: {
    lists: RecList[];
    kind: FileImportDataKind;
    templates: readonly DashboardTemplateSummary[];
    ideas?: readonly IdeaDef[];
    canManageDashboards: boolean;
    canManageAutomations: boolean;
    canInvite: boolean;
}): Recommendation[] {
    const out: Recommendation[] = [];
    const ideasCatalog = input.ideas ?? IDEAS;

    for (const list of input.lists) {
        const selects = list.fields.filter((f) => f.type === 'select');
        const status = selects.find((f) => STATUS.test(fold(f.label))) ?? selects[0];
        if (status) out.push({ kind: 'view_kanban', id: `kanban:${list.id}`, list, field: status, name: `Por ${status.label.toLocaleLowerCase('es')}` });

        const dates = list.fields.filter((f) => f.type === 'date' || f.type === 'datetime');
        const due = DUE.map((re) => dates.find((f) => re.test(fold(f.label)))).find(Boolean) ?? dates[0];
        if (due) out.push({ kind: 'view_calendar', id: `calendar:${list.id}`, list, field: due, name: `Calendario de ${due.label.toLocaleLowerCase('es')}` });
    }

    // Un tablero: el de la galería que mejor encaja con alguna de las listas (todo rol obligatorio cubierto).
    if (input.canManageDashboards) {
        let best: { score: number; rec: Extract<Recommendation, { kind: 'dashboard' }> } | null = null;
        const cats = KIND_CATEGORIES[input.kind];
        for (const t of input.templates) {
            if (t.source !== 'system' || t.lists.length !== 1) continue;
            const role = t.lists[0]!;
            for (const list of input.lists) {
                const mapping = suggestRoleMapping(role.fields, list.fields);
                const fits = role.fields.filter((f) => f.required).every((f) => mapping[f.key] !== undefined);
                if (!fits) continue;
                const catIdx = cats.indexOf(t.category);
                const score = (catIdx === 0 ? 6 : catIdx > 0 ? 4 : 0) + Object.keys(mapping).length + (list === input.lists[0] ? 1 : 0);
                if (!best || score > best.score) {
                    best = {
                        score,
                        rec: {
                            kind: 'dashboard',
                            id: `dashboard:${t.id}:${list.id}`,
                            list,
                            template: t,
                            mapping: { [role.key]: { list_id: list.id, fields: mapping } },
                            name: `${t.name} · ${list.name}`.slice(0, 190),
                        },
                    };
                }
            }
        }
        if (best) out.push(best.rec);
    }

    // Ideas de automatizaciones: primero las que no piden conectar otra app.
    if (input.canManageAutomations) {
        const seen = new Set<string>();
        let count = 0;
        for (const list of input.lists) {
            // Sólo automatizaciones (el tablero ya se recomienda aparte) y, si se sabe qué
            // son los datos, sólo de las categorías que les corresponden: a una lista de
            // facturas no se le sugiere el SLA de un soporte.
            const ideaCats = KIND_IDEA_CATEGORIES[input.kind];
            const fit = ideasThatFit(list, list.fields, ideasCatalog).filter((i) => i.plan.kind === 'automations' && (ideaCats.length === 0 || ideaCats.includes(i.category)));
            const rank = (i: IdeaDef): number => (ideaCats.length ? ideaCats.indexOf(i.category) : 0) * 2 + (i.needsApps?.length ? 1 : 0);
            const ordered = [...fit].sort((a, b) => rank(a) - rank(b));
            for (const idea of ordered) {
                if (count >= 3 || seen.has(idea.id)) continue;
                seen.add(idea.id);
                out.push({ kind: 'idea', id: `idea:${idea.id}:${list.id}`, list, idea });
                count++;
            }
        }
    }

    if (FORM_KINDS.has(input.kind) && input.lists[0]) out.push({ kind: 'form', id: `form:${input.lists[0].id}`, list: input.lists[0] });
    if (input.canInvite) out.push({ kind: 'invite', id: 'invite' });
    return out;
}

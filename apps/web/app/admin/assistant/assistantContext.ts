/**
 * v0.1.370 — Qué tiene abierto la persona y qué tiene sentido pedirle al
 * asistente desde ahí. Puro (sin React) para poder probarlo.
 */

export type AssistantScreen = 'record' | 'records' | 'automations' | 'list_settings' | 'dashboard' | 'dashboards' | 'lists' | 'my_work' | 'other';

export interface ScreenContext {
    screen: AssistantScreen;
    listSlug?: string;
    recordId?: number;
}

/** Lee la ruta (`/lists/clientes/records/42`…) y devuelve la pantalla. */
export function screenContext(pathname: string): ScreenContext {
    const path = pathname.replace(/\/+$/, '') || '/';
    const list = /^\/lists\/([^/?#]+)(?:\/(.*))?$/.exec(path);
    if (list && list[1] !== 'new') {
        const listSlug = decodeURIComponent(list[1]!);
        const rest = list[2] ?? '';
        const record = /^records\/(\d+)$/.exec(rest);
        if (record) {
            const id = Number(record[1]);
            if (Number.isSafeInteger(id) && id > 0) return { screen: 'record', listSlug, recordId: id };
        }
        if (rest.startsWith('automations')) return { screen: 'automations', listSlug };
        if (rest === 'edit' || rest.startsWith('portal-editor') || rest.startsWith('template-editor')) return { screen: 'list_settings', listSlug };
        return { screen: 'records', listSlug };
    }
    if (/^\/dashboards\/[^/]+$/.test(path)) return { screen: 'dashboard' };
    if (path === '/dashboards') return { screen: 'dashboards' };
    if (path === '/' || path === '/lists' || path.startsWith('/folders/') || path === '/favorites') return { screen: 'lists' };
    if (path === '/my-work') return { screen: 'my_work' };
    return { screen: 'other' };
}

export type SuggestionKind = 'data' | 'build' | 'automate' | 'design';

export interface AssistantSuggestion {
    kind: SuggestionKind;
    text: string;
}

export interface SuggestionGroup {
    /** Para qué sirve el asistente en esta pantalla, en una línea. */
    title: string;
    items: AssistantSuggestion[];
}

const GENERAL: AssistantSuggestion[] = [
    { kind: 'build', text: 'Ármame una lista de proveedores con contacto, categoría, estado y saldo pendiente' },
    { kind: 'data', text: '¿Qué listas tengo y cuántos registros tiene cada una?' },
    { kind: 'build', text: 'Crea un CRM simple: clientes y oportunidades vinculadas, con un kanban por etapa' },
    { kind: 'automate', text: 'Cuando se cree un registro, avísale por correo al responsable' },
];

/** Las sugerencias de la pantalla, con lo que la persona tiene abierto. */
export function suggestionsFor(ctx: ScreenContext): SuggestionGroup {
    switch (ctx.screen) {
        case 'record':
            return {
                title: 'Sobre este registro',
                items: [
                    { kind: 'data', text: 'Resúmeme este registro: lo importante, lo que falta y lo que se habló' },
                    { kind: 'data', text: '¿Qué campos de este registro están vacíos o desactualizados?' },
                    { kind: 'automate', text: 'Crea una automatización que avise al responsable cuando cambie el estado de un registro como este' },
                    { kind: 'design', text: 'Diseña la ficha de esta lista con lo más importante arriba' },
                ],
            };
        case 'records':
            return {
                title: 'Sobre esta lista',
                items: [
                    { kind: 'data', text: '¿Cuántos registros hay por estado? Muéstramelo en una tabla' },
                    { kind: 'data', text: '¿Qué vence esta semana?' },
                    { kind: 'build', text: 'Crea una vista kanban agrupada por estado' },
                    { kind: 'build', text: 'Agrégale un campo de prioridad (alta, media, baja) con colores' },
                    { kind: 'design', text: 'Crea un tablero con los indicadores más útiles de esta lista' },
                ],
            };
        case 'automations':
            return {
                title: 'Automatizaciones de esta lista',
                items: [
                    { kind: 'data', text: 'Explícame qué hace cada automatización de esta lista' },
                    { kind: 'data', text: '¿Qué automatizaciones fallaron últimamente y por qué?' },
                    { kind: 'automate', text: 'Avísale por correo al responsable un día antes de que venza un registro' },
                    { kind: 'automate', text: 'Cuando el estado pase a cerrado, ponle la fecha de cierre de hoy' },
                ],
            };
        case 'list_settings':
            return {
                title: 'Ajustes de esta lista',
                items: [
                    { kind: 'design', text: 'Revisa los campos de esta lista y sugiéreme mejoras' },
                    { kind: 'design', text: 'Diseña la ficha del registro con una pestaña por cada lista vinculada' },
                    { kind: 'build', text: 'Arma un portal para que cada cliente vea sus registros' },
                    { kind: 'build', text: 'Haz que los agentes sólo vean los registros que tienen asignados' },
                ],
            };
        case 'dashboard':
            return {
                title: 'Sobre este tablero',
                items: [
                    { kind: 'data', text: 'Explícame qué muestra cada gráfico de este tablero' },
                    { kind: 'design', text: 'Sugiéreme qué indicadores le faltan a este tablero' },
                    { kind: 'design', text: 'Crea otro tablero con las ventas por mes y por responsable' },
                ],
            };
        case 'dashboards':
            return {
                title: 'Tableros',
                items: [
                    { kind: 'design', text: 'Crea un tablero de ventas con los indicadores más útiles' },
                    { kind: 'data', text: '¿Qué tableros tengo y qué lista usa cada uno?' },
                    { kind: 'design', text: 'Arma un tablero de soporte: tickets abiertos, por prioridad y por responsable' },
                ],
            };
        case 'my_work':
            return {
                title: 'Tu trabajo',
                items: [
                    { kind: 'data', text: '¿Qué tengo vencido o por vencer esta semana en todas mis listas?' },
                    { kind: 'automate', text: 'Recuérdame por correo cada mañana lo que vence ese día' },
                    ...GENERAL.slice(0, 1),
                ],
            };
        default:
            return { title: 'Ideas para empezar', items: GENERAL };
    }
}

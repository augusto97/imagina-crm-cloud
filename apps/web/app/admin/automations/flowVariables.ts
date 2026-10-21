import { RESPONSE_NAME_RE } from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import type { ActionSpec } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { pathKey, stepsBefore, type NodePath } from './actionsTree';
import type { MergeTagSection } from './MergeTagInput';

/**
 * v0.1.288 — Las variables que un paso puede usar además de los campos del
 * registro: la respuesta de los webhooks/conectores que corrieron ANTES
 * (`{{webhook.status}}`, `{{webhook.body.x}}`, `{{respuestas.<nombre>…}}`) y,
 * dentro de un «Repetir por cada registro vinculado», los campos del
 * vinculado (`{{item.<slug>}}`). Funciones puras: el selector de variables
 * las arma por paso y los tests las verifican sin React.
 */

/** Lo que el editor sabe del registro vinculado de un bucle. */
export interface LoopItemInfo {
    listId: number;
    listName: string;
    relationLabel: string;
    fields: FieldEntity[];
}

const RESPONSE_STEPS = new Set(['call_webhook', 'connector_action']);
const MAX_SAMPLE_ITEMS = 30;
const MAX_SAMPLE_DEPTH = 4;

function preview(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 40)}…` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return sprintf(__('lista de %d'), value.length);
    return '{…}';
}

/**
 * Las rutas de una respuesta real (`data.items.0.id`) como variables: así
 * quien arma la automatización no tiene que adivinar la forma del JSON. De
 * una lista se ofrece el primer elemento (`.0`), que es lo habitual.
 */
export function sampleTagItems(prefix: string, sample: unknown): Array<{ tag: string; label: string; hint?: string }> {
    const out: Array<{ tag: string; label: string; hint?: string }> = [];
    const walk = (value: unknown, path: string[], depth: number): void => {
        if (out.length >= MAX_SAMPLE_ITEMS) return;
        if (value !== null && typeof value === 'object' && depth < MAX_SAMPLE_DEPTH) {
            if (Array.isArray(value)) {
                if (value.length > 0) walk(value[0], [...path, '0'], depth + 1);
                return;
            }
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                // Una clave con espacios o puntos no se puede escribir como ruta.
                if (!/^[A-Za-z0-9_-]+$/.test(k)) continue;
                walk(v, [...path, k], depth + 1);
                if (out.length >= MAX_SAMPLE_ITEMS) return;
            }
            return;
        }
        if (path.length === 0) return;
        const rel = path.join('.');
        out.push({ tag: `${prefix}.${rel}`, label: rel, hint: preview(value) });
    };
    walk(sample, [], 0);
    return out;
}

/** Un cuerpo de respuesta en texto → JSON si se puede (para sugerir sus rutas). */
export function parseSample(body: unknown): unknown {
    if (typeof body !== 'string') return body;
    const t = body.trim();
    if (!(t.startsWith('{') || t.startsWith('['))) return null;
    try {
        return JSON.parse(t) as unknown;
    } catch {
        return null;
    }
}

/** Los campos del vinculado de un bucle como variables (`{{item.<slug>}}`). */
export function itemSection(item: LoopItemInfo): MergeTagSection {
    const usable = item.fields.filter((f) => f.type !== 'relation');
    return {
        title: sprintf(__('Registro vinculado («%s»)'), item.listName),
        items: [
            { tag: 'item.record.id', label: __('ID del vinculado'), hint: '{{item.record.id}}' },
            ...usable.map((f) => ({ tag: `item.${f.slug}`, label: f.label, hint: `{{item.${f.slug}}}` })),
            ...usable
                .filter((f) => f.type === 'select' || f.type === 'multi_select')
                .map((f) => ({ tag: `item.${f.slug}|label`, label: `${f.label} · ${__('etiqueta')}`, hint: `{{item.${f.slug}|label}}` })),
        ],
    };
}

/**
 * Las secciones de variables EXTRA disponibles en el paso `path`: el
 * vinculado del bucle (si el paso está adentro) y las respuestas de los pasos
 * con webhook/conector anteriores. `samples` son cuerpos de respuestas reales
 * por ruta (de «Probar» o del probador del webhook): con ellos se sugieren
 * las rutas del JSON.
 */
export function variablesAt(
    actions: ActionSpec[],
    path: NodePath,
    samples: Record<string, unknown>,
    item: LoopItemInfo | null,
): MergeTagSection[] {
    const out: MergeTagSection[] = [];
    if (item) out.push(itemSection(item));
    const prev = stepsBefore(actions, path).filter((s) => RESPONSE_STEPS.has(s.spec.type));
    if (prev.length === 0) return out;
    const last = prev[prev.length - 1]!;
    const lastSample = parseSample(samples[pathKey(last.path)]);
    out.push({
        title: __('Respuesta del webhook anterior'),
        items: [
            { tag: 'webhook.status', label: __('Código HTTP'), hint: '200' },
            { tag: 'webhook.body', label: __('Respuesta completa'), hint: __('el cuerpo tal cual llegó') },
            ...sampleTagItems('webhook.body', lastSample),
        ],
    });
    const seen = new Set<string>();
    for (const step of [...prev].reverse()) {
        const name = typeof step.spec.config.response_name === 'string' ? step.spec.config.response_name.trim() : '';
        if (!RESPONSE_NAME_RE.test(name) || seen.has(name)) continue;
        seen.add(name);
        const sample = parseSample(samples[pathKey(step.path)]);
        out.push({
            title: sprintf(__('Respuesta «%s»'), name),
            items: [
                { tag: `respuestas.${name}.status`, label: __('Código HTTP'), hint: '200' },
                { tag: `respuestas.${name}.body`, label: __('Respuesta completa') },
                ...sampleTagItems(`respuestas.${name}.body`, sample),
            ],
        });
    }
    return out;
}

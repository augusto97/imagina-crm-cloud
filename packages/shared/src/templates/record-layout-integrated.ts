import type { RecordLayoutV3 } from '../schemas/record-layout';
import {
    autoRecordLayout,
    type AutoLayoutFlavor,
    type AutoLayoutRelation,
    type LayoutFieldLite,
} from './record-layout-builders';

/**
 * v0.1.472 — La ficha diseñada de una lista que usa una plantilla INTEGRADA
 * (sin diseño guardado): la arman igual el front (`useRecordLayout`) y el
 * servidor (el bundle de la ficha), así el servidor manda los datos de sus
 * gráficos y tablas en el mismo pedido y la firma de los bloques coincide
 * por construcción.
 */

const FLAVORS: ReadonlySet<string> = new Set(['contact', 'deal', 'task', 'support']);

/** Lo que la ficha usa de un campo (el mismo recorte en el front y el servidor). */
export function toLayoutFieldLite(f: {
    id: number;
    slug: string;
    label: string;
    type: LayoutFieldLite['type'];
    config?: unknown;
    is_primary?: boolean;
}): LayoutFieldLite {
    return {
        id: f.id,
        slug: f.slug,
        label: f.label,
        type: f.type,
        config: f.config as Record<string, unknown>,
        is_primary: f.is_primary,
    };
}

/**
 * ¿Qué plantilla integrada usa la lista? `null` = la del editor anterior
 * (`custom`), que se convierte con su propia función.
 */
export function integratedLayoutFlavor(
    settings: Record<string, unknown> | null | undefined,
    previewTemplate?: AutoLayoutFlavor,
): AutoLayoutFlavor | null {
    const id = previewTemplate ?? (typeof settings?.crm_template_id === 'string' ? settings.crm_template_id : 'auto');
    if (id === 'custom') return null;
    return (FLAVORS.has(id) ? id : 'auto') as AutoLayoutFlavor;
}

/** Una relación que toca la lista (la forma de `GET /fields/relation-paths`). */
export interface LayoutRelationPathLite {
    relation_field_id: number;
    direction: 'forward' | 'reverse';
    relation_label: string;
    other_list_id: number;
    other_list_name: string;
}

/** Las relaciones que mira la ficha automática (las primeras 4). */
export const INTEGRATED_LAYOUT_RELATIONS = 4;

export function integratedRecordLayout(input: {
    flavor: AutoLayoutFlavor;
    fields: readonly LayoutFieldLite[];
    paths: readonly LayoutRelationPathLite[];
    /** Los campos de la lista del otro lado (vacío si no se pudieron leer). */
    otherFields: (listId: number) => readonly LayoutFieldLite[];
}): RecordLayoutV3 {
    const relations: AutoLayoutRelation[] = input.paths.slice(0, INTEGRATED_LAYOUT_RELATIONS).map((p) => ({
        relation_field_id: p.relation_field_id,
        direction: p.direction,
        relation_label: p.relation_label,
        other_list_name: p.other_list_name,
        other_fields: input.otherFields(p.other_list_id),
    }));
    return autoRecordLayout({ fields: input.fields, relations, flavor: input.flavor });
}

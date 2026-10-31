import {
    cleanFieldLabel,
    makeFileImportCellReader,
    typeExtras,
    uniqueFieldSlug,
    type FileImportField,
    type FileImportFieldType,
    type FileImportPlan,
    type FileImportSheetProfile,
    type ResolvedImportField,
} from '@imagina-base/shared';

/**
 * v0.1.339 — Cambios del plan desde la pantalla de revisión, inmutables
 * (cada uno devuelve un plan nuevo). Puros: los usa la pantalla y los tests.
 */

export type FieldPatch = Partial<Pick<FileImportField, 'include' | 'label' | 'currency'>> & { type?: FileImportFieldType };

export function patchField(
    plan: FileImportPlan,
    sheets: readonly FileImportSheetProfile[],
    sheet: number,
    column: number,
    patch: FieldPatch,
    defaults: { currency: string; country: string },
): FileImportPlan {
    return {
        ...plan,
        lists: plan.lists.map((l) => {
            if (l.sheet !== sheet) return l;
            return {
                ...l,
                fields: l.fields.map((f) => {
                    if (f.column !== column) return f;
                    let next: FileImportField = { ...f };
                    if (patch.include !== undefined) next.include = patch.include;
                    if (patch.label !== undefined) {
                        const label = patch.label.slice(0, 80);
                        next.label = label;
                        if (label.trim() !== '') {
                            const used = new Set(l.fields.filter((x) => x.column !== column).map((x) => x.slug));
                            next.slug = uniqueFieldSlug(cleanFieldLabel(label), used);
                        }
                    }
                    if (patch.currency !== undefined) next.currency = patch.currency;
                    if (patch.type !== undefined && patch.type !== f.type) {
                        const col = sheets.find((s) => s.index === sheet)?.columns[column];
                        next = { column: f.column, include: next.include, label: next.label, slug: next.slug, type: patch.type, reason: f.reason, confidence: 'high' };
                        if (col) Object.assign(next, typeExtras(col, [], patch.type, { fileName: '', currency: defaults.currency, country: defaults.country }));
                    }
                    return next;
                }),
            };
        }),
    };
}

export function patchList(plan: FileImportPlan, sheet: number, patch: Partial<Pick<FileImportPlan['lists'][number], 'name' | 'include' | 'title_column' | 'skip_duplicates'>>): FileImportPlan {
    return {
        ...plan,
        lists: plan.lists.map((l) => {
            if (l.sheet !== sheet) return l;
            const next = { ...l, ...patch };
            // El título siempre se importa.
            if (patch.title_column !== undefined) next.fields = next.fields.map((f) => (f.column === patch.title_column ? { ...f, include: true } : f));
            return next;
        }),
        // Una lista separada no puede llevarse la columna que pasa a ser título.
        entities:
            patch.title_column !== undefined
                ? plan.entities.map((e) => (e.sheet === sheet && (e.key_column === patch.title_column || e.columns.includes(patch.title_column!)) ? { ...e, include: false } : e))
                : plan.entities,
    };
}

export function patchEntity(plan: FileImportPlan, sheet: number, keyColumn: number, patch: Partial<Pick<FileImportPlan['entities'][number], 'include' | 'name'>>): FileImportPlan {
    return { ...plan, entities: plan.entities.map((e) => (e.sheet === sheet && e.key_column === keyColumn ? { ...e, ...patch } : e)) };
}

export function patchLink(plan: FileImportPlan, sheet: number, column: number, include: boolean): FileImportPlan {
    return { ...plan, links: plan.links.map((l) => (l.sheet === sheet && l.column === column ? { ...l, include } : l)) };
}

/** Columnas que pasan a una lista separada (incluida), por hoja. */
export function movedColumns(plan: FileImportPlan, sheet: number): Map<number, string> {
    const out = new Map<number, string>();
    for (const e of plan.entities) {
        if (!e.include || e.sheet !== sheet) continue;
        for (const c of e.columns) out.set(c, e.name);
    }
    return out;
}

export type PreviewCell = { text: string; ok: boolean };

/** Cómo va a quedar una celda del archivo en el campo (para la vista previa de cada columna). */
export function previewCell(field: FileImportField, raw: string): PreviewCell {
    const t = raw.trim();
    if (t === '') return { text: '—', ok: true };
    const resolved: ResolvedImportField = { ...field } as ResolvedImportField;
    const v = makeFileImportCellReader(resolved)(t);
    switch (field.type) {
        case 'number':
        case 'currency':
        case 'percent':
        case 'rating':
            return typeof v === 'number' ? { text: String(v), ok: true } : { text: t, ok: false };
        case 'date':
        case 'datetime':
            return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? { text: v.replace('T', ' ').slice(0, 16), ok: true } : { text: t, ok: false };
        case 'checkbox':
            return { text: v === true ? 'Sí' : 'No', ok: true };
        case 'email':
            return { text: t, ok: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) };
        case 'select': {
            const opt = field.options?.find((o) => o.value === v);
            return opt ? { text: opt.label, ok: true } : { text: t, ok: false };
        }
        case 'multi_select': {
            const values = Array.isArray(v) ? (v as string[]) : [];
            const labels = values.map((x) => field.options?.find((o) => o.value === x)?.label ?? x);
            return { text: labels.join(', '), ok: values.every((x) => field.options?.some((o) => o.value === x)) };
        }
        default:
            return { text: t.length > 60 ? `${t.slice(0, 60)}…` : t, ok: true };
    }
}

/**
 * Lo que la persona cambió a mano antes de pedir la mejora con IA se respeta:
 * la propuesta de la IA (`theirs`) se aplica sólo donde el plan actual
 * (`ours`) sigue igual al borrador original (`base`). Por campo, por lista,
 * por lista separada y por vínculo; al final los nombres internos se vuelven
 * a hacer únicos (un nombre que eligió la persona puede chocar con uno de la IA).
 */
export function keepUserEdits(base: FileImportPlan, ours: FileImportPlan, theirs: FileImportPlan): FileImportPlan {
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    const lists = theirs.lists.map((t) => {
        const b = base.lists.find((l) => l.sheet === t.sheet);
        const o = ours.lists.find((l) => l.sheet === t.sheet);
        if (!b || !o) return t;
        const next = { ...t };
        for (const k of ['name', 'include', 'title_column', 'skip_duplicates'] as const) {
            if (!same(o[k], b[k])) (next as Record<string, unknown>)[k] = o[k];
        }
        const used = new Set<string>();
        next.fields = t.fields
            .map((tf) => {
                const bf = b.fields.find((f) => f.column === tf.column);
                const of = o.fields.find((f) => f.column === tf.column);
                const field = bf && of && !same(of, bf) ? of : tf;
                return next.title_column === field.column ? { ...field, include: true } : field;
            })
            .map((f) => {
                if (!used.has(f.slug)) {
                    used.add(f.slug);
                    return f;
                }
                return { ...f, slug: uniqueFieldSlug(f.label, used) };
            });
        return next;
    });
    const entities = theirs.entities.map((t) => {
        const b = base.entities.find((e) => e.sheet === t.sheet && e.key_column === t.key_column);
        const o = ours.entities.find((e) => e.sheet === t.sheet && e.key_column === t.key_column);
        if (!b || !o) return t;
        let next = { ...t };
        if (o.include !== b.include) next = { ...next, include: o.include };
        if (o.name !== b.name) next = { ...next, name: o.name };
        // Una lista separada no puede llevarse el título de su hoja.
        const title = lists.find((l) => l.sheet === next.sheet)?.title_column;
        if (title !== undefined && (next.key_column === title || next.columns.includes(title))) next = { ...next, include: false };
        return next;
    });
    const links = theirs.links.map((t) => {
        const b = base.links.find((l) => l.sheet === t.sheet && l.column === t.column);
        const o = ours.links.find((l) => l.sheet === t.sheet && l.column === t.column);
        return b && o && o.include !== b.include ? { ...t, include: o.include } : t;
    });
    const folder_name = !same(ours.folder_name, base.folder_name) ? ours.folder_name : theirs.folder_name;
    return { ...theirs, lists, entities, links, folder_name };
}

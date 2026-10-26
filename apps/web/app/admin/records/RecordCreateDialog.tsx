import { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkPlus } from 'lucide-react';
import { jsonbKeyForField } from '@imagina-base/shared';

import { getBootData } from '@/lib/boot';
import { draftErrors, fieldDefaultsBySlug } from '@/lib/fieldRules';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    Sheet,
    SheetCloseButton,
    SheetDescription,
    SheetFooter,
    SheetTitle,
} from '@/components/ui/sheet';
import { useCreateRecord } from '@/hooks/useRecords';
import { useCreateFromTemplate, useRecordTemplates } from '@/hooks/useRecordTemplates';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { escapeIntent, leaveField } from '@/lib/escapeGuard';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { RecordFieldsForm } from './RecordFieldsForm';
import { RecordTitleInput } from './RecordTitleInput';
import { titleFieldOf } from '@/lib/recordTitle';
import { describeDate, describePerson, templateSummary } from './templates/templateModel';

interface RecordCreateDialogProps {
    listId: number;
    /**
     * Nombre humano de la lista para el breadcrumb de la barra superior
     * ("{lista} / Nuevo registro"). Opcional para retro-compatibilidad.
     */
    listName?: string;
    fields: FieldEntity[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Valores iniciales por slug para pre-cargar el form al abrir.
     * Lo usa el modo agrupado: "+ Agregar tarea" en el grupo "Hecho"
     * abre el diálogo con estado=hecho ya seteado.
     */
    initialValues?: Record<string, unknown>;
    /**
     * Si viene, el registro se crea como SUBTAREA de este id (v0.1.132).
     * El backend valida que el padre exista, sea de esta lista y de primer
     * nivel.
     */
    parentId?: number | null;
    /**
     * C6 — arrancar con esta plantilla de registro elegida («Nuevo registro ▾
     * → Desde una plantilla»). Se puede cambiar o quitar en el propio alta.
     */
    templateId?: number | null;
}

/**
 * Modal de creación con el MISMO diseño del RecordDetailDrawer (patrón
 * ClickUp): barra superior full-width (breadcrumb + X), contenido con
 * chip "Registro" + form de campos en filas planas con icono por tipo
 * (hairlines, sin caja), y footer Cancelar/Crear. Sin aside de
 * actividad (el registro aún no existe). Geometría algo menor que el
 * drawer: min(900px, 92vw) × max-h 88vh.
 */
export function RecordCreateDialog({
    listId,
    listName,
    fields,
    open,
    onOpenChange,
    initialValues,
    parentId,
    templateId,
}: RecordCreateDialogProps): JSX.Element {
    const create = useCreateRecord(listId);
    const createFrom = useCreateFromTemplate(listId);
    const toast = useToast();
    const templates = useRecordTemplates(open ? listId : undefined, 'record');
    const [tplId, setTplId] = useState<number | null>(null);
    const template = useMemo(() => (templates.data ?? []).find((t) => t.id === tplId) ?? null, [templates.data, tplId]);
    const pending = create.isPending || createFrom.isPending;
    const titleField = titleFieldOf(fields);
    const { reset: resetCreate } = create;
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const seededRef = useRef<Record<string, unknown>>({});

    useEffect(() => {
        if (!open) {
            // Dep en `resetCreate` (estable), NO en `create` (nueva identidad
            // cada render → loop infinito de renders).
            setValues({});
            setError(null);
            setFieldErrors({});
            resetCreate();
        } else {
            // Al abrir con prefill (add-inline de un grupo) sembramos el
            // form. `initialValues` vive en el state del caller — identidad
            // estable mientras el diálogo está abierto, no pisa el tipeo.
            // v0.1.300 — y con los VALORES POR DEFECTO de los campos (fijo, hoy,
            // quien lo crea…): lo que se ve es lo que se va a guardar.
            const seed = { ...fieldDefaultsBySlug(fields, getBootData().user.id), ...(initialValues ?? {}) };
            seededRef.current = seed;
            setValues(seed);
            setTplId(templateId ?? null);
        }
        // `fields` fuera de las deps a propósito: re-sembrar al llegar un
        // campo nuevo pisaría lo que la persona ya escribió.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, resetCreate, initialValues, templateId]);

    // C6 — al elegir una plantilla, sus valores FIJOS se ven puestos en el
    // formulario (y se pueden cambiar); los dinámicos —fechas relativas,
    // personas— los resuelve el servidor al crear y se listan aparte. Lo que la
    // persona ya escribió no se pisa.
    const tplFixedRef = useRef<Record<string, unknown>>({});
    useEffect(() => {
        if (!open) return;
        const bySlugKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f.slug]));
        const fixed: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(template?.content.values ?? {})) {
            const slug = bySlugKey.get(k);
            if (slug && v.mode === 'fixed' && v.value !== null && v.value !== undefined) fixed[slug] = v.value;
        }
        const prevFixed = tplFixedRef.current;
        tplFixedRef.current = fixed;
        setValues((cur) => {
            const next: Record<string, unknown> = { ...cur };
            // Lo que puso la plantilla anterior (y nadie tocó) vuelve a lo sembrado.
            for (const [slug, v] of Object.entries(prevFixed)) {
                if (JSON.stringify(next[slug]) === JSON.stringify(v)) {
                    if (slug in seededRef.current) next[slug] = seededRef.current[slug];
                    else delete next[slug];
                }
            }
            for (const [slug, v] of Object.entries(fixed)) {
                const untouched = next[slug] === undefined || next[slug] === null || next[slug] === '' || JSON.stringify(next[slug]) === JSON.stringify(seededRef.current[slug]);
                if (untouched) next[slug] = v;
            }
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [template?.id, open]);
    /** Lo que la plantilla resuelve al crear (fechas relativas, personas), en lenguaje claro. */
    const dynamicLines = useMemo(() => {
        if (!template) return [];
        const out: string[] = [];
        for (const [k, v] of Object.entries(template.content.values)) {
            const f = fields.find((x) => jsonbKeyForField(x.id) === k);
            if (!f) continue;
            if (v.mode === 'relative_date') out.push(`${f.label}: ${describeDate(v.date, fields)}`);
            else if (v.mode === 'person') out.push(`${f.label}: ${describePerson(v.person, fields)}`);
        }
        return out;
    }, [template, fields]);
    // Lo sembrado al abrir (fijo: un «ahora» recalculado en cada render haría
    // creer que la persona escribió algo).
    const seeded = open ? seededRef.current : {};

    const contentRef = useRef<HTMLDivElement>(null);
    const confirm = useConfirm();
    /** ¿La persona escribió algo (más allá del prefill del grupo)? */
    const typed = Object.entries(values).some(
        ([k, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
            && JSON.stringify(v) !== JSON.stringify(seeded[k])
            && JSON.stringify(v) !== JSON.stringify(tplFixedRef.current[k]),
    );
    const requestClose = async (): Promise<void> => {
        if (typed && !pending) {
            const ok = await confirm({
                title: __('¿Descartar el registro nuevo?'),
                description: __('Lo que escribiste todavía no se guardó.'),
                confirmLabel: __('Descartar'),
                cancelLabel: __('Seguir editando'),
                destructive: true,
            });
            if (!ok) return;
        }
        onOpenChange(false);
    };

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});
        // v0.1.300 — las validaciones del campo (mínimo/máximo, formato, obligatorio
        // si…) se avisan antes de mandar; el servidor las vuelve a exigir.
        const local = draftErrors(fields, values);
        if (Object.keys(local).length > 0) {
            setFieldErrors(local);
            setError(__('Revisa los campos marcados.'));
            return;
        }
        try {
            if (template) {
                // C6 — el registro, sus subtareas y sus checklists en UNA
                // transacción; lo escrito en el alta pisa lo de la plantilla.
                const tplFixed = tplFixedRef.current;
                const typedValues: Record<string, unknown> = {};
                for (const [slug, v] of Object.entries(values)) {
                    // El prefill del grupo (o del vínculo) viaja siempre.
                    if (initialValues && slug in initialValues) {
                        typedValues[slug] = v;
                        continue;
                    }
                    // Lo que puso la plantilla, o un valor por defecto que nadie
                    // tocó, NO viaja: el servidor resuelve la plantilla (y sus
                    // fechas relativas) y aplica los valores por defecto.
                    if (slug in tplFixed && JSON.stringify(tplFixed[slug]) === JSON.stringify(v)) continue;
                    if (slug in seeded && JSON.stringify(seeded[slug]) === JSON.stringify(v)) continue;
                    typedValues[slug] = v;
                }
                const res = await createFrom.mutateAsync({ template_id: template.id, fields: typedValues, parent_id: parentId ?? null });
                if (res.result.warnings?.length) {
                    toast.warning(sprintf(__('Se creó desde «%s», con avisos'), template.name), res.result.warnings.slice(0, 3).join(' '));
                }
            } else {
                await create.mutateAsync(parentId != null ? { values, parentId } : values);
            }
            onOpenChange(false);
        } catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
                setFieldErrors(err.errors);
            } else if (err instanceof Error) {
                setError(err.message);
            }
        }
    };

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (next) onOpenChange(true);
                else void requestClose();
            }}
        >
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-bg-black/40 imcrm-backdrop-blur-sm imcrm-animate-imcrm-fade-in" />
                {/* Centrado por flex (mismo patrón que RecordDetailDrawer):
                 * el transform del scale-in no pelea con el de centrado. */}
                <div className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-items-center imcrm-justify-center">
                    <DialogPrimitive.Content
                        ref={contentRef}
                        // Esc con el foco en un campo sale del campo; con algo
                        // escrito, pregunta antes de descartar el alta.
                        onEscapeKeyDown={(e) => {
                            const active = document.activeElement;
                            const intent = escapeIntent(active, contentRef.current);
                            e.preventDefault();
                            if (intent === 'field') leaveField(active);
                            else if (intent === 'close') void requestClose();
                        }}
                        className={cn(
                            // v0.1.258 — celular: pantalla completa (antes flotaba con
                            // márgenes y el formulario quedaba angosto).
                            'imcrm-flex imcrm-h-[100dvh] imcrm-w-screen imcrm-flex-col imcrm-overflow-hidden',
                            'sm:imcrm-h-auto sm:imcrm-max-h-[88vh] sm:imcrm-w-[min(900px,92vw)] sm:imcrm-rounded-lg sm:imcrm-border',
                            'imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-shadow-imcrm-xl',
                            'imcrm-animate-imcrm-scale-in',
                        )}
                    >
                        {/* ——— Barra superior full-width (patrón ClickUp) ——— */}
                        <div className="imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4">
                            <SheetDescription className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-[13px] imcrm-text-muted-foreground">
                                {listName !== undefined && (
                                    <>
                                        {listName}
                                        <span className="imcrm-mx-1.5 imcrm-text-muted-foreground/80">/</span>
                                    </>
                                )}
                                {__('Nuevo registro')}
                            </SheetDescription>
                            <SheetCloseButton />
                        </div>

                        <form onSubmit={handleSubmit} className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col">
                            {/* ——— Contenido con scroll propio ——— */}
                            <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-4 imcrm-py-4 sm:imcrm-px-6 sm:imcrm-py-5">
                                {/* Chip de tipo de entidad (como el chip "Tarea" de ClickUp). */}
                                <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                    {__('Registro')}
                                </span>

                                {/* C6 — desde una plantilla: valores, subtareas y checklists de una vez. */}
                                {(templates.data ?? []).length > 0 && (
                                    <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2" data-testid="imcrm-create-template">
                                        <label className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                            <BookmarkPlus className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                            <span className="imcrm-font-medium">{__('Plantilla')}</span>
                                            <Select
                                                value={tplId ?? ''}
                                                onChange={(e) => setTplId(e.target.value === '' ? null : Number(e.target.value))}
                                                className="imcrm-h-8 imcrm-w-auto imcrm-min-w-[12rem]"
                                                data-testid="imcrm-create-template-select"
                                            >
                                                <option value="">{__('Sin plantilla')}</option>
                                                {(templates.data ?? []).map((t) => (
                                                    <option key={t.id} value={t.id}>
                                                        {t.name}
                                                    </option>
                                                ))}
                                            </Select>
                                        </label>
                                        {template && (
                                            <div className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-create-template-summary">
                                                <p>{sprintf(__('Trae: %s.'), templateSummary(template))}</p>
                                                {dynamicLines.length > 0 && (
                                                    <ul className="imcrm-mt-0.5 imcrm-list-disc imcrm-pl-4">
                                                        {dynamicLines.map((l) => (
                                                            <li key={l}>{l}</li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* v0.1.136 — el título del alta ya no es un
                                    cartel fijo: se escribe aquí y va al campo
                                    primario, igual que en la ficha. */}
                                <SheetTitle asChild>
                                    <div className="imcrm-mt-2">
                                        <RecordTitleInput
                                            field={titleField}
                                            value={titleField ? values[titleField.slug] : undefined}
                                            onChange={(next) =>
                                                titleField
                                                && setValues((v) => ({ ...v, [titleField.slug]: next }))
                                            }
                                            fallback={__('Nuevo registro')}
                                            editable
                                            autoFocus
                                            className="imcrm--ml-1.5"
                                        />
                                        {titleField && fieldErrors[titleField.slug] !== undefined && (
                                            <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive">{fieldErrors[titleField.slug]}</p>
                                        )}
                                    </div>
                                </SheetTitle>

                                {/* Mismo layout de filas planas del drawer: icono
                                 * del tipo + label a la izquierda, editor a la
                                 * derecha, separadas solo por hairlines. */}
                                <div className="imcrm-mt-4">
                                    <RecordFieldsForm
                                        listId={listId}
                                        fields={fields}
                                        values={values}
                                        onChange={setValues}
                                        fieldErrors={fieldErrors}
                                        density="compact"
                                        showTypeIcon
                                        // El título grande de arriba YA es ese campo: no se repite.
                                        hiddenSlugs={titleField ? [titleField.slug] : undefined}
                                    />
                                </div>

                                {error !== null && (
                                    <div className="imcrm-mt-4 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                        {error}
                                    </div>
                                )}
                            </div>

                            <SheetFooter>
                                <Button type="button" variant="outline" onClick={() => void requestClose()}>
                                    {__('Cancelar')}
                                </Button>
                                <Button type="submit" disabled={pending} data-testid="imcrm-create-submit">
                                    {pending ? __('Creando…') : template ? __('Crear desde la plantilla') : __('Crear registro')}
                                </Button>
                            </SheetFooter>
                        </form>
                    </DialogPrimitive.Content>
                </div>
            </DialogPrimitive.Portal>
        </Sheet>
    );
}

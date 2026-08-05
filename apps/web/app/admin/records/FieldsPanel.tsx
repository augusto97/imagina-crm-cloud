import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Search, Settings2 } from 'lucide-react';

import { FieldConfigEditor } from '@/admin/lists/FieldConfigEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useCreateField, useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { FIELD_TYPE_OPTIONS, POPULAR_FIELD_TYPES } from '@/lib/fieldTypeCatalog';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity, FieldTypeSlug } from '@/types/field';

import { FieldTypePreview } from './FieldTypePreview';

/**
 * Panel de campos (v0.1.160) — el alta de columnas estilo ClickUp.
 *
 * Reemplaza al paso "catálogo" del modal: en un panel lateral entra el
 * buscador, los tipos agrupados en **Populares** y **Todos**, y —lo que
 * realmente resuelve la duda al elegir— una **vista previa** de cómo se va
 * a ver la celda, con su descripción, al pasar el mouse por cada tipo.
 *
 * La pestaña **"Copiar de otra lista"** es nuestro equivalente honesto al
 * "Agregar existente" de ClickUp: allá un campo es una entidad del
 * workspace que vive en varias listas; acá un campo pertenece a UNA lista
 * (`fields.list_id`), así que compartir la misma entidad sería otro modelo
 * de datos. Copiar la definición (tipo + configuración + opciones) da el
 * resultado que la gente busca sin mentir sobre lo que hay debajo.
 *
 * El engranaje abre el **administrador de campos** (Ajustes → Campos), que
 * es donde viven el slug, el índice, la unicidad y la conversión de tipo.
 */
interface FieldsPanelProps {
    listId: number;
    listSlug: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function FieldsPanel({ listId, listSlug, open, onOpenChange }: FieldsPanelProps): JSX.Element {
    const create = useCreateField(listId);
    const navigate = useNavigate();

    const [tab, setTab] = useState<'new' | 'copy'>('new');
    const [search, setSearch] = useState('');
    const [type, setType] = useState<FieldTypeSlug | ''>('');
    const [label, setLabel] = useState('');
    const [isRequired, setIsRequired] = useState(false);
    const [config, setConfig] = useState<Record<string, unknown>>({});
    const [error, setError] = useState<string | null>(null);
    /** Tipo bajo el mouse — su vista previa se muestra al costado. */
    const [hovered, setHovered] = useState<FieldTypeSlug | null>(null);

    useEffect(() => {
        if (!open) return;
        setTab('new');
        setSearch('');
        setType('');
        setLabel('');
        setIsRequired(false);
        setConfig({});
        setError(null);
    }, [open]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (q === '') return FIELD_TYPE_OPTIONS;
        return FIELD_TYPE_OPTIONS.filter(
            (o) =>
                o.label.toLowerCase().includes(q)
                || o.description.toLowerCase().includes(q)
                || o.type.includes(q),
        );
    }, [search]);

    const popular = useMemo(
        () => filtered.filter((o) => POPULAR_FIELD_TYPES.includes(o.type)),
        [filtered],
    );

    const pick = (next: FieldTypeSlug, presetLabel = '', presetConfig: Record<string, unknown> = {}): void => {
        setType(next);
        setConfig(presetConfig);
        setLabel(presetLabel);
        setError(null);
    };

    const submit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        if (type === '' || label.trim() === '') return;
        setError(null);
        try {
            await create.mutateAsync({ label: label.trim(), type, is_required: isRequired, config });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const selected = type !== '' ? FIELD_TYPE_OPTIONS.find((o) => o.type === type) : undefined;
    const SelectedIcon = type !== '' ? fieldTypeIcon(type) : null;
    const hoveredOption = hovered !== null ? FIELD_TYPE_OPTIONS.find((o) => o.type === hovered) : undefined;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="imcrm-w-full sm:imcrm-max-w-md">
                <SheetHeader className="imcrm-flex imcrm-flex-row imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <SheetTitle>{__('Campos')}</SheetTitle>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            title={__('Abrir el administrador de campos')}
                            aria-label={__('Abrir el administrador de campos')}
                            onClick={() => {
                                onOpenChange(false);
                                navigate(`/lists/${listSlug}/edit?s=campos`);
                            }}
                        >
                            <Settings2 className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                        <SheetCloseButton />
                    </div>
                </SheetHeader>

                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {type === '' ? (
                        <>
                            <div className="imcrm-relative">
                                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2.5 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={__('Buscar campos')}
                                    className="imcrm-pl-8"
                                    autoFocus
                                />
                            </div>

                            <div className="imcrm-flex imcrm-gap-4 imcrm-border-b imcrm-border-border">
                                {([
                                    ['new', __('Crear nuevo')],
                                    ['copy', __('Copiar de otra lista')],
                                ] as const).map(([id, text]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setTab(id)}
                                        className={cn(
                                            'imcrm--mb-px imcrm-border-b-2 imcrm-px-0.5 imcrm-pb-1.5 imcrm-text-sm',
                                            tab === id
                                                ? 'imcrm-border-primary imcrm-font-medium imcrm-text-foreground'
                                                : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                        )}
                                    >
                                        {text}
                                    </button>
                                ))}
                            </div>

                            {tab === 'new' ? (
                                <>
                                    {popular.length > 0 && (
                                        <TypeSection
                                            title={__('Populares')}
                                            options={popular}
                                            onPick={pick}
                                            onHover={setHovered}
                                        />
                                    )}
                                    {filtered.length === 0 ? (
                                        <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                                            {__('Ningún tipo coincide con la búsqueda.')}
                                        </p>
                                    ) : (
                                        <TypeSection
                                            title={__('Todos')}
                                            options={filtered}
                                            onPick={pick}
                                            onHover={setHovered}
                                        />
                                    )}
                                </>
                            ) : (
                                <CopyFromList currentListId={listId} search={search} onPick={pick} />
                            )}

                            {/* v0.1.163 — UNA sola vista previa, fija al pie
                                del panel. En v0.1.161 vivía en un popover POR
                                ÍTEM y el mismo tipo aparece en "Populares" y
                                en "Todos": un solo `hovered` abría las DOS a
                                la vez (reporte del usuario). Como región del
                                panel no puede duplicarse ni quedar recortada. */}
                            {tab === 'new' && hoveredOption !== undefined && (
                                <div className="imcrm-sticky imcrm-bottom-0 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-bg-card imcrm-pb-1 imcrm-pt-3">
                                    <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                        {__('Vista previa')}
                                    </p>
                                    <FieldTypePreview type={hoveredOption.type} />
                                    <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                                        <strong className="imcrm-text-foreground">{hoveredOption.label}</strong>
                                        {' · '}
                                        {hoveredOption.description}
                                    </p>
                                </div>
                            )}
                        </>
                    ) : (
                        <form onSubmit={submit} className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="imcrm-gap-1.5"
                                    onClick={() => setType('')}
                                >
                                    <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Volver')}
                                </Button>
                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-inset imcrm-ring-border">
                                    {SelectedIcon !== null && <SelectedIcon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                                    {selected?.label ?? type}
                                </span>
                            </div>

                            <FieldTypePreview type={type} />

                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="fields-panel-name">{__('Nombre')}</Label>
                                <Input
                                    id="fields-panel-name"
                                    value={label}
                                    onChange={(e) => setLabel(e.target.value)}
                                    placeholder={__('Ej. Estado')}
                                    autoFocus
                                />
                            </div>

                            <FieldConfigEditor
                                type={type}
                                config={config}
                                onChange={setConfig}
                                listId={listId}
                            />

                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={isRequired}
                                    onChange={(e) => setIsRequired(e.target.checked)}
                                />
                                {__('Obligatorio')}
                            </label>

                            {error !== null && (
                                <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                    {error}
                                </div>
                            )}

                            <Button type="submit" disabled={label.trim() === '' || create.isPending}>
                                {create.isPending ? __('Creando…') : __('Crear campo')}
                            </Button>
                        </form>
                    )}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

type PickFn = (type: FieldTypeSlug, label?: string, config?: Record<string, unknown>) => void;

function TypeSection({
    title,
    options,
    onPick,
    onHover,
}: {
    title: string;
    options: typeof FIELD_TYPE_OPTIONS;
    onPick: PickFn;
    onHover: (type: FieldTypeSlug | null) => void;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
            <p className="imcrm-px-1 imcrm-pb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {title}
            </p>
            {options.map((opt) => {
                const Icon = fieldTypeIcon(opt.type);
                return (
                    <button
                        key={opt.type}
                        type="button"
                        onMouseEnter={() => onHover(opt.type)}
                        onMouseLeave={() => onHover(null)}
                        onFocus={() => onHover(opt.type)}
                        onBlur={() => onHover(null)}
                        onClick={() => onPick(opt.type)}
                        className="imcrm-group/type imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left hover:imcrm-bg-accent focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40"
                    >
                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm">{opt.label}</span>
                        <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground imcrm-opacity-0 group-hover/type:imcrm-opacity-100">
                            {__('Crear')}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * "Copiar de otra lista": lista los campos de las demás listas y crea uno
 * NUEVO con la misma definición. No comparte la entidad (ver el comentario
 * de cabecera): copia tipo, configuración y opciones.
 */
function CopyFromList({
    currentListId,
    search,
    onPick,
}: {
    currentListId: number;
    search: string;
    onPick: PickFn;
}): JSX.Element {
    const lists = useLists();
    const others = (lists.data ?? []).filter((l) => l.id !== currentListId);
    const [sourceId, setSourceId] = useState<number | null>(null);
    const source = sourceId ?? others[0]?.id ?? null;
    const fields = useFields(source ?? undefined);

    const q = search.trim().toLowerCase();
    const rows = (fields.data ?? []).filter(
        (f) => q === '' || f.label.toLowerCase().includes(q),
    );

    if (others.length === 0) {
        return (
            <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                {__('No hay otras listas de donde copiar campos.')}
            </p>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {others.map((l) => (
                    <button
                        key={l.id}
                        type="button"
                        onClick={() => setSourceId(l.id)}
                        className={cn(
                            'imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1 imcrm-text-xs',
                            source === l.id
                                ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary'
                                : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent',
                        )}
                    >
                        {l.name}
                    </button>
                ))}
            </div>

            {rows.length === 0 ? (
                <p className="imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Esa lista no tiene campos que coincidan.')}
                </p>
            ) : (
                rows.map((f: FieldEntity) => {
                    const Icon = fieldTypeIcon(f.type);
                    return (
                        <button
                            key={f.id}
                            type="button"
                            onClick={() => onPick(f.type, f.label, f.config ?? {})}
                            className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left hover:imcrm-bg-accent"
                            title={sprintf(
                                /* translators: %s: nombre del campo */
                                __('Copiar la definición de "%s"'),
                                f.label,
                            )}
                        >
                            <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm">{f.label}</span>
                            <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Copiar')}
                            </span>
                        </button>
                    );
                })
            )}
        </div>
    );
}

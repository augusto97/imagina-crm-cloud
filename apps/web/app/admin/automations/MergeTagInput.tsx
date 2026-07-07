import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Search, Sparkles } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

interface MergeTagInputProps {
    value: string;
    onChange: (next: string) => void;
    fields: FieldEntity[];
    /** rows > 0 → renderea como Textarea. */
    rows?: number;
    placeholder?: string;
    /** Botón "+ Agregar firma" debajo (solo en body de email). */
    showSignatureButton?: boolean;
    /** Llamado cuando el usuario click "+ Agregar firma". El padre
     * resuelve la firma async (vía useEmailSignature) y la inserta
     * llamando al ref expuesto. Si no se pasa, el botón no se muestra. */
    onInsertSignature?: () => string | Promise<string>;
    /** Otros HTML props que el input/textarea acepta. */
    className?: string;
    'aria-label'?: string;
}

/**
 * Input/Textarea con un picker visual de merge tags estilo ClickUp.
 *
 * - Chips abajo con los primeros ~5 campos (slug = etiqueta) — click
 *   inserta `{{slug}}` en la posición del cursor.
 * - Botón "+ N" abre un popover searchable con TODOS los tags
 *   organizados en secciones: "Campos" (slugs de la lista) y
 *   "Sistema" (`record.id`, timestamps, `date.now`, `user.email`,
 *   `signature`).
 * - Botón "+ Agregar firma" opcional (solo body de email) — inserta
 *   la firma del usuario en HTML.
 *
 * El cursor se preserva: al insertar, posicionamos el caret al final
 * del tag insertado.
 */
export function MergeTagInput({
    value,
    onChange,
    fields,
    rows,
    placeholder,
    showSignatureButton = false,
    onInsertSignature,
    className,
    ...rest
}: MergeTagInputProps): JSX.Element {
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const [pendingSelection, setPendingSelection] = useState<number | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);

    // Reaplicar la selección DESPUÉS del re-render que sigue al onChange
    // — si la pones síncrona, React resetea el caret al final.
    useEffect(() => {
        if (pendingSelection !== null && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(pendingSelection, pendingSelection);
            setPendingSelection(null);
        }
    }, [pendingSelection, value]);

    const insert = (text: string): void => {
        const el = inputRef.current;
        const start = el?.selectionStart ?? value.length;
        const end = el?.selectionEnd ?? start;
        const next = value.slice(0, start) + text + value.slice(end);
        onChange(next);
        setPendingSelection(start + text.length);
    };

    const insertTag = (tag: string): void => {
        insert(`{{${tag}}}`);
    };

    const handleSignatureClick = async (): Promise<void> => {
        if (!onInsertSignature) return;
        const sig = await onInsertSignature();
        if (typeof sig === 'string' && sig !== '') {
            insert((value.endsWith('\n') ? '' : '\n\n') + sig);
        }
    };

    const filterableFields = fields.filter((f) => f.type !== 'relation');
    const inlineCount = 5; // chips visibles abajo
    const inlineFields = filterableFields.slice(0, inlineCount);
    const overflow = filterableFields.length - inlineCount;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            {rows && rows > 0 ? (
                <Textarea
                    ref={inputRef as React.Ref<HTMLTextAreaElement>}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    rows={rows}
                    placeholder={placeholder}
                    className={className}
                    {...rest}
                />
            ) : (
                <Input
                    ref={inputRef as React.Ref<HTMLInputElement>}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={className}
                    {...rest}
                />
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                <span className="imcrm-text-[10px] imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {__('Campos')}
                </span>
                {inlineFields.map((f) => (
                    <TagChip key={f.id} label={f.label} onClick={() => insertTag(f.slug)} />
                ))}
                {overflow > 0 || filterableFields.length === 0 ? (
                    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card/50 imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-border-primary/40 hover:imcrm-text-foreground"
                            >
                                <Plus className="imcrm-h-3 imcrm-w-3" />
                                {overflow > 0 ? `+${overflow}` : __('Insertar variable')}
                                <ChevronDown className="imcrm-h-3 imcrm-w-3" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="imcrm-w-[360px] imcrm-p-0" align="start">
                            <MergeTagPicker
                                fields={filterableFields}
                                onPick={(tag) => {
                                    insertTag(tag);
                                    setPickerOpen(false);
                                }}
                            />
                        </PopoverContent>
                    </Popover>
                ) : null}

                {showSignatureButton && onInsertSignature && (
                    <button
                        type="button"
                        onClick={() => void handleSignatureClick()}
                        className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-primary hover:imcrm-bg-primary/10"
                    >
                        <Sparkles className="imcrm-h-3 imcrm-w-3" />
                        {__('Agregar firma')}
                    </button>
                )}
            </div>
        </div>
    );
}

function TagChip({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className="imcrm-rounded-md imcrm-border imcrm-border-primary/30 imcrm-bg-primary/10 imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary hover:imcrm-bg-primary/20"
        >
            {label}
        </button>
    );
}

interface MergeTagPickerProps {
    fields: FieldEntity[];
    onPick: (tag: string) => void;
}

function MergeTagPicker({ fields, onPick }: MergeTagPickerProps): JSX.Element {
    const [search, setSearch] = useState('');

    const matches = (s: string): boolean =>
        search === '' || s.toLowerCase().includes(search.toLowerCase());

    const visibleFields = fields.filter((f) => matches(f.label) || matches(f.slug));

    const systemTags: Array<{ tag: string; label: string; hint?: string }> = [
        { tag: 'record.id', label: __('ID del registro'), hint: '#42' },
        { tag: 'record.created_at', label: __('Creado'), hint: '2026-04-29 10:30' },
        { tag: 'record.updated_at', label: __('Actualizado'), hint: '2026-04-29 10:30' },
        { tag: 'record.created_by', label: __('ID del autor') },
        { tag: 'date.now', label: __('Fecha y hora ahora'), hint: 'ISO 8601' },
        { tag: 'date.today', label: __('Fecha de hoy'), hint: 'YYYY-MM-DD' },
        { tag: 'user.display_name', label: __('Nombre del autor') },
        { tag: 'user.email', label: __('Email del autor') },
        { tag: 'signature', label: __('Firma del autor'), hint: __('De la firma guardada') },
    ];
    const visibleSystem = systemTags.filter((t) => matches(t.label) || matches(t.tag));

    return (
        <div className="imcrm-flex imcrm-flex-col">
            <div className="imcrm-relative imcrm-border-b imcrm-border-border">
                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2 imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={__('Escribe para buscar')}
                    className="imcrm-h-9 imcrm-w-full imcrm-bg-transparent imcrm-pl-8 imcrm-pr-2 imcrm-text-sm focus-visible:imcrm-outline-none"
                    autoFocus
                />
            </div>

            <div className="imcrm-max-h-[300px] imcrm-overflow-y-auto imcrm-p-2">
                {visibleFields.length > 0 && (
                    <Section
                        title={__('Campos')}
                        items={visibleFields.map((f) => ({
                            tag: f.slug,
                            label: f.label,
                            hint: f.slug,
                        }))}
                        onPick={onPick}
                    />
                )}
                {visibleSystem.length > 0 && (
                    <Section
                        title={__('Sistema')}
                        items={visibleSystem}
                        onPick={onPick}
                    />
                )}
                {visibleFields.length === 0 && visibleSystem.length === 0 && (
                    <p className="imcrm-px-2 imcrm-py-3 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                        {__('No hay variables que coincidan.')}
                    </p>
                )}
            </div>
        </div>
    );
}

interface SectionProps {
    title: string;
    items: Array<{ tag: string; label: string; hint?: string }>;
    onPick: (tag: string) => void;
}

function Section({ title, items, onPick }: SectionProps): JSX.Element {
    return (
        <div className="imcrm-mb-2 imcrm-flex imcrm-flex-col imcrm-gap-1">
            <div className="imcrm-px-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {title}
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {items.map((it) => (
                    <button
                        key={it.tag}
                        type="button"
                        onClick={() => onPick(it.tag)}
                        title={it.hint}
                        className={cn(
                            'imcrm-rounded-md imcrm-border imcrm-border-primary/30 imcrm-bg-primary/10 imcrm-px-2 imcrm-py-1 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary',
                            'hover:imcrm-bg-primary/20',
                        )}
                    >
                        {it.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

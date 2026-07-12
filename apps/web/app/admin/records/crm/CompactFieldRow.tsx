import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { OptionPicker } from '@/components/ui/option-picker';
import { Textarea } from '@/components/ui/textarea';
import { UserPicker } from '@/components/ui/user-picker';
import { FileFieldControl } from '@/admin/records/RecordFieldsForm';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { FieldValueDisplay } from './FieldValueDisplay';

interface CompactFieldRowProps {
    field: FieldEntity;
    /** Necesario para que OptionPicker pueda crear opciones inline. */
    listId: number | string;
    value: unknown;
    onChange: (value: unknown) => void;
    error?: string;
    /**
     * Muestra el icono lucide del TIPO de campo junto al label (estilo
     * ClickUp). Opt-in para no alterar las superficies existentes
     * (layout CRM) que ya usan esta fila sin icono.
     */
    showTypeIcon?: boolean;
}

/**
 * Fila densa label-izquierda / valor-derecha con edit on-click — estilo
 * Linear / Notion. En modo lectura ocupa ~32-40px verticales. En modo
 * edición se expande para mostrar el input/textarea apropiado al tipo.
 *
 * No hace POST: usa el `onChange` del padre, que acumula cambios y
 * dispara el save vía el botón "Guardar" del header (mismo flujo que
 * `RecordFieldsForm`).
 *
 * Tipos con UI compleja (select, multi_select, checkbox) editan inline
 * sin necesidad de "modo edit" — el control vive permanentemente
 * compacto en la derecha.
 */
export function CompactFieldRow({
    field,
    listId,
    value,
    onChange,
    error,
    showTypeIcon = false,
}: CompactFieldRowProps): JSX.Element {
    const [editing, setEditing] = useState(false);
    const TypeIcon = fieldTypeIcon(field.type);

    // Tipos que tienen control inline siempre visible (no necesitan
    // "click para editar"). Para user incluimos el UserPicker que
    // tiene su propio popover de búsqueda — sería raro abrirlo solo
    // tras click extra cuando ya es interactivo.
    const isInlineControl =
        field.type === 'checkbox' ||
        field.type === 'select' ||
        field.type === 'multi_select' ||
        field.type === 'user';

    // Tipos read-only (computed): nunca editables.
    const isReadOnly = field.type === 'computed';

    return (
        <div
            className={cn(
                'imcrm-group imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-py-2 imcrm-px-3 imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0',
                'hover:imcrm-bg-accent/30 imcrm-transition-colors',
                editing && 'imcrm-bg-accent/20',
            )}
        >
            <label
                htmlFor={`field-${field.id}`}
                className={cn(
                    'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-pt-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground',
                    showTypeIcon ? 'imcrm-w-[148px]' : 'imcrm-w-[120px]',
                )}
            >
                {showTypeIcon && (
                    <TypeIcon
                        className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground/70"
                        aria-hidden
                    />
                )}
                <span className="imcrm-truncate">{field.label}</span>
                {field.is_required && <span className="imcrm-text-destructive">*</span>}
            </label>

            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                {isInlineControl ? (
                    <InlineControl field={field} listId={listId} value={value} onChange={onChange} />
                ) : isReadOnly ? (
                    <div className="imcrm-min-h-[24px] imcrm-py-0.5 imcrm-text-sm">
                        <FieldValueDisplay field={field} value={value} />
                    </div>
                ) : editing ? (
                    <EditingControl
                        field={field}
                        value={value}
                        onChange={onChange}
                        onBlur={() => setEditing(false)}
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className={cn(
                            'imcrm-inline-flex imcrm-min-h-[24px] imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded imcrm-py-0.5 imcrm-text-left imcrm-text-sm',
                            'imcrm-text-foreground',
                        )}
                    >
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                            <FieldValueDisplay field={field} value={value} />
                        </span>
                        <Pencil
                            className={cn(
                                'imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground',
                                'imcrm-opacity-0 group-hover:imcrm-opacity-60 imcrm-transition-opacity',
                            )}
                            aria-hidden
                        />
                    </button>
                )}
                {error !== undefined && (
                    <span className="imcrm-text-xs imcrm-text-destructive">{error}</span>
                )}
            </div>
        </div>
    );
}

// ─── Edit-mode controls (click para activar) ──────────────────────────

function EditingControl({
    field,
    value,
    onChange,
    onBlur,
}: {
    field: FieldEntity;
    value: unknown;
    onChange: (v: unknown) => void;
    onBlur: () => void;
}): JSX.Element {
    const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    useEffect(() => {
        ref.current?.focus();
        if (ref.current instanceof HTMLInputElement) {
            ref.current.select();
        }
    }, []);

    const handleKey = (e: React.KeyboardEvent): void => {
        if (e.key === 'Escape' || (e.key === 'Enter' && field.type !== 'long_text')) {
            e.preventDefault();
            onBlur();
        }
    };

    const id = `field-${field.id}`;

    switch (field.type) {
        case 'long_text':
            return (
                <Textarea
                    id={id}
                    ref={ref as React.Ref<HTMLTextAreaElement>}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    onKeyDown={handleKey}
                    rows={4}
                    className="imcrm-text-sm"
                />
            );
        case 'date':
            return (
                <Input
                    id={id}
                    ref={ref as React.Ref<HTMLInputElement>}
                    type="date"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value || null)}
                    onBlur={onBlur}
                    onKeyDown={handleKey}
                    className="imcrm-h-8 imcrm-text-sm"
                />
            );
        case 'datetime':
            return (
                <Input
                    id={id}
                    ref={ref as React.Ref<HTMLInputElement>}
                    type="datetime-local"
                    value={typeof value === 'string' ? value.replace(' ', 'T').slice(0, 16) : ''}
                    onChange={(e) => onChange(e.target.value || null)}
                    onBlur={onBlur}
                    onKeyDown={handleKey}
                    className="imcrm-h-8 imcrm-text-sm"
                />
            );
        case 'number':
        case 'currency':
            return (
                <Input
                    id={id}
                    ref={ref as React.Ref<HTMLInputElement>}
                    type="number"
                    step="any"
                    value={value === undefined || value === null ? '' : String(value)}
                    onChange={(e) =>
                        onChange(e.target.value === '' ? null : Number(e.target.value))
                    }
                    onBlur={onBlur}
                    onKeyDown={handleKey}
                    className="imcrm-h-8 imcrm-text-sm imcrm-tabular-nums"
                />
            );
        case 'email':
            return (
                <Input
                    id={id}
                    ref={ref as React.Ref<HTMLInputElement>}
                    type="email"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    onKeyDown={handleKey}
                    className="imcrm-h-8 imcrm-text-sm"
                />
            );
        case 'url':
            return (
                <Input
                    id={id}
                    ref={ref as React.Ref<HTMLInputElement>}
                    type="url"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    onKeyDown={handleKey}
                    className="imcrm-h-8 imcrm-text-sm"
                />
            );
        case 'file':
            // Upload real (ADR-S16) — mismo control que el form completo.
            return <FileFieldControl id={id} value={value} onChange={onChange} />;
        case 'relation': {
            const current = Array.isArray(value)
                ? value.join(', ')
                : typeof value === 'string'
                    ? value
                    : '';
            return (
                <Input
                    id={id}
                    ref={ref as React.Ref<HTMLInputElement>}
                    value={current}
                    onChange={(e) => {
                        const ids = e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .map(Number)
                            .filter((n) => !Number.isNaN(n));
                        onChange(ids);
                    }}
                    onBlur={onBlur}
                    onKeyDown={handleKey}
                    placeholder={__('IDs separados por coma')}
                    className="imcrm-h-8 imcrm-text-sm"
                />
            );
        }
        default:
            return (
                <Input
                    id={id}
                    ref={ref as React.Ref<HTMLInputElement>}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    onKeyDown={handleKey}
                    className="imcrm-h-8 imcrm-text-sm"
                />
            );
    }
}

// ─── Inline controls (siempre visibles, no necesitan click) ────────────

function InlineControl({
    field,
    listId,
    value,
    onChange,
}: {
    field: FieldEntity;
    listId: number | string;
    value: unknown;
    onChange: (v: unknown) => void;
}): JSX.Element {
    const id = `field-${field.id}`;

    if (field.type === 'user') {
        const userId = typeof value === 'number' ? value : value ? Number(value) : null;
        return (
            <UserPicker
                value={userId}
                onChange={(next) => onChange(next)}
                compact
                showAssignMe
            />
        );
    }

    if (field.type === 'checkbox') {
        return (
            <label
                htmlFor={id}
                className="imcrm-inline-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-py-0.5"
            >
                <input
                    id={id}
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => onChange(e.target.checked)}
                    className="imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border-input"
                />
                <span className="imcrm-text-sm imcrm-text-muted-foreground">
                    {value ? __('Sí') : __('No')}
                </span>
            </label>
        );
    }

    if (field.type === 'select') {
        return (
            <OptionPicker
                field={field}
                listId={listId}
                mode="single"
                value={typeof value === 'string' ? value : null}
                onChange={(v) => onChange(v ?? null)}
                compact
            />
        );
    }

    if (field.type === 'multi_select') {
        return (
            <OptionPicker
                field={field}
                listId={listId}
                mode="multi"
                value={Array.isArray(value) ? value.map(String) : []}
                onChange={(v) => onChange(Array.isArray(v) ? v : [])}
                compact
            />
        );
    }

    return <span>{String(value)}</span>;
}

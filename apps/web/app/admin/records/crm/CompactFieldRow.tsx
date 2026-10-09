import { useEffect, useRef, useState } from 'react';
import { AiFieldValue } from '../AiFieldValue';
import { Lock, Pencil } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { RelationPicker } from '@/components/fields/RelationPicker';
import { OptionPicker } from '@/components/ui/option-picker';
import { Textarea } from '@/components/ui/textarea';
import { UserPicker } from '@/components/ui/user-picker';
import { DateCellEditor } from '@/admin/records/DateCellEditor';
import { FileFieldControl } from '@/admin/records/RecordFieldsForm';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { DurationControl } from '@/components/fields/DurationControl';
import { PhoneControl } from '@/components/fields/PhoneControl';
import { RatingControl, type RatingIcon } from '@/components/fields/RatingControl';

import { isDerivedFieldType } from '@/lib/fieldTypeCatalog';

import { FieldValueDisplay } from './FieldValueDisplay';

interface CompactFieldRowProps {
    field: FieldEntity;
    /** Necesario para que OptionPicker pueda crear opciones inline. */
    listId: number | string;
    /**
     * Record al que pertenece la fila (si ya existe): habilita la
     * sección "Recurrente" del date picker. En creación va undefined.
     */
    recordId?: number;
    value: unknown;
    onChange: (value: unknown) => void;
    error?: string;
    /**
     * Muestra el icono lucide del TIPO de campo junto al label (estilo
     * ClickUp). Opt-in para no alterar las superficies existentes
     * (layout CRM) que ya usan esta fila sin icono.
     */
    showTypeIcon?: boolean;
    /**
     * v0.1.213 — En una lista de tienda, por qué este campo no se puede
     * cambiar acá (se muestra de sólo lectura, con el motivo). null = libre.
     */
    lockedReason?: string | null;
    /** v0.1.233 — "Crear" opciones nuevas desde el selector (el portal no puede). */
    allowCreateOptions?: boolean;
    /**
     * v0.1.234 — `property`: la fila de las fichas diseñadas. La etiqueta y el
     * valor se acomodan al ancho REAL de la tarjeta (container query): al lado
     * con lugar, uno arriba del otro en una columna angosta — antes la
     * etiqueta fija de 200px dejaba al valor sin lugar y no se veía. Los
     * selectores van planos (sin caja), como en la tabla.
     */
    variant?: 'row' | 'property';
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
    recordId,
    value,
    onChange,
    error,
    showTypeIcon = false,
    lockedReason = null,
    allowCreateOptions = true,
    variant = 'row',
}: CompactFieldRowProps): JSX.Element {
    const [editing, setEditing] = useState(false);
    const property = variant === 'property';
    const TypeIcon = fieldTypeIcon(field.type);

    // Tipos que tienen control inline siempre visible (no necesitan
    // "click para editar"). Para user incluimos el UserPicker que
    // tiene su propio popover de búsqueda — sería raro abrirlo solo
    // tras click extra cuando ya es interactivo.
    const isInlineControl =
        field.type === 'checkbox' ||
        field.type === 'select' ||
        field.type === 'multi_select' ||
        field.type === 'user' ||
        // Fechas: el DateCellEditor (calendario + recurrencia, el mismo
        // de la tabla) se abre con UN click — sin modo edición nativo.
        field.type === 'date' ||
        field.type === 'datetime' ||
        // v0.1.158 — la calificación se pone clickeando la estrella.
        field.type === 'rating' ||
        // v0.1.209 — relación: selector de registros con buscador.
        field.type === 'relation';

    // Tipos read-only (computed / lookup / rollup): nunca editables. Y en
    // una lista de tienda, lo que se edita en WooCommerce (v0.1.213).
    const isReadOnly = isDerivedFieldType(field.type) || lockedReason !== null;

    const control = field.type === 'ai' && lockedReason === null ? (
        <AiFieldValue field={field} value={value} listId={listId} recordId={recordId} />
    ) : isReadOnly ? (
        <div
            className="imcrm-flex imcrm-min-h-[24px] imcrm-items-center imcrm-gap-1.5 imcrm-py-0.5 imcrm-text-sm"
            title={lockedReason ?? undefined}
            data-testid={lockedReason ? 'imcrm-field-locked' : undefined}
        >
            <span className="imcrm-min-w-0 imcrm-flex-1">
                <FieldValueDisplay field={field} value={value} />
            </span>
            {lockedReason && <Lock className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground/60" aria-label={lockedReason} />}
        </div>
    ) : isInlineControl ? (
        <InlineControl field={field} listId={listId} recordId={recordId} value={value} onChange={onChange} allowCreate={allowCreateOptions} flat={property} />
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
            <span
                className={cn(
                    'imcrm-min-w-0 imcrm-flex-1',
                    // Un texto largo se lee entero en la ficha; el resto, en una línea.
                    property && field.type === 'long_text' ? 'imcrm-whitespace-pre-wrap imcrm-break-words' : 'imcrm-truncate',
                )}
            >
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
    );

    if (property) {
        return (
            <div className="imcrm-prop" data-prop={field.slug}>
                <div className={cn('imcrm-prop-row imcrm-group imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-transition-colors hover:imcrm-bg-accent/50', editing && 'imcrm-bg-accent/40')}>
                    <label
                        htmlFor={`field-${field.id}`}
                        className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-pt-[3px] imcrm-text-xs imcrm-text-muted-foreground"
                        title={field.label}
                    >
                        <TypeIcon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground/70" aria-hidden />
                        <span className="imcrm-truncate">{field.label}</span>
                        {field.is_required && <span className="imcrm-text-destructive">*</span>}
                    </label>
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                        {control}
                        {error !== undefined && <span className="imcrm-text-xs imcrm-text-destructive">{error}</span>}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={cn(
                // v0.1.258 — bajo 640px la etiqueta va ARRIBA del valor: al
                // lado le dejaba al control ~160px y los selects y el
                // selector de persona se partían en dos renglones.
                'imcrm-group imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-py-2 imcrm-px-3 imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0',
                'sm:imcrm-flex-row sm:imcrm-items-start sm:imcrm-gap-3',
                'hover:imcrm-bg-accent/30 imcrm-transition-colors',
                editing && 'imcrm-bg-accent/20',
            )}
        >
            <label
                htmlFor={`field-${field.id}`}
                className={cn(
                    'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground',
                    // Con icono de tipo (drawer/página, estilo ClickUp) el
                    // label ocupa ~200px; sin icono (layout CRM) queda 120px.
                    // v0.1.252 — en el celular el label se achica para que el
                    // control tenga lugar (antes los selects se aplastaban).
                    showTypeIcon ? 'imcrm-w-full sm:imcrm-w-[200px]' : 'imcrm-w-full sm:imcrm-w-[120px]',
                    'imcrm-pt-0 sm:imcrm-pt-1',
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
                {control}
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
        // date/datetime no llegan acá: son inline controls (DateCellEditor).
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
        case 'percent':
            return (
                <Input
                    id={id}
                    ref={ref as React.Ref<HTMLInputElement>}
                    type="number"
                    min={0}
                    max={100}
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
        case 'duration':
            return (
                <DurationControl
                    ref={ref as React.Ref<HTMLInputElement>}
                    value={typeof value === 'number' ? value : null}
                    format={(field.config as { format?: 'hm' | 'clock' }).format}
                    onCommit={(next) => {
                        onChange(next);
                        onBlur();
                    }}
                    onCancel={onBlur}
                    className="imcrm-h-8"
                />
            );
        case 'phone':
            return (
                <PhoneControl
                    ref={ref as React.Ref<HTMLInputElement>}
                    value={typeof value === 'string' ? value : null}
                    config={field.config}
                    onChange={onChange}
                    onBlur={onBlur}
                    onKeyDown={handleKey}
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
    recordId,
    value,
    onChange,
    allowCreate = true,
    flat = false,
}: {
    field: FieldEntity;
    listId: number | string;
    recordId?: number;
    value: unknown;
    onChange: (v: unknown) => void;
    allowCreate?: boolean;
    /** Sin caja de input (las fichas diseñadas). */
    flat?: boolean;
}): JSX.Element {
    const id = `field-${field.id}`;

    if (field.type === 'date' || field.type === 'datetime') {
        // El MISMO editor de la tabla (calendario visual + atajos +
        // recurrencia si el record existe). onChange acumula en el draft
        // del padre; el guardado sigue el flujo normal del form.
        return (
            <DateCellEditor
                listId={Number(listId)}
                recordId={recordId}
                field={field}
                value={typeof value === 'string' ? value : null}
                onCommit={(next) => onChange(next)}
            >
                <button
                    type="button"
                    className="imcrm-inline-flex imcrm-min-h-[24px] imcrm-w-full imcrm-items-center imcrm-rounded imcrm-py-0.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent/40"
                    title={__('Editar fecha y recurrencia')}
                >
                    <FieldValueDisplay field={field} value={value} />
                </button>
            </DateCellEditor>
        );
    }

    if (field.type === 'rating') {
        const cfg = field.config as { max?: number; icon?: RatingIcon };
        return (
            <span className="imcrm-inline-flex imcrm-min-h-[24px] imcrm-items-center">
                <RatingControl
                    value={typeof value === 'number' ? value : null}
                    max={cfg.max}
                    icon={cfg.icon}
                    size="md"
                    onChange={(next) => onChange(next)}
                />
            </span>
        );
    }

    if (field.type === 'relation') {
        return <RelationPicker id={id} field={field} value={value} onChange={(ids) => onChange(ids)} variant={flat ? 'cell' : 'default'} wrap={flat} />;
    }

    if (field.type === 'user') {
        const userId = typeof value === 'number' ? value : value ? Number(value) : null;
        return (
            <UserPicker
                value={userId}
                onChange={(next) => onChange(next)}
                compact
                flat={flat}
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
                allowCreate={allowCreate}
                mode="single"
                value={typeof value === 'string' ? value : null}
                onChange={(v) => onChange(v ?? null)}
                compact
                variant={flat ? 'cell' : 'default'}
                wrap={flat}
            />
        );
    }

    if (field.type === 'multi_select') {
        return (
            <OptionPicker
                field={field}
                listId={listId}
                allowCreate={allowCreate}
                mode="multi"
                value={Array.isArray(value) ? value.map(String) : []}
                onChange={(v) => onChange(Array.isArray(v) ? v : [])}
                compact
                variant={flat ? 'cell' : 'default'}
                wrap={flat}
            />
        );
    }

    return <span>{String(value)}</span>;
}

import { AiFieldValue } from './AiFieldValue';

import { DurationControl } from '@/components/fields/DurationControl';
import { PhoneControl } from '@/components/fields/PhoneControl';
import { RatingControl, type RatingIcon } from '@/components/fields/RatingControl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OptionPicker } from '@/components/ui/option-picker';
import { Textarea } from '@/components/ui/textarea';
import { UserPicker } from '@/components/ui/user-picker';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { isDerivedFieldType } from '@/lib/fieldTypeCatalog';

import { DateCellEditor } from './DateCellEditor';
import { RelationPicker } from '@/components/fields/RelationPicker';

import { CompactFieldRow } from './crm/CompactFieldRow';
import { FileFieldControl } from './FileFieldControl';
import { maxFilesOf } from './fileIds';
import { FieldValueDisplay } from './crm/FieldValueDisplay';

interface RecordFieldsFormProps {
    /**
     * ID de la lista — necesario para el OptionPicker de
     * select/multi_select, que puede crear opciones inline via REST.
     */
    listId: number | string;
    /**
     * Record en edición (si ya existe): habilita la sección "Recurrente"
     * del date picker. En creación va undefined (solo calendario).
     */
    recordId?: number;
    fields: FieldEntity[];
    values: Record<string, unknown>;
    onChange: (values: Record<string, unknown>) => void;
    fieldErrors?: Record<string, string>;
    /** Si true, omitimos los campos que ya pueden editarse inline en la tabla
     *  para evitar duplicación visual. Default: false (drawer muestra todo). */
    onlyNonInline?: boolean;
    /**
     * Layout visual:
     *  - `comfortable` (default) — label arriba + input abajo, gap-4.
     *    Bueno para create dialog y page detail (más aire visual).
     *  - `compact` — label izquierda fixed-width + valor derecha
     *    edit-on-click (estilo Linear/Notion, ~32-40px por fila).
     *    Bueno para drawers laterales donde el espacio es premium.
     *
     * Internamente compact delega a `CompactFieldRow` (mismo componente
     * que usa el layout CRM en sus properties_group y PropertiesSidebar).
     */
    density?: 'comfortable' | 'compact';
    /**
     * Solo densidad `compact`: muestra el icono lucide del tipo de
     * campo junto al label de cada fila (estilo ClickUp).
     */
    showTypeIcon?: boolean;
    /**
     * v0.1.213 — slug → por qué ese campo no se puede cambiar (lista de una
     * tienda). Se muestra de sólo lectura con el motivo.
     */
    lockedReasons?: Record<string, string>;
    /**
     * Campos que ya se editan en otro lugar de la ficha (el TÍTULO grande):
     * no se repiten como fila — se veían dos veces ("Tarea" arriba y la fila
     * "Tarea *" abajo).
     */
    hiddenSlugs?: readonly string[];
    /**
     * v0.1.291 — «Ver historial» en cada campo (sólo densidad `compact` y con
     * un registro existente). `canRestore`: quien mira puede escribir el
     * registro; `onRestored` avisa a la ficha (que tiene borrador) del valor
     * que quedó guardado.
     */
    history?: { canRestore: boolean; onRestored?: (slug: string, value: unknown, saved: RecordEntity | null) => void } | null;
}

const NON_INLINE_TYPES: ReadonlyArray<string> = ['user', 'file', 'relation'];

/**
 * Form per-tipo reutilizado por RecordCreateDialog y RecordDetailDrawer.
 * Se renderiza un input apropiado por tipo; los tipos `relation` se editan
 * con el selector de registros (`RelationPicker`, v0.1.209).
 */
export function RecordFieldsForm({
    listId,
    recordId,
    fields,
    values,
    onChange,
    fieldErrors,
    onlyNonInline,
    density = 'comfortable',
    showTypeIcon = false,
    lockedReasons,
    hiddenSlugs,
    history = null,
}: RecordFieldsFormProps): JSX.Element {
    const visible = fields
        .filter((f) => (onlyNonInline ? NON_INLINE_TYPES.includes(f.type) : true))
        .filter((f) => !hiddenSlugs?.includes(f.slug))
        // v0.1.170 — los derivados (computed/lookup/rollup) no tienen nada que
        // cargar en el alta: aparecen sólo al editar, como lectura.
        .filter((f) => !(recordId === undefined && isDerivedFieldType(f.type)))
        .sort((a, b) => a.position - b.position);

    const setValue = (slug: string, value: unknown): void => {
        onChange({ ...values, [slug]: value });
    };

    if (density === 'compact') {
        // Delega a `CompactFieldRow` por field — mismo componente que usa
        // el layout CRM en properties_group + PropertiesSidebar.
        // Sin caja contenedora (estilo ClickUp): las filas van full-width
        // separadas solo por el border-b hairline interno de cada fila.
        return (
            <div className="imcrm-flex imcrm-flex-col">
                {visible.map((field) => (
                    <CompactFieldRow
                        key={field.id}
                        field={field}
                        listId={listId}
                        recordId={recordId}
                        value={values[field.slug]}
                        onChange={(v) => setValue(field.slug, v)}
                        error={fieldErrors?.[field.slug]}
                        showTypeIcon={showTypeIcon}
                        lockedReason={lockedReasons?.[field.slug] ?? null}
                        history={
                            history && recordId !== undefined
                                ? {
                                      canRestore: history.canRestore,
                                      onRestored: (v, saved) => history.onRestored?.(field.slug, v, saved),
                                  }
                                : null
                        }
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            {visible.map((field) =>
                lockedReasons?.[field.slug] ? (
                    <div key={field.id} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" title={lockedReasons[field.slug]}>
                        <span className="imcrm-text-sm imcrm-font-medium">{field.label}</span>
                        <div className="imcrm-flex imcrm-min-h-[36px] imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                            <FieldValueDisplay field={field} value={values[field.slug]} />
                        </div>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{lockedReasons[field.slug]}</span>
                    </div>
                ) : (
                <FieldInput
                    key={field.id}
                    listId={listId}
                    recordId={recordId}
                    field={field}
                    value={values[field.slug]}
                    onChange={(v) => setValue(field.slug, v)}
                    error={fieldErrors?.[field.slug]}
                />
                ),
            )}
        </div>
    );
}

interface FieldInputProps {
    listId: number | string;
    recordId?: number;
    field: FieldEntity;
    value: unknown;
    onChange: (value: unknown) => void;
    error?: string;
}

function FieldInput({ listId, recordId, field, value, onChange, error }: FieldInputProps): JSX.Element {
    const id = `record-field-${field.id}`;

    let control: JSX.Element;
    switch (field.type) {
        case 'long_text':
            control = (
                <Textarea
                    id={id}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    rows={4}
                />
            );
            break;
        case 'checkbox':
            control = (
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input
                        id={id}
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => onChange(e.target.checked)}
                    />
                    <span className="imcrm-text-muted-foreground">{field.label}</span>
                </label>
            );
            break;
        case 'date':
        case 'datetime':
            // El MISMO date picker de la tabla (calendario + atajos +
            // recurrencia cuando el record ya existe). El trigger imita
            // un input para no romper el layout del form.
            control = (
                <DateCellEditor
                    listId={Number(listId)}
                    recordId={recordId}
                    field={field}
                    value={typeof value === 'string' ? value : null}
                    onCommit={(next) => onChange(next)}
                >
                    <button
                        id={id}
                        type="button"
                        className="imcrm-flex imcrm-h-9 imcrm-w-full imcrm-items-center imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-left imcrm-text-sm hover:imcrm-border-primary/40"
                    >
                        {typeof value === 'string' && value !== ''
                            ? <span>{field.type === 'datetime' ? value.replace('T', ' ').slice(0, 16) : value.slice(0, 10)}</span>
                            : <span className="imcrm-text-muted-foreground">{__('Elegir fecha…')}</span>}
                    </button>
                </DateCellEditor>
            );
            break;
        case 'number':
        case 'currency':
            control = (
                <Input
                    id={id}
                    type="number"
                    step="any"
                    value={value === undefined || value === null ? '' : String(value)}
                    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                />
            );
            break;
        case 'select':
            control = (
                <OptionPicker
                    field={field}
                    listId={listId}
                    mode="single"
                    value={typeof value === 'string' ? value : null}
                    onChange={(v) => onChange(v ?? null)}
                />
            );
            break;
        case 'multi_select':
            control = (
                <OptionPicker
                    field={field}
                    listId={listId}
                    mode="multi"
                    value={Array.isArray(value) ? value.map(String) : []}
                    onChange={(v) => onChange(Array.isArray(v) ? v : [])}
                />
            );
            break;
        case 'percent':
            control = (
                <Input
                    id={id}
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={value === undefined || value === null ? '' : String(value)}
                    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                />
            );
            break;
        case 'duration':
            control = (
                <DurationControl
                    value={typeof value === 'number' ? value : null}
                    format={(field.config as { format?: 'hm' | 'clock' }).format}
                    onCommit={(next) => onChange(next)}
                    className="imcrm-h-9"
                />
            );
            break;
        case 'phone':
            control = (
                <PhoneControl
                    value={typeof value === 'string' ? value : null}
                    config={field.config}
                    onChange={onChange}
                />
            );
            break;
        case 'rating': {
            const cfg = field.config as { max?: number; icon?: RatingIcon };
            control = (
                <span className="imcrm-flex imcrm-h-9 imcrm-items-center">
                    <RatingControl
                        value={typeof value === 'number' ? value : null}
                        max={cfg.max}
                        icon={cfg.icon}
                        size="md"
                        onChange={(next) => onChange(next)}
                    />
                </span>
            );
            break;
        }
        case 'email':
            control = (
                <Input
                    id={id}
                    type="email"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
            break;
        case 'url':
            control = (
                <Input
                    id={id}
                    type="url"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
            break;
        case 'user':
            control = (
                <UserPicker
                    value={typeof value === 'number' ? value : value ? Number(value) : null}
                    onChange={(id) => onChange(id)}
                />
            );
            break;
        case 'file':
            // Subcomponente dedicado: llama useAttachments incondicionalmente
            // (rules-of-hooks — aquí estamos dentro de un switch).
            control = <FileFieldControl id={id} value={value} onChange={onChange} maxFiles={maxFilesOf(field.config)} />;
            break;
        case 'relation':
            control = <RelationPicker id={id} field={field} value={value} onChange={(ids) => onChange(ids)} />;
            break;
        case 'ai':
            control = (
                <div id={id} className="imcrm-min-h-[36px] imcrm-py-1.5">
                    <AiFieldValue field={field} value={value} listId={listId} recordId={recordId} />
                </div>
            );
            break;
        case 'computed':
        case 'lookup':
        case 'rollup':
        case 'time_tracked':
            // Solo lectura: el backend los deriva en cada lectura.
            control = (
                <div id={id} className="imcrm-min-h-[36px] imcrm-py-1.5 imcrm-text-sm">
                    <FieldValueDisplay field={field} value={value} />
                </div>
            );
            break;
        default:
            control = (
                <Input
                    id={id}
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                />
            );
    }

    if (field.type === 'checkbox') {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                {control}
                {error !== undefined && (
                    <span className="imcrm-text-xs imcrm-text-destructive">{error}</span>
                )}
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label htmlFor={id}>
                {field.label}
                {field.is_required && <span className="imcrm-text-destructive"> *</span>}
            </Label>
            {control}
            {/* Ayuda del campo (v0.1.163): la escribe quien administra los
                campos, para que el resto del equipo sepa cómo se completa. */}
            {field.description !== null && field.description !== undefined && field.description !== '' && (
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{field.description}</span>
            )}
            {error !== undefined && (
                <span className="imcrm-text-xs imcrm-text-destructive">{error}</span>
            )}
        </div>
    );
}

// `renderSelect` y `renderMultiSelect` se eliminaron — los `case 'select'`
// y `'multi_select'` ahora usan `<OptionPicker>` que soporta búsqueda
// + creación inline de opciones.

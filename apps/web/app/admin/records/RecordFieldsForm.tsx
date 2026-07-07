import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OptionPicker } from '@/components/ui/option-picker';
import { Textarea } from '@/components/ui/textarea';
import { UserPicker } from '@/components/ui/user-picker';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { CompactFieldRow } from './crm/CompactFieldRow';

interface RecordFieldsFormProps {
    /**
     * ID de la lista — necesario para el OptionPicker de
     * select/multi_select, que puede crear opciones inline via REST.
     */
    listId: number | string;
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
}

const NON_INLINE_TYPES: ReadonlyArray<string> = ['user', 'file', 'relation'];

/**
 * Form per-tipo reutilizado por RecordCreateDialog y RecordDetailDrawer.
 * Se renderiza un input apropiado por tipo; los tipos `relation` se editan
 * como CSV de IDs (placeholder hasta que tengamos el RecordPicker en Fase
 * posterior).
 */
export function RecordFieldsForm({
    listId,
    fields,
    values,
    onChange,
    fieldErrors,
    onlyNonInline,
    density = 'comfortable',
}: RecordFieldsFormProps): JSX.Element {
    const visible = fields
        .filter((f) => (onlyNonInline ? NON_INLINE_TYPES.includes(f.type) : true))
        .sort((a, b) => a.position - b.position);

    const setValue = (slug: string, value: unknown): void => {
        onChange({ ...values, [slug]: value });
    };

    if (density === 'compact') {
        // Delega a `CompactFieldRow` por field — mismo componente que usa
        // el layout CRM en properties_group + PropertiesSidebar.
        // Sin gap entre filas: CompactFieldRow ya pone border-b interno.
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border">
                {visible.map((field) => (
                    <CompactFieldRow
                        key={field.id}
                        field={field}
                        listId={listId}
                        value={values[field.slug]}
                        onChange={(v) => setValue(field.slug, v)}
                        error={fieldErrors?.[field.slug]}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            {visible.map((field) => (
                <FieldInput
                    key={field.id}
                    listId={listId}
                    field={field}
                    value={values[field.slug]}
                    onChange={(v) => setValue(field.slug, v)}
                    error={fieldErrors?.[field.slug]}
                />
            ))}
        </div>
    );
}

interface FieldInputProps {
    listId: number | string;
    field: FieldEntity;
    value: unknown;
    onChange: (value: unknown) => void;
    error?: string;
}

function FieldInput({ listId, field, value, onChange, error }: FieldInputProps): JSX.Element {
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
            control = (
                <Input
                    id={id}
                    type="date"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => onChange(e.target.value || null)}
                />
            );
            break;
        case 'datetime':
            control = (
                <Input
                    id={id}
                    type="datetime-local"
                    value={typeof value === 'string' ? value.replace(' ', 'T').slice(0, 16) : ''}
                    onChange={(e) => onChange(e.target.value || null)}
                />
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
            control = (
                <Input
                    id={id}
                    type="number"
                    min={1}
                    value={value === undefined || value === null ? '' : String(value)}
                    onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                    placeholder={__('ID de attachment')}
                />
            );
            break;
        case 'relation': {
            // Placeholder: CSV de IDs hasta que tengamos un picker.
            const current = Array.isArray(value)
                ? value.join(', ')
                : typeof value === 'string'
                    ? value
                    : '';
            control = (
                <Input
                    id={id}
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
                    placeholder={__('IDs separados por coma')}
                />
            );
            break;
        }
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
            {error !== undefined && (
                <span className="imcrm-text-xs imcrm-text-destructive">{error}</span>
            )}
        </div>
    );
}

// `renderSelect` y `renderMultiSelect` se eliminaron — los `case 'select'`
// y `'multi_select'` ahora usan `<OptionPicker>` que soporta búsqueda
// + creación inline de opciones.

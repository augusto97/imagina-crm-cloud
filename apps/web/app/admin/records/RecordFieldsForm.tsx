import { useRef, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OptionPicker } from '@/components/ui/option-picker';
import { Textarea } from '@/components/ui/textarea';
import { UserPicker } from '@/components/ui/user-picker';
import { useAttachments, type AttachmentDto } from '@/hooks/useAttachments';
import { getBootData } from '@/lib/boot';
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
    /**
     * Solo densidad `compact`: muestra el icono lucide del tipo de
     * campo junto al label de cada fila (estilo ClickUp).
     */
    showTypeIcon?: boolean;
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
    showTypeIcon = false,
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
                        showTypeIcon={showTypeIcon}
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
            // Subcomponente dedicado: llama useAttachments incondicionalmente
            // (rules-of-hooks — acá estamos dentro de un switch).
            control = <FileFieldControl id={id} value={value} onChange={onChange} />;
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

/** Límite de upload del backend (ADR-S16) — espejo para cortar antes del POST. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Control del field type `file`: upload multipart contra `POST /files`
 * (ADR-S16) + preview del attachment resuelto vía `useAttachments`.
 *
 * El multipart no pasa por el adapter `api` (que fuerza JSON) — fetch crudo
 * con cookie de sesión + `X-Tenant-Id`, mismo patrón que ExportButton.
 */
export function FileFieldControl({
    id,
    value,
    onChange,
}: {
    id: string;
    value: unknown;
    onChange: (value: unknown) => void;
}): JSX.Element {
    const [busy, setBusy] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Valor numérico = id de attachment del módulo de archivos propio.
    const attachmentId = typeof value === 'number' && value > 0 ? value : null;
    const attachments = useAttachments(attachmentId !== null ? [attachmentId] : []);
    const resolved = attachmentId !== null ? attachments.data?.get(attachmentId) ?? null : null;

    const upload = async (file: File): Promise<void> => {
        setUploadError(null);
        if (file.size > MAX_UPLOAD_BYTES) {
            setUploadError(__('El archivo supera el tamaño máximo (20 MB).'));
            return;
        }
        setBusy(true);
        try {
            const boot = getBootData();
            // Auth: cookie de sesión + workspace activo por header (sin
            // Content-Type manual: el browser arma el boundary del multipart).
            const headers: Record<string, string> = {};
            if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);
            const form = new FormData();
            form.append('file', file);
            const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/files`, {
                method: 'POST',
                headers,
                credentials: 'include',
                body: form,
            });
            const payload = (await res.json().catch(() => null)) as
                | (Partial<AttachmentDto> & { code?: string; message?: string })
                | null;
            if (!res.ok || typeof payload?.id !== 'number') {
                const message =
                    payload?.code === 'file_too_large'
                        ? __('El archivo supera el tamaño máximo (20 MB).')
                        : payload?.message ?? `HTTP ${res.status}`;
                throw new Error(message);
            }
            onChange(payload.id);
        } catch (e) {
            setUploadError(e instanceof Error ? e.message : __('No se pudo subir el archivo.'));
        } finally {
            setBusy(false);
            // Reset para que elegir el mismo archivo dos veces re-dispare onChange.
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            {attachmentId !== null && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-py-2 imcrm-text-sm">
                    <FileText className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                    {resolved !== null ? (
                        <a
                            href={resolved.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="imcrm-truncate imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        >
                            {resolved.title}
                        </a>
                    ) : (
                        <span className="imcrm-truncate imcrm-text-muted-foreground">
                            {__('Archivo #%d').replace('%d', String(attachmentId))}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => onChange(null)}
                        className="imcrm-ml-auto imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-destructive"
                    >
                        {__('Quitar')}
                    </button>
                </div>
            )}
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <input
                    id={id}
                    ref={inputRef}
                    type="file"
                    disabled={busy}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(file);
                    }}
                    className="imcrm-w-full imcrm-text-sm imcrm-text-muted-foreground file:imcrm-mr-2 file:imcrm-rounded-md file:imcrm-border file:imcrm-border-input file:imcrm-bg-background file:imcrm-px-3 file:imcrm-py-1.5 file:imcrm-text-xs file:imcrm-font-medium file:imcrm-text-foreground"
                />
                {busy && (
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-animate-spin imcrm-text-muted-foreground" aria-hidden />
                )}
            </div>
            {uploadError !== null && (
                <span className="imcrm-text-xs imcrm-text-destructive">{uploadError}</span>
            )}
        </div>
    );
}

// `renderSelect` y `renderMultiSelect` se eliminaron — los `case 'select'`
// y `'multi_select'` ahora usan `<OptionPicker>` que soporta búsqueda
// + creación inline de opciones.

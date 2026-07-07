import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSlugCheck } from '@/hooks/useSlugCheck';
import { __ } from '@/lib/i18n';
import { slugify, validateSlugFormat } from '@/lib/slug';
import { cn } from '@/lib/utils';

type SlugContext = 'list' | 'field';

interface SlugEditorProps {
    type: SlugContext;
    /** Texto desde el cual sugerir slug en modo creación (label/name). */
    sourceText?: string;
    /** Slug actual (modo edición). Indispensable para advertencia "rename de slug existente". */
    currentSlug?: string;
    /** ID de la lista (requerido para slug de campo). */
    listId?: number;
    /** Slug actual del input (controlado). */
    value: string;
    onChange: (slug: string) => void;
    /** Si el usuario tocó manualmente; al ser true, dejamos de sugerir desde sourceText. */
    isDirty: boolean;
    onDirty: () => void;
    label?: string;
    /** Texto de prefijo visual ("clientes/" para listas, "field:" para campos). */
    prefix?: string;
}

/**
 * Editor reutilizable de slug con:
 *
 * - Slugify automático desde `sourceText` mientras el usuario no haya
 *   tocado el input (controlado por `isDirty`).
 * - Validación inline de formato (regex local).
 * - Verificación de disponibilidad debounced contra `/slugs/check`.
 * - Advertencia clara cuando se está renombrando un slug existente
 *   (CLAUDE.md §7.8).
 */
export function SlugEditor({
    type,
    sourceText,
    currentSlug,
    listId,
    value,
    onChange,
    isDirty,
    onDirty,
    label,
    prefix,
}: SlugEditorProps): JSX.Element {
    const [touched, setTouched] = useState(false);

    // Auto-slugify mientras no se haya tocado.
    const lastSourceRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (isDirty) return;
        if (sourceText === undefined) return;
        if (sourceText === lastSourceRef.current) return;
        lastSourceRef.current = sourceText;
        const next = slugify(sourceText);
        if (next !== value) {
            onChange(next);
        }
    }, [sourceText, isDirty, value, onChange]);

    const formatCheck = validateSlugFormat(value);
    const remoteCheck = useSlugCheck({
        type,
        slug: value,
        listId,
        currentSlug,
    });

    const isRenaming = currentSlug !== undefined && value !== currentSlug && value !== '';
    const showFormatError = touched && !!value && !formatCheck.ok;

    let statusIcon: JSX.Element | null = null;
    let statusText: string | null = null;
    let statusTone: 'ok' | 'warn' | 'error' | 'info' | null = null;

    if (showFormatError) {
        statusIcon = <AlertCircle className="imcrm-h-3.5 imcrm-w-3.5" />;
        statusText = formatCheck.message ?? __('Formato inválido.');
        statusTone = 'error';
    } else if (remoteCheck.state === 'checking') {
        statusIcon = <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />;
        statusText = __('Verificando disponibilidad…');
        statusTone = 'info';
    } else if (remoteCheck.state === 'available') {
        statusIcon = <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" />;
        statusText = __('Disponible');
        statusTone = 'ok';
    } else if (remoteCheck.state === 'taken' || remoteCheck.state === 'invalid') {
        statusIcon = <AlertCircle className="imcrm-h-3.5 imcrm-w-3.5" />;
        statusText = remoteCheck.message ?? __('No disponible');
        statusTone = 'error';
    }

    const toneClass: Record<string, string> = {
        ok: 'imcrm-text-success',
        warn: 'imcrm-text-warning',
        error: 'imcrm-text-destructive',
        info: 'imcrm-text-muted-foreground',
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label htmlFor={`slug-${type}`}>{label ?? __('Slug')}</Label>
            <div className="imcrm-flex imcrm-items-stretch imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-overflow-hidden focus-within:imcrm-ring-2 focus-within:imcrm-ring-ring focus-within:imcrm-ring-offset-2">
                {prefix !== undefined && (
                    <span className="imcrm-flex imcrm-items-center imcrm-bg-muted imcrm-px-3 imcrm-text-xs imcrm-font-mono imcrm-text-muted-foreground">
                        {prefix}
                    </span>
                )}
                <Input
                    id={`slug-${type}`}
                    value={value}
                    onChange={(e) => {
                        onDirty();
                        setTouched(true);
                        onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                    }}
                    className="imcrm-border-0 imcrm-rounded-none imcrm-shadow-none focus-visible:imcrm-ring-0 imcrm-font-mono"
                    spellCheck={false}
                    autoComplete="off"
                />
            </div>
            {statusText !== null && statusTone !== null && (
                <div
                    className={cn('imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs', toneClass[statusTone])}
                    aria-live="polite"
                    role={statusTone === 'error' ? 'alert' : 'status'}
                >
                    <span aria-hidden="true">{statusIcon}</span>
                    <span>{statusText}</span>
                </div>
            )}
            {isRenaming && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground imcrm-leading-relaxed">
                    {__(
                        'Cambiar el slug no afectará tus datos ni filtros guardados. URLs externas, webhooks o integraciones que usen el slug actual deberán actualizarse. Imagina CRM mantendrá redirects automáticos del anterior.',
                    )}{' '}
                    <code className="imcrm-font-mono">{currentSlug}</code>
                </p>
            )}
        </div>
    );
}

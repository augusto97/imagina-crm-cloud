import { chipSoftStyle, type OptionColor } from '@/components/ui/color-picker';
import { useWpUser } from '@/hooks/useWpUsers';
import type { FieldEntity } from '@/types/field';

import { extractFieldOptions, type FieldOption } from './fieldOptions';

/**
 * Render de un chip de opción (select / multi_select). Si la opción
 * tiene un `color` válido (uno de los OptionColor), usa la variante
 * tonal soft (bg/14 + border/32 + text-color); si no, cae a un chip
 * neutral con border hairline.
 */
function OptionChip({ opt, fallback }: { opt?: FieldOption; fallback: string }): JSX.Element {
    const color = opt?.color as OptionColor | undefined;
    const style = chipSoftStyle(color);
    return (
        <span
            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[12px] imcrm-font-medium imcrm-leading-tight imcrm-whitespace-nowrap"
            style={style ?? {
                backgroundColor: 'hsl(var(--imcrm-muted))',
                borderColor:     'hsl(var(--imcrm-border))',
                color:           'hsl(var(--imcrm-foreground))',
            }}
        >
            {color && (
                <span
                    aria-hidden
                    className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-current imcrm-opacity-90"
                />
            )}
            {opt?.label ?? fallback}
        </span>
    );
}

/**
 * Devuelve el render visual de un valor según el tipo de campo. Compartido
 * entre TableView (modo lectura) y EditableCell (cuando NO está en edit).
 */
export function renderCellValue(field: FieldEntity, value: unknown): React.ReactNode {
    if (value === null || value === undefined || value === '') {
        return <span className="imcrm-text-muted-foreground">—</span>;
    }

    if (field.type === 'checkbox') {
        return value ? '✓' : '—';
    }

    if (field.type === 'multi_select' && Array.isArray(value)) {
        const opts = extractFieldOptions(field);
        const map = new Map(opts.map((o) => [o.value, o]));
        return (
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {value.map((v, i) => (
                    <OptionChip key={i} opt={map.get(String(v))} fallback={String(v)} />
                ))}
            </div>
        );
    }

    if (field.type === 'select' && typeof value === 'string') {
        const opt = extractFieldOptions(field).find((o) => o.value === value);
        return <OptionChip opt={opt} fallback={value} />;
    }

    if (field.type === 'datetime' && typeof value === 'string') {
        try {
            return new Date(value + 'Z').toLocaleString();
        } catch {
            return value;
        }
    }

    if (field.type === 'currency' && typeof value === 'number') {
        return value.toLocaleString(undefined, { minimumFractionDigits: 2 });
    }

    // Computed: el evaluator backend pone null si falta input o
    // división por cero. Formateamos según el operador (números con
    // decimales, fechas con locale, strings tal cual).
    if (field.type === 'computed' && value !== null && value !== undefined) {
        if (typeof value === 'number') {
            const op = (field.config as { operation?: string }).operation;
            // Diferencias de fecha → entero sin decimales.
            if (op === 'date_diff_months' || op === 'date_diff_days') {
                return Number.isInteger(value) ? String(value) : value.toFixed(0);
            }
            const decimals = (field.config as { decimals?: number }).decimals ?? 2;
            return value.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: decimals,
            });
        }
        return String(value);
    }

    if (field.type === 'url' && typeof value === 'string') {
        return (
            <a
                href={value}
                target="_blank"
                rel="noreferrer"
                className="imcrm-text-primary hover:imcrm-underline"
                onClick={(e) => e.stopPropagation()}
            >
                {value}
            </a>
        );
    }

    if (field.type === 'user') {
        const id = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(id) && id > 0) {
            return <UserCell id={id} />;
        }
    }

    return String(value);
}

/**
 * Render compacto de user para celdas de tabla. Cachea via TanStack
 * Query (`useWpUser`) — múltiples celdas con el mismo ID resuelven
 * a 1 sola request. Fallback al ID si el endpoint falla o el user
 * no existe.
 */
function UserCell({ id }: { id: number }): JSX.Element {
    const { data: user, isLoading } = useWpUser(id);
    if (isLoading) {
        return <span className="imcrm-text-muted-foreground">…</span>;
    }
    if (! user) {
        return <span className="imcrm-text-muted-foreground">#{id}</span>;
    }
    return (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5">
            {user.avatar_url && (
                <img
                    src={user.avatar_url}
                    alt=""
                    aria-hidden
                    className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-rounded-full"
                />
            )}
            <span className="imcrm-truncate">{user.display_name || user.login}</span>
        </span>
    );
}

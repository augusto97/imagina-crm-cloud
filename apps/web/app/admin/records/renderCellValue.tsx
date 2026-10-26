import { formatDuration, type DurationFormat } from '@imagina-base/shared';

import { PercentDisplay } from '@/components/fields/PercentDisplay';
import { PhoneDisplay } from '@/components/fields/PhoneControl';
import { RatingControl, type RatingIcon } from '@/components/fields/RatingControl';
import { chipSoftStyle, type OptionColor } from '@/components/ui/color-picker';
import { useWpUser } from '@/hooks/useWpUsers';
import { isPlainClick, openAttachmentsPreview } from '@/components/files/openAttachments';
import { useAttachment } from '@/hooks/useAttachments';
import { __ } from '@/lib/i18n';
import { Paperclip } from 'lucide-react';
import { formatFieldNumber } from '@/lib/fieldNumberFormat';
import { asDisplayField } from '@/lib/fieldTypeCatalog';
import { FormulaErrorBadge } from '@/components/fields/FormulaErrorBadge';
import { isFormulaError } from '@/lib/formulaError';
import { formatDateStr, formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import { lookupDisplayField, lookupValues, rollupDisplayField } from '@/lib/throughFields';
import type { FieldEntity } from '@/types/field';

import { extractFieldOptions, type FieldOption } from './fieldOptions';
import { UrlImage } from '@/components/fields/UrlImage';
import { isImageUrlField } from '@/lib/imageProxy';
import { parseUtcDate } from '@/lib/utcDate';

/**
 * Render de un chip de opción (select / multi_select). Si la opción
 * tiene un `color` válido (uno de los OptionColor), usa la variante
 * tonal soft (bg/14 + border/32 + text-color); si no, cae a un chip
 * neutral con border hairline.
 */
export function OptionChip({ opt, fallback }: { opt?: FieldOption; fallback: string }): JSX.Element {
    const color = opt?.color as OptionColor | undefined;
    const style = chipSoftStyle(color);
    return (
        // Sin punto/dot a la izquierda: el chip sólido YA es el color de la
        // opción — el punto duplicaba la señal y desperdiciaba ancho de celda.
        <span
            className="imcrm-opt-chip imcrm-inline-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[12px] imcrm-font-medium imcrm-leading-tight imcrm-whitespace-nowrap"
            style={style ?? {
                backgroundColor: 'hsl(var(--imcrm-muted))',
                borderColor:     'hsl(var(--imcrm-border))',
                color:           'hsl(var(--imcrm-foreground))',
            }}
        >
            {/* El texto va en un span PROPIO (v0.1.144): `text-overflow` no
                aplica a un contenedor flex — con la elipsis puesta en el chip
                (que es inline-flex) el navegador la ignoraba y el texto salía
                cortado a cuchillo, sin los tres puntos. */}
            <span className="imcrm-min-w-0 imcrm-truncate">{opt?.label ?? fallback}</span>
        </span>
    );
}

/**
 * Devuelve el render visual de un valor según el tipo de campo. Compartido
 * entre TableView (modo lectura) y EditableCell (cuando NO está en edit).
 */
export function renderCellValue(field: FieldEntity, value: unknown): React.ReactNode {
    // Campo «Botón»: no guarda valor. Donde no se puede presionar (tarjetas,
    // tablas de sólo lectura) no se dibuja nada; el botón vivo lo pone
    // `EditableCell` / la ficha con su registro.
    if (field.type === 'button') return null;
    // Fórmulas (A1): una fila donde la fórmula no se pudo calcular muestra
    // «#ERROR» con el motivo; si no, se pinta como el tipo de su resultado.
    if (isFormulaError(value)) return <FormulaErrorBadge message={value.message} />;
    if (field.type === 'formula') return renderCellValue(asDisplayField(field), value);
    // v0.1.170 — lookup: cada valor vinculado se pinta con el TIPO del campo
    // destino (chips de select con su color, moneda, fecha…); rollup: un
    // número con la precisión/moneda del destino (o fecha en min/max).
    if (field.type === 'lookup') {
        const display = lookupDisplayField(field);
        const values = lookupValues(value);
        if (!display || values.length === 0) {
            return <span className="imcrm-text-muted-foreground">—</span>;
        }
        return (
            <div className="imcrm-cell-chips imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-1.5 imcrm-gap-y-1">
                {values.map((v, i) => (
                    <span key={i} className="imcrm-inline-flex imcrm-min-w-0 imcrm-items-center">
                        {renderCellValue(display, v)}
                        {i < values.length - 1 && display.type !== 'select' && display.type !== 'multi_select' && (
                            <span className="imcrm-text-muted-foreground">,</span>
                        )}
                    </span>
                ))}
            </div>
        );
    }
    if (field.type === 'rollup') {
        return renderCellValue(rollupDisplayField(field), value);
    }
    // v0.1.291 — tiempo registrado: minutos como duración («12h 30m»); sin
    // tiempo cargado, vacío (no «0m» en cada fila).
    if (field.type === 'time_tracked') {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return <span className="imcrm-text-muted-foreground">—</span>;
        return <span className="imcrm-tabular-nums">{formatDuration(n, (field.config as { format?: DurationFormat }).format)}</span>;
    }

    // v0.1.300 — «Creado por» / «Modificado por» de algo que hizo el SISTEMA (una
    // automatización, un formulario público, una sincronización): id 0.
    if ((field.type === 'created_by' || field.type === 'updated_by') && (value === 0 || value === '0')) {
        return <span className="imcrm-text-muted-foreground">{__('Sistema')}</span>;
    }
    // v0.1.300 — el ID automático se lee como un código (monoespaciado, que se
    // alinea en la columna); las columnas de sistema, como fecha y hora o
    // persona.
    if (field.type === 'autonumber') {
        if (value === null || value === undefined || value === '') return <span className="imcrm-text-muted-foreground">—</span>;
        return <span className="imcrm-font-mono imcrm-text-[12.5px] imcrm-tabular-nums">{String(value)}</span>;
    }
    if (field.type === 'created_at' || field.type === 'updated_at' || field.type === 'created_by' || field.type === 'updated_by') {
        return renderCellValue(asDisplayField(field), value);
    }
    // C5 — estado de la aprobación: chip con el color del estado.
    if (field.type === 'approval') return renderCellValue(asDisplayField(field), value);

    if (value === null || value === undefined || value === '') {
        return <span className="imcrm-text-muted-foreground">—</span>;
    }

    if (field.type === 'checkbox') {
        // Defensivo: una automatización vieja guardaba «0» / «false» como
        // TEXTO (verdadero en JS) y la celda mostraba ✓ en una casilla vacía.
        return isCheckedValue(value) ? '✓' : '—';
    }

    if (field.type === 'multi_select' && Array.isArray(value)) {
        const opts = extractFieldOptions(field);
        const map = new Map(opts.map((o) => [o.value, o]));
        return (
            // `imcrm-cell-chips`: dentro de la tabla, "Ajustar texto" decide
            // si estos chips van en una línea o en varias (v0.1.137). Fuera
            // de la tabla (tarjetas, kanban) siempre envuelven.
            <div className="imcrm-cell-chips imcrm-flex imcrm-flex-wrap imcrm-gap-1">
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
        // v0.1.104 — orden de fecha y reloj según el formato del workspace.
        return withOverdueHighlight(field, value, formatDateTimeStr(value));
    }

    if (field.type === 'date' && typeof value === 'string') {
        return withOverdueHighlight(field, value, formatDateStr(value));
    }

    if ((field.type === 'currency' || field.type === 'number') && typeof value === 'number') {
        // Respeta los decimales configurados del campo (`config.precision`) —
        // antes currency cableaba 2 y number salía sin separador de miles.
        return formatFieldNumber(field, value);
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
            return formatNumber(value, { maxFrac: decimals });
        }
        return String(value);
    }

    // v0.1.158 — los tipos nuevos: cada uno se LEE como lo que es (un
    // teléfono marca, una calificación son estrellas, un avance es una
    // barra, una duración es "1h 30m" y no 90).
    if (field.type === 'phone') {
        return <PhoneDisplay value={value} />;
    }
    if (field.type === 'rating') {
        const cfg = field.config as { max?: number; icon?: RatingIcon };
        return (
            <RatingControl
                value={typeof value === 'number' ? value : Number(value)}
                max={cfg.max}
                icon={cfg.icon}
            />
        );
    }
    if (field.type === 'percent') {
        return <PercentDisplay value={value} config={field.config} />;
    }
    if (field.type === 'duration') {
        const fmt = (field.config as { format?: DurationFormat }).format;
        return <>{formatDuration(value, fmt)}</>;
    }

    if (field.type === 'url' && typeof value === 'string' && isImageUrlField(field.config)) {
        return <UrlImage value={value} />;
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

    // v0.1.252 — antes caía al String(value) final: la celda decía «17» (el
    // id del adjunto) o «[17]». Ahora el nombre del archivo, con enlace.
    if (field.type === 'file') {
        const ids = (Array.isArray(value) ? value : [value])
            .map((v) => (typeof v === 'number' ? v : Number(v)))
            .filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length > 0) return <FileCell ids={ids} />;
        if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
            return (
                <a href={value.trim()} target="_blank" rel="noreferrer" className="imcrm-text-primary hover:imcrm-underline" onClick={(e) => e.stopPropagation()}>
                    {value.trim().split('/').pop() || value}
                </a>
            );
        }
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
 * Resalta en rojo los valores de fecha VENCIDOS (anteriores a hoy /
 * ahora) cuando el campo lo pide explícitamente vía
 * `config.highlight_overdue === true` (opt-in — un cumpleaños pasado
 * no es "vencido", una fecha límite sí). Sin el flag devuelve el
 * texto sin decorar.
 */
function withOverdueHighlight(
    field: FieldEntity,
    rawValue: string,
    text: React.ReactNode,
): React.ReactNode {
    const optIn = (field.config as { highlight_overdue?: unknown }).highlight_overdue === true;
    if (!optIn || !isOverdueDateValue(field.type, rawValue)) return text;
    return (
        <span className="imcrm-text-destructive imcrm-font-medium">
            {text}
        </span>
    );
}

/**
 * ¿El valor está vencido?
 * - `date` (`YYYY-MM-DD`): estrictamente anterior a HOY (local) —
 *   comparación lexicográfica de strings, sin parsear timezone.
 * - `datetime` (naive-UTC del backend): timestamp anterior a AHORA.
 */
function isOverdueDateValue(type: string, value: string): boolean {
    if (type === 'date') {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        // 'YYYY-MM-DD' ordena lexicográficamente igual que cronológicamente.
        return value.slice(0, 10) < today;
    }
    if (type === 'datetime') {
        const d = parseUtcDate(value);
        if (Number.isNaN(d.getTime())) return false;
        return d.getTime() < Date.now();
    }
    return false;
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

export function FileCell({ ids }: { ids: number[] }): JSX.Element {
    const id = ids[0]!;
    const more = ids.length - 1;
    const { data, isLoading } = useAttachment(id);
    if (isLoading) return <span className="imcrm-text-muted-foreground">…</span>;
    if (!data) return <span className="imcrm-text-muted-foreground">{__('Archivo no disponible')}</span>;
    return (
        <span className="imcrm-inline-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center imcrm-gap-1.5">
            <Paperclip className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
            <a
                href={data.url}
                target="_blank"
                rel="noreferrer"
                className="imcrm-truncate imcrm-text-primary hover:imcrm-underline"
                title={data.title}
                data-testid="imcrm-file-link"
                onClick={(e) => {
                    e.stopPropagation();
                    // v0.1.291 — un click abre el visor (con los demás del
                    // campo para pasar con ←/→); Ctrl/⌘+click, otra pestaña.
                    if (!isPlainClick(e)) return;
                    e.preventDefault();
                    void openAttachmentsPreview(ids, id);
                }}
            >
                {data.title}
            </a>
            {more > 0 && <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">+{more}</span>}
        </span>
    );
}

/** ¿Casilla marcada? Tolera los textos «0»/«false»/«no» que escribían automatizaciones viejas. */
export function isCheckedValue(value: unknown): boolean {
    if (typeof value === 'string') return !['', '0', 'false', 'no'].includes(value.trim().toLowerCase());
    return Boolean(value);
}

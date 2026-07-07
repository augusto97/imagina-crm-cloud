import type { PublicFieldMeta } from './types';

/**
 * Renderer de valor de celda para el bundle público, con paridad de
 * formato vs el admin (`app/admin/records/renderCellValue.tsx`).
 *
 * Diferencias intencionales con el admin:
 *  - No usa el hook `useWpUser` para resolver IDs (el público no tiene
 *    acceso al endpoint `/me/users/{id}` que requiere admin caps).
 *  - No importa nada de `@/components/ui/*` ni Tailwind — el bundle
 *    público es deliberadamente independiente.
 *
 * Para chips de select/multi_select usamos CSS vars
 * `--imcrm-public-opt-{name}` definidas en `assets/public-list.css`.
 * Hex codes se aplican inline via alpha hex notation.
 */

const PRESET_COLORS = new Set([
    'gray', 'slate', 'rose', 'red', 'orange', 'amber', 'yellow', 'lime',
    'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
    'fuchsia', 'pink',
]);

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

/** Devuelve `{bg, border, color}` para un chip soft según color preset o hex. */
function chipStyle(color: string | undefined): React.CSSProperties | undefined {
    if (! color) return undefined;
    if (PRESET_COLORS.has(color)) {
        const base = `var(--imcrm-public-opt-${color})`;
        const text = `var(--imcrm-public-opt-${color}-text)`;
        return {
            backgroundColor: `hsl(${base} / 0.14)`,
            borderColor: `hsl(${base} / 0.32)`,
            color: `hsl(${text})`,
        };
    }
    if (HEX_RE.test(color)) {
        // Para hex aplicamos alpha hex notation. El text usa el hex
        // tal cual — confiamos que el user que eligió un hex
        // específico sabe lo que hace; si queda ilegible, puede
        // cambiarlo. Aplicar HSL forced lightness acá requeriría
        // duplicar el conversor del admin — over-kill para el bundle
        // público que prioriza tamaño.
        return {
            backgroundColor: color + '24',
            borderColor: color + '52',
            color,
        };
    }
    return undefined;
}

interface FieldOption {
    value: string;
    label?: string;
    color?: string;
}

function optionFor(col: PublicFieldMeta, value: string): FieldOption | undefined {
    const opts = col.config?.options;
    if (! Array.isArray(opts)) return undefined;
    return opts.find((o) => o && o.value === value);
}

/** Componente `<Cell>` con formato por tipo equivalente al admin. */
export function Cell({ value, col }: { value: unknown; col: PublicFieldMeta }): JSX.Element {
    if (value === null || value === undefined || value === '') {
        return <span className="imcrm-public-list__empty-cell">—</span>;
    }

    switch (col.type) {
        case 'url': {
            const url = String(value);
            const display = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
            return (
                <a href={url} target="_blank" rel="noopener noreferrer">
                    {display}
                </a>
            );
        }
        case 'email':
            return <a href={`mailto:${String(value)}`}>{String(value)}</a>;
        case 'checkbox':
            return value === true || value === 1 || value === '1' ? (
                <span aria-label="Sí" className="imcrm-public-list__check">✓</span>
            ) : (
                <span aria-label="No" className="imcrm-public-list__empty-cell">—</span>
            );
        case 'select': {
            const v = String(value);
            const opt = optionFor(col, v);
            return (
                <span
                    className="imcrm-public-list__chip"
                    style={chipStyle(opt?.color)}
                >
                    {opt?.label ?? v}
                </span>
            );
        }
        case 'multi_select': {
            if (! Array.isArray(value)) return <>{String(value)}</>;
            return (
                <span className="imcrm-public-list__chips">
                    {value.map((v, i) => {
                        const sv = String(v);
                        const opt = optionFor(col, sv);
                        return (
                            <span
                                key={i}
                                className="imcrm-public-list__chip"
                                style={chipStyle(opt?.color)}
                            >
                                {opt?.label ?? sv}
                            </span>
                        );
                    })}
                </span>
            );
        }
        case 'date': {
            if (typeof value !== 'string') return <>{String(value)}</>;
            const d = new Date(value);
            return Number.isNaN(d.getTime()) ? <>{value}</> : <>{d.toLocaleDateString()}</>;
        }
        case 'datetime': {
            if (typeof value !== 'string') return <>{String(value)}</>;
            // El backend devuelve `YYYY-MM-DD HH:MM:SS` (UTC). Convertimos
            // a ISO con `T` y sufijo `Z` para que `new Date()` lo
            // interprete como UTC y muestre en zona local.
            const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
            const dt = new Date(iso);
            return Number.isNaN(dt.getTime()) ? <>{value}</> : <>{dt.toLocaleString()}</>;
        }
        case 'currency': {
            const num = typeof value === 'number' ? value : Number(value);
            if (Number.isNaN(num)) return <>{String(value)}</>;
            const cfg = (col.config as { currency?: string; decimals?: number } | undefined) ?? {};
            const currency = cfg.currency || 'COP';
            const decimals = cfg.decimals ?? 0;
            try {
                return (
                    <span className="imcrm-public-list__num">
                        {new Intl.NumberFormat(undefined, {
                            style: 'currency',
                            currency,
                            minimumFractionDigits: decimals,
                            maximumFractionDigits: decimals,
                        }).format(num)}
                    </span>
                );
            } catch {
                // Currency code inválido — fallback a número plano.
                return (
                    <span className="imcrm-public-list__num">
                        {num.toLocaleString(undefined, { minimumFractionDigits: decimals })}
                    </span>
                );
            }
        }
        case 'number': {
            const num = typeof value === 'number' ? value : Number(value);
            if (Number.isNaN(num)) return <>{String(value)}</>;
            const cfg = (col.config as { decimals?: number } | undefined) ?? {};
            const decimals = cfg.decimals ?? 0;
            return (
                <span className="imcrm-public-list__num">
                    {num.toLocaleString(undefined, {
                        minimumFractionDigits: decimals,
                        maximumFractionDigits: Math.max(decimals, 2),
                    })}
                </span>
            );
        }
        case 'computed': {
            const cfg = (col.config as { operation?: string; decimals?: number } | undefined) ?? {};
            if (typeof value === 'number') {
                if (cfg.operation === 'date_diff_days' || cfg.operation === 'date_diff_months') {
                    return <span className="imcrm-public-list__num">{value}</span>;
                }
                const decimals = cfg.decimals ?? 2;
                return (
                    <span className="imcrm-public-list__num">
                        {value.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: decimals,
                        })}
                    </span>
                );
            }
            return <>{String(value)}</>;
        }
        case 'long_text': {
            const text = String(value);
            return (
                <span className="imcrm-public-list__long">
                    {text
                        .split('\n')
                        .map((line, i, arr) => (
                            <span key={i}>
                                {line}
                                {i < arr.length - 1 ? <br /> : null}
                            </span>
                        ))}
                </span>
            );
        }
        case 'user':
            // El bundle público no tiene acceso al endpoint de lookup
            // de users (requiere admin caps). Mostramos el ID con un
            // prefijo para que sea evidente que es un user.
            return <span className="imcrm-public-list__empty-cell">@{String(value)}</span>;
        default:
            return <>{String(value)}</>;
    }
}

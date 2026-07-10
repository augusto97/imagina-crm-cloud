import { sanitizeHref } from '@/lib/sanitize';
import type { PortalFieldMeta, PortalRecord } from '../types';

interface Props {
    config: {
        visible_field_slugs?: string[];
        title?: string;
        variant?: 'definition_list' | 'cards';
    };
    record: PortalRecord;
    /**
     * Metadata de los fields de la lista del portal. Si no se
     * provee (templates antiguos antes de exponer `fields` en
     * `/portal/me`), el bloque cae al rendering legacy (slug crudo
     * como label, value como string). Una vez disponibles, los
     * usa para resolver labels reales, opciones de select y formatos.
     */
    fields?: PortalFieldMeta[];
}

/**
 * Bloque `client_data`. Muestra los campos del record cliente.
 *
 * Variantes:
 *  - `definition_list` (default) — `<dl>` denso label izq / valor der.
 *  - `cards` — grid 2-col, cada campo en su card propia.
 *
 * Rendering (con metadata disponible):
 *  - **Label**: `field.label` real, no el slug (`MES_FACTURADO` →
 *    `Mes facturado`).
 *  - **Select / multi-select**: el valor almacenado es el `value`
 *    de la opción (típicamente el slug); se busca en `config.options`
 *    para mostrar el `label` legible.
 *  - **Date / datetime**: formateados con `toLocaleDateString` del
 *    browser. `2025-11-25` → `25 nov 2025`.
 *  - **Currency**: con separadores de miles y prefijo de la moneda
 *    configurada en el field.
 *  - **URL**: anchor `<a target="_blank">`.
 *  - **Email**: anchor `<a href="mailto:">`.
 *  - **Checkbox**: ✓ / ✗.
 */
export function ClientDataBlock({ config, record, fields = [] }: Props): JSX.Element {
    const slugs = config.visible_field_slugs ?? [];
    const values = record.fields;
    const variant = config.variant ?? 'definition_list';

    const fieldsBySlug = new Map<string, PortalFieldMeta>();
    fields.forEach((f) => fieldsBySlug.set(f.slug, f));

    return (
        <section className="imcrm-portal-block imcrm-portal-block--client-data">
            <h2 className="imcrm-portal-block__title">{config.title ?? 'Mis datos'}</h2>
            {slugs.length === 0 ? (
                <p className="imcrm-portal-block__empty">
                    Este bloque no tiene campos configurados.
                </p>
            ) : variant === 'cards' ? (
                <div className="imcrm-portal-data-cards">
                    {slugs.map((slug) => {
                        const meta = fieldsBySlug.get(slug);
                        return (
                            <div key={slug} className="imcrm-portal-data-cards__item">
                                <p className="imcrm-portal-data-cards__label">
                                    {meta?.label ?? humanize(slug)}
                                </p>
                                <div className="imcrm-portal-data-cards__value">
                                    {renderValue(values[slug], meta)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <dl className="imcrm-portal-data-list">
                    {slugs.map((slug) => {
                        const meta = fieldsBySlug.get(slug);
                        return (
                            <div key={slug} className="imcrm-portal-data-list__item">
                                <dt className="imcrm-portal-data-list__label">
                                    {meta?.label ?? humanize(slug)}
                                </dt>
                                <dd className="imcrm-portal-data-list__value">
                                    {renderValue(values[slug], meta)}
                                </dd>
                            </div>
                        );
                    })}
                </dl>
            )}
        </section>
    );
}

/**
 * Fallback humanizado para cuando no hay metadata del field
 * (templates pre-0.57.4). Convierte `mes_facturado` → `Mes facturado`.
 */
function humanize(slug: string): string {
    const cleaned = slug.replace(/_/g, ' ').trim();
    if (cleaned === '') return slug;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Renderea un value usando el type/config del field cuando está
 * disponible. Sin metadata, cae al rendering tipo-genérico (legacy).
 */
function renderValue(value: unknown, meta: PortalFieldMeta | undefined): JSX.Element | string {
    if (value === null || value === undefined || value === '') {
        return <span className="imcrm-portal-data-list__empty">—</span>;
    }

    if (meta === undefined) {
        return renderGeneric(value);
    }

    switch (meta.type) {
        case 'select':
            return <span className="imcrm-portal-pill">{resolveOptionLabel(value, meta.config)}</span>;
        case 'multi_select': {
            const arr = Array.isArray(value) ? value : [];
            if (arr.length === 0) return <span className="imcrm-portal-data-list__empty">—</span>;
            return (
                <>
                    {arr.map((v, i) => (
                        <span key={i} className="imcrm-portal-pill">
                            {resolveOptionLabel(v, meta.config)}
                        </span>
                    ))}
                </>
            );
        }
        case 'date':
            return formatDate(value);
        case 'datetime':
            return formatDateTime(value);
        case 'currency':
            return formatCurrency(value, meta.config);
        case 'number':
            return formatNumber(value);
        case 'checkbox':
            return value === true || value === 1 || value === '1' ? '✓' : '✗';
        case 'url': {
            const url = String(value);
            return (
                <a href={sanitizeHref(url)} target="_blank" rel="noopener noreferrer">
                    {url}
                </a>
            );
        }
        case 'email': {
            const email = String(value);
            return <a href={`mailto:${email}`}>{email}</a>;
        }
        case 'long_text':
            // Preserva saltos de línea sin caer en innerHTML.
            return <span style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</span>;
        default:
            return renderGeneric(value);
    }
}

function renderGeneric(value: unknown): JSX.Element | string {
    if (Array.isArray(value)) {
        return (
            <>
                {value.map((v, i) => (
                    <span key={i} className="imcrm-portal-pill">
                        {String(v)}
                    </span>
                ))}
            </>
        );
    }
    if (value === true || value === 1 || value === '1') return '✓';
    if (value === false || value === 0 || value === '0') return '✗';
    return String(value);
}

/**
 * Para selects: el valor almacenado es el `value` de la opción
 * (típicamente el slug). Lo buscamos en `config.options` (array
 * con `{value, label}` o strings) y devolvemos el `label`. Si no
 * lo encontramos, devolvemos el value tal cual como fallback.
 */
function resolveOptionLabel(value: unknown, config: Record<string, unknown>): string {
    const str = String(value);
    const options = config.options;
    if (! Array.isArray(options)) return str;
    for (const opt of options) {
        if (typeof opt === 'string') {
            if (opt === str) return opt;
        } else if (opt !== null && typeof opt === 'object') {
            const o = opt as Record<string, unknown>;
            if (String(o.value ?? o.slug ?? '') === str) {
                return String(o.label ?? o.name ?? str);
            }
        }
    }
    return str;
}

function formatDate(value: unknown): string {
    const str = String(value);
    try {
        // Las fechas vienen como `YYYY-MM-DD`. Anclamos a mediodía
        // UTC para evitar shift de zona que mueva el día.
        const d = new Date(`${str}T12:00:00Z`);
        if (Number.isNaN(d.getTime())) return str;
        return d.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return str;
    }
}

function formatDateTime(value: unknown): string {
    const str = String(value);
    try {
        const iso = str.includes('T') ? str : str.replace(' ', 'T');
        const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
        if (Number.isNaN(d.getTime())) return str;
        return d.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return str;
    }
}

function formatCurrency(value: unknown, config: Record<string, unknown>): string {
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (! Number.isFinite(num)) return String(value);
    const currency = typeof config.currency === 'string' ? config.currency : 'USD';
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            maximumFractionDigits: 2,
        }).format(num);
    } catch {
        // Currency code inválido — fallback a formato decimal sin símbolo.
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(num);
    }
}

function formatNumber(value: unknown): string {
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (! Number.isFinite(num)) return String(value);
    return new Intl.NumberFormat(undefined).format(num);
}

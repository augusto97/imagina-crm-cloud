import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPage } from './api';
import { Cell } from './cellFormat';
import type {
    FetchParams,
    PublicFieldMeta,
    PublicInitialPayload,
    PublicListConfig,
    PublicRecord,
} from './types';

interface Props {
    config: PublicListConfig;
    initial: PublicInitialPayload;
    /** Columnas extraídas del HTML server-side (orden visible_field_slugs). */
    columns: PublicFieldMeta[];
}

/**
 * Componente principal de una lista pública (Fase 8 — 2.C).
 *
 * Hydratacion progresiva: el primer paint viene del HTML server-side
 * que renderizó el shortcode PHP (`Shortcode::render`). Cuando este
 * componente monta, reemplaza el HTML por el render React equivalente
 * — los user pueden ver datos correctos antes de que el JS cargue.
 *
 * Interactividad agregada:
 *   - Búsqueda con debounce (si `search_enabled=true`).
 *   - Sort por columna (si está en `sort_allowed_slugs`). Click alterna
 *     asc → desc → ninguno.
 *   - Paginación prev/next por número de página.
 *
 * Filtros por campo (filter[slug][op]=...) son out-of-scope para 2.C
 * — el shortcode los soporta a nivel API, pero la UI llega en una
 * iteración posterior (2.E o 10.x).
 */
export function PublicList({ config, initial, columns }: Props): JSX.Element {
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(1);
    const [sort, setSort] = useState<FetchParams['sort']>(parseDefaultSort(config.default_sort));
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [payload, setPayload] = useState<PublicInitialPayload>(initial);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fields filtrables: solo discretos por ahora (select / multi_select /
    // checkbox). Text/number requieren input + operator, scope futuro.
    const filterableColumns = config.viewer_filters
        ? columns.filter((c) => c.type === 'select' || c.type === 'multi_select' || c.type === 'checkbox')
        : [];

    // ¿La page-1 sin search y con el sort default es el "initial"?
    // Si sí, evitamos re-fetch (ahorramos un round-trip al primer
    // render). Solo aplica al primer effect, no a subsecuentes.
    const isInitialRequest = useRef(true);

    // Debounce del search input: el usuario tipea rápido, queremos
    // un solo fetch por palabra.
    useEffect(() => {
        const t = window.setTimeout(() => {
            setDebouncedSearch(search);
        }, 250);
        return () => window.clearTimeout(t);
    }, [search]);

    // Cuando cambia el search/sort/filtro, volvemos a página 1.
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, sort, filters]);

    // Fetcher central — sin TanStack Query.
    useEffect(() => {
        const isInitial = isInitialRequest.current;
        isInitialRequest.current = false;

        const hasActiveFilters = Object.values(filters).some((v) => v !== '');
        const isDefaultParams =
            page === 1 &&
            debouncedSearch === '' &&
            ! hasActiveFilters &&
            sortsEqual(sort, parseDefaultSort(config.default_sort));

        if (isInitial && isDefaultParams) {
            // Primer render con params default: ya tenemos los datos en
            // `payload` (vienen del server-side initial). No fetcheamos.
            return;
        }

        const ac = new AbortController();
        setLoading(true);
        setError(null);
        fetchPage(config, { page, search: debouncedSearch, sort, filters }, ac.signal)
            .then(({ payload: next }) => {
                setPayload(next);
                setLoading(false);
            })
            .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === 'AbortError') {
                    return;
                }
                const msg =
                    err instanceof Error && err.message === 'rate-limited'
                        ? 'Demasiadas solicitudes. Espera unos segundos.'
                        : 'No se pudieron cargar los datos.';
                setError(msg);
                setLoading(false);
            });
        return () => ac.abort();
    }, [config, page, debouncedSearch, sort, filters]);

    const toggleSort = useCallback(
        (slug: string) => {
            if (!config.sort_allowed_slugs.includes(slug)) return;
            setSort((current) => {
                if (current === null || current.slug !== slug) {
                    return { slug, dir: 'asc' };
                }
                if (current.dir === 'asc') return { slug, dir: 'desc' };
                return null;
            });
        },
        [config.sort_allowed_slugs],
    );

    const totalPages = payload.meta.total_pages || 1;
    const records = payload.data;

    return (
        <>
            {config.description !== null && config.description !== '' ? (
                <p className="imcrm-public-list__description">{config.description}</p>
            ) : null}

            {(config.search_enabled || config.sort_allowed_slugs.length > 0 || filterableColumns.length > 0) && (
                <div className="imcrm-public-list__toolbar">
                    {config.search_enabled ? (
                        <input
                            type="search"
                            className="imcrm-public-list__search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar…"
                            aria-label="Buscar en la lista"
                        />
                    ) : null}
                    {filterableColumns.map((col) => (
                        <FilterDropdown
                            key={col.slug}
                            column={col}
                            value={filters[col.slug] ?? ''}
                            onChange={(v) => setFilters((prev) => ({ ...prev, [col.slug]: v }))}
                        />
                    ))}
                    {Object.values(filters).some((v) => v !== '') && (
                        <button
                            type="button"
                            className="imcrm-public-list__clear-filters"
                            onClick={() => setFilters({})}
                            aria-label="Limpiar filtros"
                        >
                            Limpiar filtros
                        </button>
                    )}
                    {loading ? <span className="imcrm-public-list__loading">Cargando…</span> : null}
                </div>
            )}

            {error !== null ? (
                <p className="imcrm-public-list__error" role="alert">
                    {error}
                </p>
            ) : null}

            {records.length === 0 ? (
                <p className="imcrm-public-list__empty">No hay registros para mostrar.</p>
            ) : (
                <div className="imcrm-public-list__table-wrap">
                    <table className="imcrm-public-list__table">
                        <thead>
                            <tr>
                                {columns.map((col) => {
                                    const sortable = config.sort_allowed_slugs.includes(col.slug);
                                    const active = sort !== null && sort.slug === col.slug;
                                    return (
                                        <th key={col.slug} scope="col">
                                            {sortable ? (
                                                <button
                                                    type="button"
                                                    className="imcrm-public-list__sort-btn"
                                                    onClick={() => toggleSort(col.slug)}
                                                    aria-label={`Ordenar por ${col.label}`}
                                                >
                                                    {col.label}
                                                    <span aria-hidden className="imcrm-public-list__sort-indicator">
                                                        {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                                                    </span>
                                                </button>
                                            ) : (
                                                col.label
                                            )}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {records.map((rec) => (
                                <Row key={rec.id} record={rec} columns={columns} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {totalPages > 1 ? (
                <Pagination
                    page={payload.meta.page}
                    totalPages={totalPages}
                    onChange={setPage}
                />
            ) : (
                <Footer meta={payload.meta} />
            )}
        </>
    );
}

function FilterDropdown({
    column,
    value,
    onChange,
}: {
    column: PublicFieldMeta;
    value: string;
    onChange: (next: string) => void;
}): JSX.Element {
    // Para checkbox damos un toggle 3-estados (vacío/sí/no).
    if (column.type === 'checkbox') {
        return (
            <select
                className="imcrm-public-list__filter"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-label={`Filtrar por ${column.label}`}
            >
                <option value="">{column.label}: todos</option>
                <option value="1">{column.label}: sí</option>
                <option value="0">{column.label}: no</option>
            </select>
        );
    }

    const options = column.config?.options ?? [];
    if (options.length === 0) {
        return <></>;
    }

    return (
        <select
            className="imcrm-public-list__filter"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`Filtrar por ${column.label}`}
        >
            <option value="">{column.label}: todos</option>
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label ?? opt.value}
                </option>
            ))}
        </select>
    );
}

function Row({ record, columns }: { record: PublicRecord; columns: PublicFieldMeta[] }): JSX.Element {
    return (
        <tr>
            {columns.map((col) => (
                // `data-label` lo lee el CSS en mobile (≤ 639px) para mostrar
                // el label de columna a la izquierda y el valor a la derecha
                // (card layout estilo Linear/Notion).
                <td key={col.slug} data-label={col.label}>
                    <Cell value={extractValue(record, col)} col={col} />
                </td>
            ))}
        </tr>
    );
}

function Pagination({
    page,
    totalPages,
    onChange,
}: {
    page: number;
    totalPages: number;
    onChange: (p: number) => void;
}): JSX.Element {
    return (
        <nav className="imcrm-public-list__pagination" aria-label="Paginación">
            <button
                type="button"
                className="imcrm-public-list__page-btn"
                onClick={() => onChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                aria-label="Página anterior"
            >
                ← Anterior
            </button>
            <span className="imcrm-public-list__page-info">
                Página {page} de {totalPages}
            </span>
            <button
                type="button"
                className="imcrm-public-list__page-btn"
                onClick={() => onChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                aria-label="Página siguiente"
            >
                Siguiente →
            </button>
        </nav>
    );
}

function Footer({ meta }: { meta: PublicInitialPayload['meta'] }): JSX.Element {
    return (
        <nav className="imcrm-public-list__pagination">
            <span className="imcrm-public-list__total">
                {meta.total === 1 ? '1 registro' : `${meta.total} registros`}
            </span>
        </nav>
    );
}

function extractValue(record: PublicRecord, col: PublicFieldMeta): unknown {
    if (col.type === 'relation') {
        return record.relations?.[col.slug];
    }
    return record.fields?.[col.slug];
}

function parseDefaultSort(raw: string | null): FetchParams['sort'] {
    if (raw === null || raw === '') return null;
    const [slug, dir] = raw.split(':');
    if (slug === undefined || slug === '') return null;
    return { slug, dir: dir === 'desc' ? 'desc' : 'asc' };
}

function sortsEqual(a: FetchParams['sort'], b: FetchParams['sort']): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.slug === b.slug && a.dir === b.dir;
}

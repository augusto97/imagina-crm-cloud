import { useState } from 'react';
import { CheckCircle2, Database, Loader2, RefreshCw, Search, TriangleAlert, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    useApplyIndex,
    useDisableSearch,
    useDropIndex,
    useEnableSearch,
    useIndexSuggestions,
    useReindexSearch,
    useSearchStatus,
} from '@/hooks/useMaintenance';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface MaintenancePanelProps {
    listId: number;
}

/**
 * Panel "Mantenimiento" en la página de edición de una lista. Agrupa
 * dos features de Tier 3 (0.30.0):
 *
 *  1. Toggle de **búsqueda avanzada** (índice invertido + BM25). Activa
 *     un reindex inicial via Action Scheduler — el panel hace polling
 *     cada 5s para mostrar `doc_count` creciendo.
 *
 *  2. Lista de **índices compuestos sugeridos** derivados de las saved
 *     views. Cada uno se puede aplicar (CREATE INDEX) o dropear con un
 *     click. Apply es manual (cada índice cuesta storage + writes), no
 *     auto-aplicamos.
 */
export function MaintenancePanel({ listId }: MaintenancePanelProps): JSX.Element {
    return (
        <Card>
            <CardHeader className="imcrm-pb-3">
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                    <Zap className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                    {__('Mantenimiento y rendimiento')}
                </CardTitle>
                <CardDescription>
                    {__(
                        'Activa el motor de búsqueda con índice invertido (recomendado a partir de 50.000 registros) y aplica índices compuestos sugeridos para acelerar tus vistas.',
                    )}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-6 imcrm-pt-0">
                <SearchSection listId={listId} />
                <IndexSuggestionsSection listId={listId} />
            </CardContent>
        </Card>
    );
}

function SearchSection({ listId }: { listId: number }): JSX.Element {
    const status = useSearchStatus(listId);
    const enable = useEnableSearch(listId);
    const disable = useDisableSearch(listId);
    const reindex = useReindexSearch(listId);

    const enabled = status.data?.enabled ?? false;
    const docCount = status.data?.doc_count ?? 0;

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                        <Search className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Búsqueda avanzada')}
                        {enabled && (
                            <Badge variant="secondary" className="imcrm-text-[10px]">
                                {__('Activa')}
                            </Badge>
                        )}
                    </span>
                    <p className="imcrm-max-w-[640px] imcrm-text-xs imcrm-text-muted-foreground">
                        {__(
                            'Indexa el contenido de los campos de texto, email y URL. Reemplaza el LIKE por búsqueda con BM25 — más relevante y mucho más rápida en listas grandes. La indexación se mantiene automáticamente al crear, modificar o borrar registros.',
                        )}
                    </p>
                </div>
                <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-items-end imcrm-gap-1">
                    {status.isLoading ? (
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
                    ) : enabled ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => disable.mutate()}
                            disabled={disable.isPending}
                            className="imcrm-gap-1.5"
                        >
                            {disable.isPending && <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />}
                            {__('Desactivar')}
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            onClick={() => enable.mutate()}
                            disabled={enable.isPending}
                            className="imcrm-gap-1.5"
                        >
                            {enable.isPending ? (
                                <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                            ) : (
                                <Zap className="imcrm-h-3 imcrm-w-3" />
                            )}
                            {__('Activar')}
                        </Button>
                    )}
                </div>
            </header>

            {enabled && (
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2">
                    <div className="imcrm-flex imcrm-flex-col">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Documentos indexados')}
                        </span>
                        <span className="imcrm-font-mono imcrm-text-sm imcrm-font-medium">
                            {docCount.toLocaleString()}
                        </span>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => reindex.mutate()}
                        disabled={reindex.isPending}
                        className="imcrm-gap-1.5"
                        title={__('Re-indexar todos los registros desde cero')}
                    >
                        {reindex.isPending ? (
                            <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                        ) : (
                            <RefreshCw className="imcrm-h-3 imcrm-w-3" />
                        )}
                        {__('Re-indexar')}
                    </Button>
                </div>
            )}

            {(enable.isError || disable.isError || reindex.isError) && (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-destructive">
                    <TriangleAlert className="imcrm-h-3 imcrm-w-3" />
                    {(enable.error ?? disable.error ?? reindex.error)?.message}
                </p>
            )}
        </section>
    );
}

function IndexSuggestionsSection({ listId }: { listId: number }): JSX.Element {
    const suggestions = useIndexSuggestions(listId);
    const apply = useApplyIndex(listId);
    const drop = useDropIndex(listId);
    const [pendingName, setPendingName] = useState<string | null>(null);

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Database className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Índices compuestos sugeridos')}
                </span>
                <p className="imcrm-max-w-[640px] imcrm-text-xs imcrm-text-muted-foreground">
                    {__(
                        'Derivados de las vistas guardadas. Si una vista filtra por A y ordena por B, sugerimos un índice compuesto (A, B) — MySQL salta directo a las filas matcheables y sirve el ORDER BY desde el índice. Cada índice cuesta ~10% de storage y lentifica writes ~5%.',
                    )}
                </p>
            </header>

            {suggestions.isLoading ? (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                    {__('Calculando…')}
                </div>
            ) : (suggestions.data ?? []).length === 0 ? (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">
                    {__(
                        'Sin sugerencias por ahora. Crea vistas guardadas con filtros + sort para que el sistema pueda recomendar índices.',
                    )}
                </p>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {suggestions.data!.map((s) => {
                        const busy = pendingName === s.index_name && (apply.isPending || drop.isPending);
                        return (
                            <li
                                key={s.index_name}
                                className={cn(
                                    'imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2.5',
                                    s.already_exists && 'imcrm-bg-success/5 imcrm-border-success/40',
                                )}
                            >
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
                                    <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5 imcrm-overflow-hidden">
                                        <code className="imcrm-truncate imcrm-font-mono imcrm-text-xs imcrm-font-semibold">
                                            {s.columns.join(' + ')}
                                        </code>
                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {s.reason} ·{' '}
                                            {sprintf(
                                                /* translators: %d uses count */
                                                __('%d vista(s) lo justifican'),
                                                s.uses,
                                            )}
                                        </span>
                                    </div>
                                    <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2">
                                        {s.already_exists ? (
                                            <>
                                                <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-success">
                                                    <CheckCircle2 className="imcrm-h-3 imcrm-w-3" />
                                                    {__('Aplicado')}
                                                </span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={busy}
                                                    onClick={() => {
                                                        setPendingName(s.index_name);
                                                        drop.mutate(s.index_name);
                                                    }}
                                                >
                                                    {busy && drop.isPending ? (
                                                        <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                                                    ) : (
                                                        __('Quitar')
                                                    )}
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                size="sm"
                                                disabled={busy}
                                                onClick={() => {
                                                    setPendingName(s.index_name);
                                                    apply.mutate({ columns: s.columns, indexName: s.index_name });
                                                }}
                                                className="imcrm-gap-1.5"
                                            >
                                                {busy && apply.isPending ? (
                                                    <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                                                ) : (
                                                    <Zap className="imcrm-h-3 imcrm-w-3" />
                                                )}
                                                {__('Aplicar')}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {(apply.isError || drop.isError) && (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-destructive">
                    <TriangleAlert className="imcrm-h-3 imcrm-w-3" />
                    {(apply.error ?? drop.error)?.message}
                </p>
            )}
        </section>
    );
}

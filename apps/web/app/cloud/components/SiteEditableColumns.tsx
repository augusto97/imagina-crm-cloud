import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowLeftRight, Globe } from 'lucide-react';
import type { SiteSyncObjectState, SiteSyncStatus } from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { listsKeys } from '@/hooks/useLists';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';

/**
 * «Columnas que se editan desde la app» de un sitio WordPress (v0.1.333,
 * ADR-S83): por tipo de contenido, qué columnas del sitio se pueden cambiar
 * desde aquí (y viajan a WordPress). Se muestra en la página del sitio y en
 * Ajustes → Campos de cada lista: la misma elección vista desde dos lugares.
 * Lo que WordPress calcula (el enlace, la fecha de modificación, el autor)
 * no aparece: no se puede habilitar.
 */
export function SiteEditableColumns({
    object,
    busy,
    onToggle,
}: {
    object: SiteSyncObjectState;
    busy: boolean;
    /** Prende o apaga UNA columna (el servidor lo aplica sobre lo guardado). */
    onToggle: (key: string, on: boolean) => void;
}): JSX.Element {
    // Optimista: el tilde se mueve al tocarlo (lección de v0.1.207).
    const [local, setLocal] = useState<Record<string, boolean>>({});
    useEffect(() => {
        if (!busy) setLocal({});
    }, [busy]);
    const options = object.columns.filter((c) => c.can_edit && c.field_id !== null);
    if (options.length === 0) {
        return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Ninguna de las columnas que se traen se puede editar desde aquí.')}</p>;
    }
    return (
        <div className="imcrm-grid imcrm-gap-1.5 sm:imcrm-grid-cols-2" data-testid={`imcrm-site-editable-${object.resource}`}>
            {options.map((c) => {
                const checked = local[c.key] ?? c.editable;
                return (
                    <label key={c.key} className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-accent-[hsl(var(--imcrm-primary))]"
                            checked={checked}
                            onChange={(e) => {
                                const on = e.target.checked;
                                setLocal((prev) => ({ ...prev, [c.key]: on }));
                                onToggle(c.key, on);
                            }}
                            data-testid={`imcrm-site-editable-${object.resource}-${c.key}`}
                        />
                        <span className="imcrm-min-w-0">
                            <span className="imcrm-block imcrm-leading-tight">{c.label}</span>
                            {c.hint && <span className="imcrm-block imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{c.hint}</span>}
                        </span>
                    </label>
                );
            })}
        </div>
    );
}

/**
 * La misma elección, dentro de Ajustes → Campos de una lista del sitio: trae
 * el estado de la sincronización y guarda sólo esa lista.
 */
export function SiteEditableColumnsCard({ connectionId, resource }: { connectionId: number; resource: string }): JSX.Element | null {
    const qc = useQueryClient();
    const key = ['site-sync', connectionId];
    const status = useQuery({ queryKey: key, queryFn: () => api.siteSyncStatus(connectionId), refetchOnMount: 'always', retry: false });
    const [error, setError] = useState<string | null>(null);
    const update = useMutation({
        mutationFn: (t: { key: string; on: boolean }) => api.siteSyncUpdate(connectionId, { editable_toggle: { resource, key: t.key, on: t.on } }),
        onSuccess: (s: SiteSyncStatus) => {
            qc.setQueryData(key, s);
            // La marca de la lista cambia: candados de las celdas y del encabezado.
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            setError(null);
        },
        onError: (err) => setError(err instanceof CloudApiError || err instanceof Error ? err.message : String(err)),
    });
    const s = status.data;
    const object = s?.configured ? s.objects.find((o) => o.resource === resource) : undefined;
    if (!s || !object) return null;
    return (
        <section className="imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-site-editable-card">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    <h3 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                        <Globe className="imcrm-h-4 imcrm-w-4 imcrm-text-[#21759B] dark:imcrm-text-[#5BA9D6]" aria-hidden />
                        {__('Columnas que se editan desde la app')}
                    </h3>
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Lo que marques se puede cambiar desde esta lista y el cambio viaja a WordPress. Lo demás se sigue editando en el sitio.')}
                    </p>
                </div>
                <Link to={`/settings/sites/${connectionId}`} className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline">
                    {__('Ajustes del sitio')}
                </Link>
            </div>
            {!s.write_back && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs" data-testid="imcrm-site-editable-off">
                    <ArrowLeftRight className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                    <span>
                        {__('«Editar desde la app» está apagado en este sitio: hasta que lo actives, todas sus columnas son de sólo lectura.')}{' '}
                        <Link to={`/settings/sites/${connectionId}`} className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                            {__('Activarlo')}
                        </Link>
                    </span>
                </p>
            )}
            <SiteEditableColumns object={object} busy={update.isPending} onToggle={(k, on) => update.mutate({ key: k, on })} />
            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
        </section>
    );
}

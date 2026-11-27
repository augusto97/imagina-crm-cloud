import { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { countListFeatures, LIST_FEATURE_KEYS, readListFeatures, type ListFeatureKey, type ListFeatures } from '@imagina-base/shared';

import { useToast } from '@/components/ui/toast';
import { useUpdateList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import type { ListSummary } from '@/types/list';
import { SwitchRow } from '@/admin/widgets/widgetUi';

import { LIST_FEATURE_CATALOG } from './listFeatureCatalog';

/**
 * v0.1.475 (ADR-S115) — Configuración de la lista → Funciones.
 *
 * Cada interruptor enciende o apaga una función de la ficha para ESTA lista.
 * Apagar la esconde de la ficha, la tabla y los menús; nunca borra datos, y al
 * encenderla vuelve todo. El cambio es optimista (el interruptor se mueve al
 * tocarlo) y se guarda solo: cada toque manda sólo esa función, así dos
 * cambios seguidos no se pisan.
 */
export function ListFeaturesPanel({ list }: { list: ListSummary }): JSX.Element {
    const toast = useToast();
    const update = useUpdateList(list.id);
    const canEdit = useCan(CAP.MANAGE_LISTS);
    const server = useMemo(() => readListFeatures(list.settings), [list.settings]);
    // Lo que se tocó y todavía no volvió del servidor.
    const [pending, setPending] = useState<Partial<ListFeatures>>({});

    useEffect(() => {
        setPending((p) => {
            let changed = false;
            const next: Partial<ListFeatures> = { ...p };
            for (const key of LIST_FEATURE_KEYS) {
                if (next[key] !== undefined && next[key] === server[key]) {
                    delete next[key];
                    changed = true;
                }
            }
            return changed ? next : p;
        });
    }, [server]);

    const features: ListFeatures = { ...server, ...pending };
    const on = countListFeatures(features);

    const toggle = (key: ListFeatureKey, value: boolean): void => {
        setPending((p) => ({ ...p, [key]: value }));
        update.mutate(
            { settings: { features: { [key]: value } } },
            {
                onError: (err) => {
                    setPending((p) => {
                        const next = { ...p };
                        delete next[key];
                        return next;
                    });
                    toast.error(err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar el cambio.'));
                },
            },
        );
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-tour="list-settings-features" data-testid="list-features-panel">
            <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-[12.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                <Info className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                <p>
                    {__('Apagar una función la esconde de esta lista: de la ficha, de la tabla y de los menús. Nunca se borra nada: al volver a encenderla, todo aparece como estaba.')}
                </p>
            </div>

            <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground" data-testid="list-features-count">
                {sprintf(__('%1$d de %2$d encendidas'), on, LIST_FEATURE_KEYS.length)}
            </p>

            <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-xl imcrm-border imcrm-border-border">
                {LIST_FEATURE_CATALOG.map((f) => (
                    <div key={f.key} className="imcrm-p-3" data-testid={`list-feature-${f.key}`}>
                        <SwitchRow
                            label={f.label}
                            icon={f.icon}
                            checked={features[f.key]}
                            onChange={(v) => toggle(f.key, v)}
                            disabled={!canEdit}
                            testId={`list-feature-toggle-${f.key}`}
                            hint={
                                <>
                                    {f.hint}
                                    {f.offNote && (
                                        <span className="imcrm-mt-1 imcrm-block imcrm-text-muted-foreground/90">{f.offNote}</span>
                                    )}
                                </>
                            }
                        />
                    </div>
                ))}
            </div>

            {!canEdit && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Las cambia quien administra las listas.')}
                </p>
            )}
        </div>
    );
}

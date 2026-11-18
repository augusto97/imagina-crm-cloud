import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    INTEGRATION_CATEGORY_LABEL,
    integrationDef,
    type IntegrationCategory,
    type IntegrationKey,
    type PlatformIntegrationCatalogItem,
    type UpdateIntegrationCatalogInput,
} from '@imagina-base/shared';
import { Eye, EyeOff, LayoutGrid, Loader2, RotateCcw } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

const CATALOG_KEY = ['platform-integrations', 'catalog'] as const;

/**
 * v0.1.438 — Plataforma → Integraciones → «Apps que ven las empresas»: qué apps
 * se ofrecen para conectar y cuáles van marcadas «Beta». Ocultar una no corta
 * las conexiones que ya existen: sólo deja de ofrecerla para una nueva.
 */
export function PlatformIntegrationCatalogCard(): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const q = useQuery({ queryKey: CATALOG_KEY, queryFn: () => api.platformIntegrationCatalogGet(), retry: false });
    const save = useMutation({
        mutationFn: (v: { key: IntegrationKey; input: UpdateIntegrationCatalogInput }) => api.platformIntegrationCatalogSet(v.key, v.input),
        // Optimista: el interruptor se mueve al tocarlo (lección de v0.1.207).
        onMutate: async ({ key, input }) => {
            await qc.cancelQueries({ queryKey: CATALOG_KEY });
            const prev = qc.getQueryData<PlatformIntegrationCatalogItem[]>(CATALOG_KEY);
            qc.setQueryData<PlatformIntegrationCatalogItem[]>(CATALOG_KEY, (old) =>
                (old ?? []).map((i) =>
                    i.key !== key
                        ? i
                        : {
                              ...i,
                              hidden: input.hidden === undefined ? i.hidden : input.hidden ?? i.hidden_default,
                              stage: i.stage === 'retiring' || input.beta === undefined ? i.stage : (input.beta ?? i.beta_default) ? 'beta' : 'stable',
                          },
                ),
            );
            return { prev };
        },
        onError: (e, _v, ctx) => {
            if (ctx?.prev) qc.setQueryData(CATALOG_KEY, ctx.prev);
            toast.error(__('No se pudo guardar'), e instanceof Error ? e.message : undefined);
        },
        onSuccess: (item) => {
            qc.setQueryData<PlatformIntegrationCatalogItem[]>(CATALOG_KEY, (old) => (old ?? []).map((i) => (i.key === item.key ? item : i)));
        },
    });

    const groups = useMemo(() => {
        const out = new Map<IntegrationCategory, PlatformIntegrationCatalogItem[]>();
        for (const item of q.data ?? []) {
            const def = integrationDef(item.key);
            if (!def) continue;
            const list = out.get(def.category) ?? [];
            list.push(item);
            out.set(def.category, list);
        }
        return [...out.entries()];
    }, [q.data]);

    const shown = (q.data ?? []).filter((i) => !i.hidden).length;

    return (
        <Card data-testid="platform-integration-catalog" data-tour="platform-integration-catalog">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <LayoutGrid className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Apps que ven las empresas')}</CardTitle>
                        <CardDescription>
                            {__('Elige qué apps se ofrecen para conectar y cuáles van marcadas «Beta» (todavía sin probar con una cuenta real). Ocultar una no corta las conexiones que ya existen: sólo deja de ofrecerla para una nueva.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                {q.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando…')}
                    </div>
                ) : q.isError ? (
                    <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar la lista de apps.')}</p>
                ) : (
                    <>
                        <p className="imcrm-text-sm" data-testid="catalog-summary">
                            <span className="imcrm-font-semibold">{shown}</span> {__('de')} {q.data?.length ?? 0} {__('apps se ofrecen a las empresas.')}
                        </p>
                        {groups.map(([category, items]) => (
                            <section key={category} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    {__(INTEGRATION_CATEGORY_LABEL[category])}
                                </h3>
                                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                                    {items.map((item) => (
                                        <CatalogRow
                                            key={item.key}
                                            item={item}
                                            busy={save.isPending && save.variables?.key === item.key}
                                            onChange={(input) => save.mutate({ key: item.key, input })}
                                        />
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function CatalogRow({
    item,
    busy,
    onChange,
}: {
    item: PlatformIntegrationCatalogItem;
    busy: boolean;
    onChange: (input: UpdateIntegrationCatalogInput) => void;
}): JSX.Element {
    const def = integrationDef(item.key);
    const replacement = item.replacement ? integrationDef(item.replacement)?.name : null;
    return (
        <li className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-px-3 imcrm-py-2.5" data-catalog-key={item.key}>
            <IntegrationLogo integrationKey={item.key} size={28} />
            <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-basis-48">
                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                    {def?.name ?? item.key}
                    {item.stage === 'beta' && (
                        <Badge variant="warning" className="imcrm-text-[10px]">
                            {__('Beta')}
                        </Badge>
                    )}
                    {item.stage === 'retiring' && (
                        <Badge variant="secondary" className="imcrm-text-[10px]">
                            {__('Se retira')}
                        </Badge>
                    )}
                    {item.hidden && (
                        <Badge variant="outline" className="imcrm-gap-1 imcrm-text-[10px]">
                            <EyeOff className="imcrm-h-3 imcrm-w-3" aria-hidden />
                            {__('Oculta')}
                        </Badge>
                    )}
                </p>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {item.tenants === 0
                        ? __('Ninguna empresa la tiene conectada.')
                        : `${formatNumber(item.tenants)} ${item.tenants === 1 ? __('empresa') : __('empresas')} · ${formatNumber(item.connections)} ${item.connections === 1 ? __('conexión') : __('conexiones')}`}
                    {replacement && ` · ${__('Se reemplaza por')} ${replacement}`}
                </p>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-4 imcrm-gap-y-1.5">
                <Toggle
                    label={__('Mostrar')}
                    checked={!item.hidden}
                    disabled={busy}
                    onChange={(v) => onChange({ hidden: !v })}
                    testId="catalog-show"
                    icon={item.hidden ? EyeOff : Eye}
                />
                {item.stage !== 'retiring' && (
                    <Toggle label={__('Beta')} checked={item.stage === 'beta'} disabled={busy} onChange={(v) => onChange({ beta: v })} testId="catalog-beta" />
                )}
                {item.customized && (
                    <button
                        type="button"
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                        disabled={busy}
                        onClick={() => onChange({ hidden: null, beta: null })}
                        title={__('Volver a lo que trae la app de fábrica')}
                        data-testid="catalog-reset"
                    >
                        <RotateCcw className="imcrm-h-3 imcrm-w-3" aria-hidden />
                        {__('De fábrica')}
                    </button>
                )}
            </div>
        </li>
    );
}

function Toggle({
    label,
    checked,
    disabled,
    onChange,
    testId,
    icon: Icon,
}: {
    label: string;
    checked: boolean;
    disabled: boolean;
    onChange: (v: boolean) => void;
    testId: string;
    icon?: typeof Eye;
}): JSX.Element {
    return (
        <label className={cn('imcrm-inline-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-text-xs', disabled && 'imcrm-opacity-60')}>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                disabled={disabled}
                onClick={() => onChange(!checked)}
                data-testid={testId}
                className={cn(
                    'imcrm-relative imcrm-inline-flex imcrm-h-5 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-rounded-full imcrm-transition-colors focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
                    checked ? 'imcrm-bg-primary' : 'imcrm-bg-muted-foreground/30',
                )}
            >
                <span
                    className={cn(
                        'imcrm-inline-block imcrm-h-4 imcrm-w-4 imcrm-rounded-full imcrm-bg-white imcrm-shadow imcrm-transition-transform',
                        checked ? 'imcrm-translate-x-[18px]' : 'imcrm-translate-x-0.5',
                    )}
                />
            </button>
            {Icon && <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />}
            {label}
        </label>
    );
}

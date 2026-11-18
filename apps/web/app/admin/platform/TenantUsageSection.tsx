import { BarChart3 } from 'lucide-react';
import { USAGE_DAYS, USAGE_MODULES } from '@imagina-base/shared';

import { usePlatformTenantUsage } from '@/hooks/usePlatformUsage';
import { __ } from '@/lib/i18n';

import { agoText } from './serverWatch';
import { countText } from './usageView';

/**
 * v0.1.437 — En la ficha de una empresa de la consola: qué módulos usa y
 * cuánto (lo mismo que Plataforma → Uso, visto desde la empresa).
 */
export function TenantUsageSection({ tenantId }: { tenantId: number }): JSX.Element | null {
    const usage = usePlatformTenantUsage(tenantId);
    if (usage.isLoading || usage.isError || !usage.data) return null;
    const byKey = new Map(usage.data.modules.map((m) => [m.key, m]));
    const rows = USAGE_MODULES.filter((info) => byKey.has(info.key)).map((info) => ({ info, data: byKey.get(info.key)! }));
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="tenant-usage">
            <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                <BarChart3 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden /> {__('Qué usa')} ({rows.length})
            </h3>
            {rows.length === 0 ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Todavía no usa ningún módulo.')}</p>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                    {rows.map(({ info, data }) => (
                        <li key={info.key} className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-px-3 imcrm-py-2" data-tenant-usage={info.key}>
                            <span className="imcrm-text-sm imcrm-font-medium">{__(info.label)}</span>
                            <span className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-text-xs imcrm-text-muted-foreground">
                                {info.total_label !== null && <span>{countText(data.total, __(info.total_label))}</span>}
                                {info.activity_label !== null && data.activity !== null && (
                                    <span>
                                        {countText(data.activity, __(info.activity_label))}
                                        {!info.activity_month && ` ${__('en')} ${USAGE_DAYS} ${__('días')}`}
                                    </span>
                                )}
                                {data.last_at && (
                                    <span>
                                        {__('Último uso')} {agoText(data.last_at)}
                                    </span>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

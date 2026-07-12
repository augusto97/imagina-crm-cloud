import { History, Loader2 } from 'lucide-react';

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { useImpersonations } from '@/hooks/usePlatform';
import { __ } from '@/lib/i18n';

/** Log de auditoría de impersonación (ADR-S15 F5): transparencia para el operador. */
export function PlatformImpersonationsCard(): JSX.Element {
    const log = useImpersonations();

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <History className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Auditoría de impersonación')}</CardTitle>
                        <CardDescription>
                            {__('Quién entró como quién y cuándo. Toda sesión de soporte queda registrada acá.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {log.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-4 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando…')}
                    </div>
                ) : (log.data ?? []).length === 0 ? (
                    <p className="imcrm-py-4 imcrm-text-sm imcrm-text-muted-foreground">{__('Sin impersonaciones registradas.')}</p>
                ) : (
                    <div className="imcrm-overflow-x-auto">
                        <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                            <thead>
                                <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-xs imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                    <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Operador')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Usuario')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Inicio')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Fin')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(log.data ?? []).map((e) => (
                                    <tr key={e.id} className="imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0">
                                        <td className="imcrm-py-2 imcrm-pr-3">
                                            <span className="imcrm-font-medium">{e.actor_name}</span>{' '}
                                            <span className="imcrm-text-xs imcrm-text-muted-foreground">{e.actor_email}</span>
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2">
                                            <span className="imcrm-font-medium">{e.target_name}</span>{' '}
                                            <span className="imcrm-text-xs imcrm-text-muted-foreground">{e.target_email}</span>
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2 imcrm-text-muted-foreground imcrm-whitespace-nowrap">
                                            {new Date(e.started_at).toLocaleString()}
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2 imcrm-whitespace-nowrap">
                                            {e.ended_at ? (
                                                <span className="imcrm-text-muted-foreground">{new Date(e.ended_at).toLocaleString()}</span>
                                            ) : (
                                                <span className="imcrm-rounded-full imcrm-bg-amber-500/10 imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium imcrm-text-amber-600 dark:imcrm-text-amber-400">
                                                    {__('activa')}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

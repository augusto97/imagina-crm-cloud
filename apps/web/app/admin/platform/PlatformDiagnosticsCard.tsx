import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CircleAlert, CircleCheck, Loader2, Mail, RefreshCw, Trash2 } from 'lucide-react';
import type { MailLogEntry, MailVia, ServerErrorEntry } from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * v0.1.238 — Plataforma → Diagnóstico. Responde, sin entrar al servidor:
 *  - ¿los correos de cuenta (verificación, recuperación, invitaciones) tienen
 *    por dónde salir?
 *  - ¿qué pasó con cada correo? (enviado, falló con tal motivo, o no salió
 *    porque no hay SMTP);
 *  - ¿qué fueron esos "Error interno"? (los errores inesperados, agrupados).
 */
const VIA_LABEL: Record<MailVia, string> = {
    tenant_smtp: 'SMTP de la empresa',
    tenant_account: 'Cuenta de Google/Microsoft de la empresa',
    platform_smtp: 'SMTP de plataforma',
    server_smtp: 'SMTP del servidor (.env)',
    none: 'Sin SMTP',
};

export function PlatformDiagnosticsCard(): JSX.Element {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const q = useQuery({ queryKey: ['platform-diagnostics'], queryFn: () => api.diagnosticsGet(), refetchInterval: 30_000 });
    const clear = useMutation({
        mutationFn: () => api.diagnosticsClear(),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform-diagnostics'] }),
    });
    const [mailFilter, setMailFilter] = useState<'all' | 'problems' | 'account'>('all');

    const mail = useMemo(() => {
        const rows = q.data?.mail ?? [];
        if (mailFilter === 'problems') return rows.filter((m) => m.status !== 'sent');
        if (mailFilter === 'account') return rows.filter((m) => m.scope === 'account');
        return rows;
    }, [q.data?.mail, mailFilter]);
    const errors = useMemo(() => groupErrors(q.data?.errors ?? []), [q.data?.errors]);

    if (q.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-6 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando el diagnóstico…')}
            </p>
        );
    }
    if (q.isError || !q.data) {
        return <p className="imcrm-p-6 imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar el diagnóstico.')}</p>;
    }
    const account = q.data.account_mail;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="platform-diagnostics">
            <Card>
                <CardHeader>
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                                <Mail className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            </span>
                            <div>
                                <CardTitle>{__('Correos de cuenta')}</CardTitle>
                                <CardDescription>
                                    {__('Verificación del email, recuperación de contraseña e invitaciones. No son de ninguna empresa: salen por el SMTP de la plataforma.')}
                                </CardDescription>
                            </div>
                        </div>
                        <Badge dot variant={account.available ? 'success' : 'destructive'} className="imcrm-shrink-0" data-testid="account-mail-status">
                            {account.available ? __('Se envían') : __('No se envían')}
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="imcrm-pt-0 imcrm-text-sm">
                    {account.available ? (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-muted-foreground">
                            <CircleCheck className="imcrm-h-4 imcrm-w-4 imcrm-text-emerald-600" aria-hidden />
                            {__('Salen por')} {VIA_LABEL[account.via]}
                            {account.host ? ` (${account.host})` : ''}.
                        </p>
                    ) : (
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-rose-500/30 imcrm-bg-rose-500/10 imcrm-p-3 imcrm-text-rose-900 dark:imcrm-text-rose-200">
                            <CircleAlert className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <span>{account.reason}</span>
                                <Link to="/platform?tab=correo" className="imcrm-font-medium imcrm-underline">
                                    {__('Configurar el correo de la plataforma')}
                                </Link>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <div>
                            <CardTitle>{__('Correos recientes')}</CardTitle>
                            <CardDescription>{__('Cada intento de envío del servidor, con por dónde salió y qué pasó. Los reintentos aparecen como intentos aparte.')}</CardDescription>
                        </div>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1" role="group" aria-label={__('Filtrar correos')}>
                            {(
                                [
                                    ['all', __('Todos')],
                                    ['problems', __('Con problemas')],
                                    ['account', __('De cuenta')],
                                ] as const
                            ).map(([id, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setMailFilter(id)}
                                    className={cn(
                                        'imcrm-rounded-md imcrm-px-2.5 imcrm-py-1 imcrm-text-xs',
                                        mailFilter === id ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                    )}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="imcrm-pt-0">
                    {mail.length === 0 ? (
                        <p className="imcrm-py-4 imcrm-text-sm imcrm-text-muted-foreground">{__('Todavía no hay correos registrados.')}</p>
                    ) : (
                        <ul className="imcrm-divide-y imcrm-divide-border" data-testid="mail-log">
                            {mail.map((m, i) => (
                                <MailRow key={`${m.at}-${i}`} entry={m} />
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                                <Activity className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            </span>
                            <div>
                                <CardTitle>{__('Errores del servidor')}</CardTitle>
                                <CardDescription>{__('Lo que una persona ve como «Error interno», con dónde pasó. Los iguales se agrupan.')}</CardDescription>
                            </div>
                        </div>
                        <div className="imcrm-flex imcrm-gap-2">
                            <Button variant="ghost" size="sm" className="imcrm-gap-1.5" onClick={() => void q.refetch()}>
                                <RefreshCw className={cn('imcrm-h-3.5 imcrm-w-3.5', q.isFetching && 'imcrm-animate-spin')} />
                                {__('Actualizar')}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="imcrm-gap-1.5"
                                disabled={clear.isPending}
                                onClick={async () => {
                                    const ok = await confirm({
                                        title: __('¿Limpiar el diagnóstico?'),
                                        description: __('Se borran los correos y errores registrados. Lo que pase desde ahora se vuelve a anotar.'),
                                        confirmLabel: __('Limpiar'),
                                    });
                                    if (ok) clear.mutate();
                                }}
                            >
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Limpiar')}
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="imcrm-pt-0">
                    {errors.length === 0 ? (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-4 imcrm-text-sm imcrm-text-muted-foreground">
                            <CircleCheck className="imcrm-h-4 imcrm-w-4 imcrm-text-emerald-600" aria-hidden />
                            {__('Sin errores registrados.')}
                        </p>
                    ) : (
                        <ul className="imcrm-divide-y imcrm-divide-border" data-testid="error-log">
                            {errors.map((e) => (
                                <li key={e.key} className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-py-2.5 imcrm-text-sm">
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                        <Badge variant={e.entry.source === 'request' ? 'destructive' : 'secondary'}>
                                            {e.entry.source === 'request' ? __('Pedido') : e.entry.source === 'database' ? __('Base de datos') : __('Proceso')}
                                        </Badge>
                                        {e.entry.path && (
                                            <code className="imcrm-text-xs imcrm-text-muted-foreground">
                                                {e.entry.method} {e.entry.path}
                                            </code>
                                        )}
                                        <span className="imcrm-ml-auto imcrm-text-xs imcrm-text-muted-foreground">
                                            {e.count > 1 ? `${e.count} ${__('veces')} · ${__('última')} ` : ''}
                                            {formatDateTimeStr(e.entry.at)}
                                        </span>
                                    </div>
                                    <span className="imcrm-break-words">{e.entry.message}</span>
                                    {e.entry.detail && (
                                        <details className="imcrm-text-xs imcrm-text-muted-foreground">
                                            <summary className="imcrm-cursor-pointer">{__('Detalle técnico')}</summary>
                                            <pre className="imcrm-mt-1 imcrm-whitespace-pre-wrap imcrm-break-all">{e.entry.detail}</pre>
                                        </details>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function MailRow({ entry }: { entry: MailLogEntry }): JSX.Element {
    const tone = entry.status === 'sent' ? 'success' : entry.status === 'not_sent' ? 'warning' : 'destructive';
    const label = entry.status === 'sent' ? __('Enviado') : entry.status === 'not_sent' ? __('No enviado') : __('Falló');
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-py-2.5 imcrm-text-sm" data-mail-status={entry.status}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Badge dot variant={tone}>{label}</Badge>
                <span className="imcrm-min-w-0 imcrm-truncate imcrm-font-medium">{entry.subject}</span>
                <span className="imcrm-ml-auto imcrm-text-xs imcrm-text-muted-foreground">{formatDateTimeStr(entry.at)}</span>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-text-xs imcrm-text-muted-foreground">
                <span>
                    {__('Para')} {entry.to}
                </span>
                <span>{entry.scope === 'account' ? __('Correo de cuenta') : `${__('Empresa')} #${entry.tenant_id ?? '—'}`}</span>
                <span>{VIA_LABEL[entry.via]}</span>
            </div>
            {entry.error && <span className="imcrm-text-xs imcrm-text-rose-700 dark:imcrm-text-rose-300">{entry.error}</span>}
        </li>
    );
}

/** Agrupa errores iguales (mismo origen, ruta y mensaje) mostrando el más reciente. */
function groupErrors(rows: ServerErrorEntry[]): Array<{ key: string; entry: ServerErrorEntry; count: number }> {
    const map = new Map<string, { key: string; entry: ServerErrorEntry; count: number }>();
    for (const r of rows) {
        const key = `${r.source}|${r.method ?? ''}|${(r.path ?? '').replace(/\/\d+(?=\/|$)/g, '/:id')}|${r.message}`;
        const hit = map.get(key);
        if (hit) hit.count += 1;
        else map.set(key, { key, entry: r, count: 1 });
    }
    return [...map.values()];
}

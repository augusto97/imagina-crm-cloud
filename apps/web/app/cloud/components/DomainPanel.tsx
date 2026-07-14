import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customDomainInputSchema, type DomainDnsReport } from '@imagina-base/shared';
import { Check, Copy, Globe } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { CloudApiError } from '@/lib/cloud/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const DNS_STATUS_META: Record<
    DomainDnsReport['status'],
    { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
    ok: { label: 'Configurado', variant: 'success' },
    partial: { label: 'Parcial', variant: 'warning' },
    missing: { label: 'Falta', variant: 'destructive' },
    unknown: { label: 'Desconocido', variant: 'secondary' },
};

/** Mensajes claros para los errores tipados del backend (ADR-S17). */
function saveErrorText(e: unknown): string {
    if (e instanceof CloudApiError) {
        if (e.code === 'domain_reserved') {
            return 'Ese dominio está reservado por la plataforma: usá un dominio propio (ej. crm.tuempresa.com).';
        }
        if (e.code === 'domain_taken') {
            return 'Ese dominio ya está en uso por otra empresa.';
        }
        return e.message;
    }
    return 'No se pudo guardar el dominio.';
}

/**
 * Card "Dominio personalizado" de Ajustes → Marca (ADR-S17, white-label
 * completo): la empresa accede a la app por su subdominio incluido
 * (`slug.base`, automático) o por su propio dominio (CNAME hacia la
 * plataforma + certificado on-demand). Sólo admin (misma sección gateada que
 * la card de Marca; el backend igualmente exige admin en las mutaciones).
 * "Verificar DNS" resuelve el apuntamiento en vivo, mismo patrón que los
 * registros SPF/DKIM/DMARC del panel SMTP.
 */
export function DomainPanel(): JSX.Element | null {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const domainQ = useQuery({
        queryKey: ['tenant-domain', tenantId],
        queryFn: () => api.tenantDomainGet(),
        retry: false,
    });

    const [domainInput, setDomainInput] = useState('');
    const [copied, setCopied] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // Rehidratar el input cuando llega (o cambia) el estado del dominio.
    useEffect(() => {
        if (domainQ.data) setDomainInput(domainQ.data.domain ?? '');
    }, [domainQ.data]);

    const invalidate = (): void => {
        void qc.invalidateQueries({ queryKey: ['tenant-domain', tenantId] });
        // El reporte DNS quedó atado al dominio anterior: se descarta.
        qc.removeQueries({ queryKey: ['tenant-domain-dns', tenantId] });
    };

    const save = useMutation({
        mutationFn: (domain: string) => api.tenantDomainSet({ domain }),
        onSuccess: () => {
            setNotice({
                kind: 'ok',
                text: 'Dominio guardado. Creá el registro DNS indicado abajo y verificalo.',
            });
            invalidate();
        },
        onError: (e) => setNotice({ kind: 'err', text: saveErrorText(e) }),
    });

    const clear = useMutation({
        mutationFn: () => api.tenantDomainClear(),
        onSuccess: () => {
            setDomainInput('');
            setNotice({ kind: 'ok', text: 'Dominio quitado: la app vuelve a las URLs de la plataforma.' });
            invalidate();
        },
        onError: (e) =>
            setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'No se pudo quitar el dominio.' }),
    });

    const dnsQ = useQuery({
        queryKey: ['tenant-domain-dns', tenantId],
        queryFn: () => api.tenantDomainDns(),
        enabled: false,
        retry: false,
    });

    const handleCopy = async (key: string, text: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* clipboard bloqueado — no-op */
        }
    };

    // 403 o error de red → ocultar la card (mismo patrón que el panel SMTP).
    if (domainQ.isError || !domainQ.data) return null;

    const d = domainQ.data;
    const busy = save.isPending || clear.isPending;

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        // Validación client-side con el MISMO schema compartido del backend
        // (evita el round-trip para hostnames malformados).
        const parsed = customDomainInputSchema.safeParse({ domain: domainInput });
        if (!parsed.success) {
            setNotice({ kind: 'err', text: 'Dominio inválido (ej. crm.tuempresa.com).' });
            return;
        }
        save.mutate(parsed.data.domain);
    };

    const report = dnsQ.data;
    const dnsError = dnsQ.isError
        ? dnsQ.error instanceof CloudApiError && dnsQ.error.code === 'domain_not_configured'
            ? 'Guardá primero un dominio propio.'
            : dnsQ.error instanceof Error
              ? dnsQ.error.message
              : 'No se pudo verificar el DNS.'
        : null;
    const dnsMeta = report ? DNS_STATUS_META[report.status] : null;

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Globe className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>Dominio personalizado</CardTitle>
                        <CardDescription>
                            Accedé a la app por tu propio dominio: tu equipo entra por tu URL y ve tu marca desde el login.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                {/* Subdominio automático de la plataforma (si el operador lo habilitó). */}
                {d.base_domain && d.subdomain && (
                    <div className="imcrm-space-y-1 imcrm-rounded-md imcrm-bg-muted/60 imcrm-p-3">
                        <div className="imcrm-text-sm imcrm-font-medium">Subdominio incluido</div>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            Tu workspace ya tiene acceso automático por este subdominio — no requiere
                            ninguna configuración.
                        </p>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <a
                                href={`https://${d.subdomain}`}
                                target="_blank"
                                rel="noreferrer"
                                className="imcrm-min-w-0 imcrm-break-all imcrm-font-mono imcrm-text-xs imcrm-text-primary hover:imcrm-underline"
                            >
                                https://{d.subdomain}
                            </a>
                            <CopyButton
                                copied={copied === 'subdomain'}
                                onCopy={() => void handleCopy('subdomain', `https://${d.subdomain}`)}
                            />
                        </div>
                    </div>
                )}

                {/* Dominio propio de la empresa. */}
                <form onSubmit={submit} className="imcrm-space-y-2">
                    <label className="imcrm-block imcrm-space-y-1">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">Dominio propio</span>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <Input
                                value={domainInput}
                                onChange={(e) => setDomainInput(e.target.value)}
                                placeholder="crm.tuempresa.com"
                                spellCheck={false}
                                autoComplete="off"
                                className="imcrm-max-w-xs imcrm-font-mono"
                            />
                            <Button type="submit" size="sm" disabled={busy || domainInput.trim().length === 0}>
                                {save.isPending ? 'Guardando…' : 'Guardar'}
                            </Button>
                            {d.domain && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="imcrm-text-muted-foreground"
                                    disabled={busy}
                                    onClick={() => clear.mutate()}
                                >
                                    {clear.isPending ? 'Quitando…' : 'Quitar dominio'}
                                </Button>
                            )}
                        </div>
                    </label>
                </form>

                {notice && (
                    <div
                        className={[
                            'imcrm-rounded-md imcrm-p-2 imcrm-text-sm',
                            notice.kind === 'ok'
                                ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800'
                                : 'imcrm-bg-rose-100 imcrm-text-rose-800',
                        ].join(' ')}
                    >
                        {notice.text}
                    </div>
                )}

                {/* Instrucciones + verificación del apuntamiento DNS. */}
                {d.domain && (
                    <section className="imcrm-space-y-3 imcrm-border-t imcrm-border-border imcrm-pt-4">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                            <div>
                                <h4 className="imcrm-text-sm imcrm-font-medium">Registro DNS</h4>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    Creá este registro en el DNS de tu dominio para que{' '}
                                    <span className="imcrm-font-medium imcrm-text-foreground">{d.domain}</span>{' '}
                                    apunte a la plataforma.
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void dnsQ.refetch()}
                                disabled={dnsQ.isFetching}
                            >
                                {dnsQ.isFetching ? 'Verificando…' : 'Verificar DNS'}
                            </Button>
                        </div>

                        {dnsError && (
                            <div className="imcrm-rounded-md imcrm-bg-rose-100 imcrm-p-2 imcrm-text-sm imcrm-text-rose-800">
                                {dnsError}
                            </div>
                        )}

                        <div className="imcrm-space-y-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                <Badge variant="outline">{report?.type ?? 'CNAME'}</Badge>
                                {report && dnsMeta && (
                                    <Badge dot variant={dnsMeta.variant}>
                                        {dnsMeta.label}
                                    </Badge>
                                )}
                            </div>
                            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                                <div className="imcrm-min-w-0 imcrm-text-sm">
                                    <div className="imcrm-text-xs imcrm-text-muted-foreground">Host</div>
                                    <code className="imcrm-break-all imcrm-font-mono imcrm-text-xs">{d.domain}</code>
                                </div>
                                <div className="imcrm-min-w-0 imcrm-text-sm">
                                    <div className="imcrm-text-xs imcrm-text-muted-foreground">Valor</div>
                                    <div className="imcrm-flex imcrm-items-start imcrm-gap-1.5">
                                        <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-break-all imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-xs">
                                            {d.target}
                                        </code>
                                        <CopyButton
                                            copied={copied === 'target'}
                                            onCopy={() => void handleCopy('target', d.target)}
                                        />
                                    </div>
                                </div>
                            </div>
                            {report && (report.status === 'partial' || report.status === 'ok') && report.current && (
                                <p className="imcrm-break-all imcrm-text-xs imcrm-text-muted-foreground">
                                    Encontrado: <code className="imcrm-font-mono">{report.current}</code>
                                </p>
                            )}
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                Para un dominio raíz (apex, ej. <code className="imcrm-font-mono">tuempresa.com</code>)
                                tu proveedor puede no aceptar CNAME: usá un registro A hacia la IP de la
                                plataforma (o el alias/ANAME que ofrezca tu DNS).
                            </p>
                        </div>
                    </section>
                )}
            </CardContent>
        </Card>
    );
}

/** Botón "copiar" chico con feedback (mismo patrón que el panel SMTP). */
function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }): JSX.Element {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="imcrm-h-6 imcrm-shrink-0 imcrm-px-1.5"
            onClick={onCopy}
            title="Copiar"
        >
            {copied ? (
                <>
                    <Check className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    <span className="imcrm-ml-1 imcrm-text-xs">Copiado</span>
                </>
            ) : (
                <Copy className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            )}
        </Button>
    );
}

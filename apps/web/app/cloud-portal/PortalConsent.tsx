import { useContext, useEffect, useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Scale, X } from 'lucide-react';
import type { PortalConsentDto, PublicDataConsent } from '@imagina-base/shared';

import { PortalBrandSetterContext } from '@/cloud-portal/portalBrand';
import { portalApi } from '@/cloud-portal/portalClient';
import { CloudApiError } from '@/lib/cloud/client';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';

/** Sólo enlaces web reales (el texto lo escribe la empresa). */
function safeUrl(url: string | null): string | null {
    return url && /^https?:\/\//i.test(url) ? url : null;
}

function when(iso: string | null): string {
    return iso ? formatDateTime(parseUtcDate(iso)) : '';
}

/** El texto de la autorización, completo y con el enlace a la política. */
function ConsentText({ consent, className = '' }: { consent: PublicDataConsent; className?: string }): JSX.Element {
    const policy = safeUrl(consent.policy_url);
    return (
        <div className={className}>
            <div
                className="imcrm-max-h-[45vh] imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-4 imcrm-text-sm imcrm-leading-relaxed"
                data-testid="portal-consent-text"
                tabIndex={0}
            >
                {consent.text}
            </div>
            {policy && (
                <a href={policy} target="_blank" rel="noreferrer noopener" className="imcrm-mt-2 imcrm-inline-block imcrm-text-sm imcrm-text-primary hover:imcrm-underline">
                    Ver la política de tratamiento de datos
                </a>
            )}
        </div>
    );
}

/**
 * Ley 1581 — la primera vez que el cliente entra al portal (o cuando la
 * empresa cambia el texto, o si la retiró) tiene que leer y aceptar la
 * autorización para el tratamiento de sus datos. Sin aceptarla no se puede
 * usar el portal; sí se puede salir.
 */
export function PortalConsentGate({ onAccepted, onLogout }: { onAccepted: () => void; onLogout: () => void }): JSX.Element {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['portal-consent'], queryFn: () => portalApi.portalConsent(), retry: false });
    const [checked, setChecked] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const setBrand = useContext(PortalBrandSetterContext);
    const data = q.data;

    useEffect(() => {
        if (!data) return;
        setBrand({ name: data.branding.app_name ?? (data.company || null), logoUrl: data.branding.logo_url, primaryColor: data.branding.primary_color });
        return () => setBrand(null);
    }, [data, setBrand]);

    // La empresa ya no la pide (o ya estaba aceptada): seguir al portal.
    useEffect(() => {
        if (data && (data.status === 'not_required' || data.status === 'accepted')) onAccepted();
    }, [data, onAccepted]);

    const accept = useMutation({
        mutationFn: () => portalApi.portalAcceptConsent(data!.consent!.version),
        onMutate: () => setError(null),
        onSuccess: () => onAccepted(),
        onError: (err) => {
            if (err instanceof CloudApiError && err.code === 'consent_outdated') {
                setChecked(false);
                void qc.invalidateQueries({ queryKey: ['portal-consent'] });
            }
            setError(err instanceof CloudApiError ? err.message : 'No se pudo guardar. Prueba de nuevo.');
        },
    });
    const logout = useMutation({ mutationFn: () => portalApi.portalLogout(), onSettled: () => onLogout() });

    if (q.isError) {
        return (
            <Shell>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">No pudimos cargar la autorización. Recarga la página para intentarlo de nuevo.</p>
            </Shell>
        );
    }
    if (!data || !data.consent) {
        return (
            <Shell>
                <p className="imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">Cargando…</p>
            </Shell>
        );
    }

    const company = data.branding.app_name ?? data.company;
    const intro =
        data.status === 'outdated'
            ? `${company} actualizó el texto de la autorización para el tratamiento de tus datos personales. Léelo y acéptalo para seguir usando tu portal.`
            : data.status === 'withdrawn'
              ? `Retiraste tu autorización el ${when(data.withdrawn_at)}. Para volver a usar el portal tienes que aceptarla de nuevo. Si no quieres, puedes salir: tu decisión queda registrada.`
              : `Antes de entrar, ${company} necesita tu autorización para tratar tus datos personales, como lo exige la Ley 1581 de 2012.`;

    return (
        <Shell>
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                {data.branding.logo_url ? (
                    <img src={data.branding.logo_url} alt="" className="imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-rounded-md imcrm-object-contain" />
                ) : (
                    <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                        <Scale className="imcrm-h-5 imcrm-w-5" aria-hidden />
                    </span>
                )}
                <div className="imcrm-min-w-0">
                    <p className="imcrm-text-xs imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{company}</p>
                    <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">Autorización para el tratamiento de tus datos</h1>
                </div>
            </div>
            <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="portal-consent-intro">
                {intro}
            </p>
            <ConsentText consent={data.consent} />
            <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3 imcrm-text-sm">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                    className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-accent-[hsl(var(--imcrm-primary))]"
                    data-testid="portal-consent-check"
                />
                <span>{data.consent.label}</span>
            </label>
            {error && (
                <p role="alert" className="imcrm-text-sm imcrm-text-destructive">
                    {error}
                </p>
            )}
            <div className="imcrm-flex imcrm-flex-col-reverse imcrm-gap-2 sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-justify-between">
                <button
                    type="button"
                    onClick={() => logout.mutate()}
                    disabled={logout.isPending}
                    className="imcrm-h-10 imcrm-rounded-md imcrm-px-3 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground"
                    data-testid="portal-consent-logout"
                >
                    No acepto, salir
                </button>
                <button
                    type="button"
                    disabled={!checked || accept.isPending}
                    onClick={() => accept.mutate()}
                    className="imcrm-h-10 imcrm-rounded-md imcrm-bg-primary imcrm-px-5 imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground disabled:imcrm-opacity-60"
                    data-testid="portal-consent-accept"
                >
                    {accept.isPending ? 'Guardando…' : 'Aceptar y continuar'}
                </button>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                Puedes retirar esta autorización cuando quieras desde el menú de tu portal. Retirarla no borra tus datos: la empresa queda avisada y te
                contacta si hace falta.
            </p>
        </Shell>
    );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-start imcrm-justify-center imcrm-bg-background imcrm-p-4 sm:imcrm-items-center sm:imcrm-p-6">
            <div
                className="imcrm-w-full imcrm-max-w-2xl imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 sm:imcrm-p-6"
                data-testid="portal-consent-gate"
            >
                {children}
            </div>
        </div>
    );
}

/**
 * Desde el menú del portal: ver la autorización que aceptó (versión y fecha)
 * y retirarla. Retirarla avisa a la empresa y deja el portal bloqueado hasta
 * que la vuelva a aceptar (o salga).
 */
export function PortalConsentDialog({
    open,
    onOpenChange,
    onWithdrawn,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onWithdrawn: (dto: PortalConsentDto) => void;
}): JSX.Element {
    const q = useQuery({ queryKey: ['portal-consent'], queryFn: () => portalApi.portalConsent(), enabled: open, retry: false });
    const [confirming, setConfirming] = useState(false);
    const withdraw = useMutation({
        mutationFn: () => portalApi.portalWithdrawConsent(),
        onSuccess: (dto) => {
            setConfirming(false);
            onWithdrawn(dto);
        },
    });
    const d = q.data;
    return (
        <RDialog.Root
            open={open}
            onOpenChange={(o) => {
                if (!o) setConfirming(false);
                onOpenChange(o);
            }}
        >
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <RDialog.Content
                    data-testid="portal-consent-dialog"
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[min(40rem,calc(100vw-2rem))] -imcrm-translate-x-1/2 -imcrm-translate-y-1/2 imcrm-flex-col imcrm-gap-4 imcrm-overflow-auto imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-lg"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                            <Scale className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <RDialog.Title className="imcrm-text-base imcrm-font-semibold">Tu autorización de datos personales</RDialog.Title>
                            <RDialog.Description className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                                {d?.accepted_at
                                    ? `La aceptaste el ${when(d.accepted_at)} (versión ${d.accepted_version ?? '—'}).`
                                    : 'Lo que autorizaste a la empresa sobre tus datos.'}
                            </RDialog.Description>
                        </div>
                        <RDialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-muted" aria-label="Cerrar">
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </RDialog.Close>
                    </div>
                    {d?.consent ? <ConsentText consent={d.consent} /> : <p className="imcrm-text-sm imcrm-text-muted-foreground">Cargando…</p>}
                    <div className="imcrm-space-y-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                        <p className="imcrm-text-sm imcrm-font-medium">Retirar la autorización</p>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            Es tu derecho (Ley 1581). La empresa queda avisada y deja de poder usar tus datos para estas finalidades. Tus datos no se borran
                            solos: si quieres que los supriman, pídeselo por los canales que indica el texto. Para volver a usar el portal tendrás que aceptarla
                            de nuevo.
                        </p>
                        {withdraw.isError && (
                            <p role="alert" className="imcrm-text-sm imcrm-text-destructive">
                                {withdraw.error instanceof CloudApiError ? withdraw.error.message : 'No se pudo retirar. Prueba de nuevo.'}
                            </p>
                        )}
                        {confirming ? (
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                <span className="imcrm-text-sm">¿Seguro que quieres retirarla?</span>
                                <button
                                    type="button"
                                    disabled={withdraw.isPending}
                                    onClick={() => withdraw.mutate()}
                                    className="imcrm-h-9 imcrm-rounded-md imcrm-bg-destructive imcrm-px-4 imcrm-text-sm imcrm-font-medium imcrm-text-destructive-foreground disabled:imcrm-opacity-60"
                                    data-testid="portal-consent-withdraw-confirm"
                                >
                                    {withdraw.isPending ? 'Retirando…' : 'Sí, retirarla'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirming(false)}
                                    className="imcrm-h-9 imcrm-rounded-md imcrm-px-3 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-bg-muted"
                                >
                                    Cancelar
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setConfirming(true)}
                                className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-px-4 imcrm-text-sm imcrm-font-medium imcrm-text-destructive hover:imcrm-bg-destructive/10"
                                data-testid="portal-consent-withdraw"
                            >
                                Retirar mi autorización
                            </button>
                        )}
                    </div>
                </RDialog.Content>
            </RDialog.Portal>
        </RDialog.Root>
    );
}

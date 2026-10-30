import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Save } from 'lucide-react';
import type { BillingPolicy } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useApplyTrialEnds, useBillingPolicy, useUpdateBillingPolicy } from '@/hooks/usePlatform';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * v0.1.338 (ADR-S87) — Plataforma → Planes → «Prueba y vencimientos».
 *
 * Cuánto dura la prueba de una empresa nueva, qué pasa al terminar (pausar la
 * cuenta o dejarla en solo lectura), los días de gracia de un plan que vence y
 * si la empresa que no renueva pasa al plan de prueba. Los LÍMITES y los
 * MÓDULOS de la prueba se editan en el plan «Trial» de la tabla de abajo.
 */
export function PlatformBillingPolicyCard(): JSX.Element {
    const view = useBillingPolicy();
    const update = useUpdateBillingPolicy();
    const apply = useApplyTrialEnds();
    const toast = useToast();
    const [draft, setDraft] = useState<BillingPolicy | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (view.data) setDraft(view.data.policy);
    }, [view.data]);

    if (view.isLoading || !draft || !view.data) {
        return <div className="imcrm-h-64 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />;
    }
    const saved = view.data.policy;
    const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
    const set = <K extends keyof BillingPolicy>(key: K, value: BillingPolicy[K]): void => setDraft({ ...draft, [key]: value });

    const save = async (): Promise<void> => {
        setError(null);
        try {
            await update.mutateAsync(draft);
            toast.success(__('Guardado'), __('Aplica desde ahora a todas las empresas.'));
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };
    const legacy = view.data.trials_without_end;
    const applyDays = draft.trial_days ?? 15;

    return (
        <Card data-testid="billing-policy-card">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <CalendarClock className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Prueba y vencimientos')}</CardTitle>
                        <CardDescription>
                            {__('Cuánto dura la prueba y qué pasa cuando termina o cuando un plan vence sin renovarse. Lo que incluye la prueba (usuarios, registros, módulos) se edita en el plan «Trial» de abajo.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <Label className="imcrm-text-sm imcrm-font-medium">{__('Duración de la prueba')}</Label>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-text-sm">
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <input
                                type="radio"
                                name="trial-days"
                                checked={draft.trial_days !== null}
                                onChange={() => set('trial_days', saved.trial_days ?? 15)}
                                data-testid="policy-trial-limited"
                            />
                            <Input
                                type="number"
                                min={1}
                                max={365}
                                className="imcrm-h-8 imcrm-w-20"
                                value={draft.trial_days ?? ''}
                                disabled={draft.trial_days === null}
                                onChange={(e) => set('trial_days', Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
                                data-testid="policy-trial-days"
                                aria-label={__('Días de prueba')}
                            />
                            {__('días')}
                        </label>
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <input
                                type="radio"
                                name="trial-days"
                                checked={draft.trial_days === null}
                                onChange={() => set('trial_days', null)}
                                data-testid="policy-trial-unlimited"
                            />
                            {__('Sin fecha de fin')}
                        </label>
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Aplica a las empresas que se registren desde ahora (y a las que crees en el plan de prueba). Para extender la prueba de una empresa puntual, ábrela en Empresas.')}
                    </p>
                </section>

                <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <Label className="imcrm-text-sm imcrm-font-medium">{__('Cuando termina la prueba o vence un plan')}</Label>
                    <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                        {(
                            [
                                {
                                    key: 'lock' as const,
                                    title: __('Pausar la cuenta (recomendado)'),
                                    text: __('Nadie del equipo puede usarla: sólo elegir un plan, pagar y descargar sus datos. El portal, los formularios y los enlaces públicos dejan de funcionar. No se borra nada.'),
                                },
                                {
                                    key: 'read_only' as const,
                                    title: __('Dejarla en solo lectura'),
                                    text: __('El equipo puede ver todo pero no cambiar nada. Nada de lo que corre solo (automatizaciones, sincronizaciones) sigue funcionando.'),
                                },
                            ]
                        ).map((o) => (
                            <button
                                key={o.key}
                                type="button"
                                role="radio"
                                aria-checked={draft.on_end === o.key}
                                onClick={() => set('on_end', o.key)}
                                data-testid={`policy-on-end-${o.key}`}
                                className={cn(
                                    'imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                                    draft.on_end === o.key
                                        ? 'imcrm-border-primary imcrm-shadow-[0_0_0_3px_hsl(var(--imcrm-primary)/0.12)]'
                                        : 'imcrm-border-border hover:imcrm-border-input',
                                )}
                            >
                                <span className="imcrm-text-sm imcrm-font-medium">{o.title}</span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{o.text}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <Label className="imcrm-text-sm imcrm-font-medium">{__('Planes que no se renuevan')}</Label>
                    <label className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        {__('Días de gracia después del vencimiento:')}
                        <Input
                            type="number"
                            min={0}
                            max={60}
                            className="imcrm-h-8 imcrm-w-20"
                            value={draft.grace_days}
                            onChange={(e) => set('grace_days', Math.min(60, Math.max(0, Number(e.target.value) || 0)))}
                            data-testid="policy-grace-days"
                        />
                    </label>
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5"
                            checked={draft.lapse_to_trial}
                            onChange={(e) => set('lapse_to_trial', e.target.checked)}
                            data-testid="policy-lapse"
                        />
                        <span>
                            <span className="imcrm-font-medium">{__('Pasada la gracia, pasa al plan de prueba')}</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Toma los límites y módulos de la prueba. Al pagar, vuelve al plan que pague con todo lo que tenía.')}
                            </span>
                        </span>
                    </label>
                    {draft.lapse_to_trial && (
                        <label className="imcrm-ml-6 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            {__('Días de prueba que recibe:')}
                            <Input
                                type="number"
                                min={0}
                                max={90}
                                className="imcrm-h-8 imcrm-w-20"
                                value={draft.lapse_trial_days}
                                onChange={(e) => set('lapse_trial_days', Math.min(90, Math.max(0, Number(e.target.value) || 0)))}
                                data-testid="policy-lapse-days"
                            />
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {draft.lapse_trial_days === 0
                                    ? draft.on_end === 'lock'
                                        ? __('0 = queda pausada al instante (ya tuvo su prueba).')
                                        : __('0 = queda en solo lectura al instante (ya tuvo su prueba).')
                                    : __('Después de esos días, se aplica lo de arriba.')}
                            </span>
                        </label>
                    )}
                </section>

                {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3">
                    <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="policy-locked-count">
                        {view.data.locked === 0
                            ? __('Ninguna empresa pausada ahora.')
                            : view.data.locked === 1
                              ? __('1 empresa pausada ahora.')
                              : `${formatNumber(view.data.locked)} ${__('empresas pausadas ahora.')}`}
                    </span>
                    <Button size="sm" className="imcrm-gap-1.5" disabled={!dirty || update.isPending} onClick={() => void save()} data-testid="policy-save">
                        {update.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Save className="imcrm-h-4 imcrm-w-4" />}
                        {__('Guardar')}
                    </Button>
                </div>

                {legacy > 0 && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-sm" data-testid="policy-legacy">
                        <span>
                            {legacy === 1
                                ? __('Hay 1 empresa en prueba sin fecha de fin (de antes de este cambio).')
                                : `${__('Hay')} ${formatNumber(legacy)} ${__('empresas en prueba sin fecha de fin (de antes de este cambio).')}`}{' '}
                            <span className="imcrm-text-muted-foreground">{__('Las de un superadministrador no se cuentan: la tuya no se pausa.')}</span>
                        </span>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={apply.isPending}
                            data-testid="policy-apply-legacy"
                            onClick={() =>
                                void apply
                                    .mutateAsync({ days: applyDays })
                                    .then((r) => toast.success(__('Listo'), `${formatNumber(r.updated)} ${__('empresas tienen ahora')} ${applyDays} ${__('días de prueba desde hoy.')}`))
                                    .catch((err: unknown) => setError(err instanceof Error ? err.message : __('Error')))
                            }
                        >
                            {apply.isPending && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {`${__('Darles')} ${applyDays} ${__('días desde hoy')}`}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

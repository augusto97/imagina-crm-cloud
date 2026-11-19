import { useEffect, useState } from 'react';
import { Building2, Loader2, Save, Unlink } from 'lucide-react';
import { agencyPlatformPricing, type PlatformTenant, type UpdateTenantInput } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePlatformPlans, usePlatformTenants } from '@/hooks/usePlatform';
import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';

/**
 * v0.1.449 (I3, ADR-S108) — Modo agencia desde la ficha de una empresa:
 * - una empresa común se marca como agencia o se asigna a una agencia;
 * - una agencia: con qué plan nacen sus clientes y cuántos puede tener;
 * - una empresa cliente: de qué agencia es y «Quitar de la agencia».
 * El servidor revisa todo (una agencia con clientes no deja de serlo, un
 * cliente no puede ser agencia, etc.); acá sólo se ofrece lo que tiene sentido.
 */
export function TenantAgencySection({
    t,
    busy,
    onUpdate,
}: {
    t: PlatformTenant;
    busy: boolean;
    onUpdate: (input: UpdateTenantInput) => Promise<void>;
}): JSX.Element {
    const confirm = useConfirm();
    const plans = usePlatformPlans();
    const isClient = t.agency !== null;
    const agencies = usePlatformTenants({ agency: 'all', limit: 200, enabled: !t.is_agency && !isClient });
    const [clientPlan, setClientPlan] = useState<string>(t.agency_settings?.client_plan ?? '');
    const [maxClients, setMaxClients] = useState<string>(t.agency_settings?.max_clients != null ? String(t.agency_settings.max_clients) : '');
    const [assignTo, setAssignTo] = useState<string>('');
    const [extraPlans, setExtraPlans] = useState<string[]>(t.agency_settings?.client_plans ?? []);
    // v0.1.454 — un trato propio con la plataforma (vacío = lo del plan de la agencia).
    const numStr = (v: number | null | undefined): string => (v != null ? String(v) : '');
    const [incl, setIncl] = useState<string>(numStr(t.agency_settings?.included_clients));
    const [extraUsd, setExtraUsd] = useState<string>(numStr(t.agency_settings?.extra_usd));
    const [extraCop, setExtraCop] = useState<string>(numStr(t.agency_settings?.extra_cop));

    useEffect(() => {
        setClientPlan(t.agency_settings?.client_plan ?? '');
        setMaxClients(t.agency_settings?.max_clients != null ? String(t.agency_settings.max_clients) : '');
        setExtraPlans(t.agency_settings?.client_plans ?? []);
        setIncl(numStr(t.agency_settings?.included_clients));
        setExtraUsd(numStr(t.agency_settings?.extra_usd));
        setExtraCop(numStr(t.agency_settings?.extra_cop));
    }, [t.agency_settings]);

    const isInt = (v: string): boolean => v.trim() === '' || /^\d+$/.test(v.trim());
    const toNum = (v: string): number | null => (v.trim() === '' ? null : Number(v.trim()));
    const maxValid = isInt(maxClients);
    const dealValid = isInt(incl) && isInt(extraUsd) && isInt(extraCop);
    const settingsDirty =
        (clientPlan || null) !== (t.agency_settings?.client_plan ?? null) ||
        (maxClients.trim() === '' ? null : Number(maxClients)) !== (t.agency_settings?.max_clients ?? null) ||
        [...extraPlans].sort().join(',') !== [...(t.agency_settings?.client_plans ?? [])].sort().join(',') ||
        toNum(incl) !== (t.agency_settings?.included_clients ?? null) ||
        toNum(extraUsd) !== (t.agency_settings?.extra_usd ?? null) ||
        toNum(extraCop) !== (t.agency_settings?.extra_cop ?? null);

    // Lo que paga hoy a la plataforma con lo que hay en pantalla (el mismo cálculo del servidor).
    const ownPlan = (plans.data ?? []).find((p) => p.slug === t.plan) ?? null;
    const pricing = t.is_agency
        ? agencyPlatformPricing(
              ownPlan
                  ? {
                        price_usd: ownPlan.price_usd,
                        price_cop: ownPlan.price_cop,
                        agency_included_clients: ownPlan.agency_included_clients ?? null,
                        agency_extra_usd: ownPlan.agency_extra_usd ?? null,
                        agency_extra_cop: ownPlan.agency_extra_cop ?? null,
                    }
                  : null,
              dealValid ? { included_clients: toNum(incl), extra_usd: toNum(extraUsd), extra_cop: toNum(extraCop) } : null,
              t.agency_billed_clients ?? 0,
          )
        : null;
    const usd = (v: number | null): string => (v === null ? '—' : `US$ ${formatNumber(v)}`);
    const cop = (v: number | null): string => (v === null ? '—' : `$ ${formatNumber(v)} COP`);

    const toggleAgency = async (on: boolean): Promise<void> => {
        if (!on) {
            const ok = await confirm({
                title: __('¿Dejar de ser agencia?'),
                description: __('Se apaga la consola de empresas cliente. Sólo se puede si no tiene empresas cliente.'),
                confirmLabel: __('Dejar de ser agencia'),
                destructive: true,
            });
            if (!ok) return;
        }
        await onUpdate({ is_agency: on });
    };

    const assign = async (): Promise<void> => {
        const agencyId = Number(assignTo);
        const agency = agencies.data?.data.find((a) => a.id === agencyId);
        if (!agency) return;
        const ok = await confirm({
            title: `${__('¿Pasar a')} «${t.name}» ${__('a la agencia')} «${agency.name}»?`,
            description: __('Los administradores de la agencia podrán entrar como administradores (queda en su registro de actividad), y el plan lo manejará la agencia.'),
            confirmLabel: __('Asignar'),
        });
        if (ok) await onUpdate({ agency_id: agencyId });
    };

    const unlink = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Quitar de la agencia?'),
            description: __('La agencia deja de ver esta empresa y su equipo pierde el acceso de agencia al instante. La empresa y sus datos quedan intactos.'),
            confirmLabel: __('Quitar de la agencia'),
            destructive: true,
        });
        if (ok) await onUpdate({ agency_id: null });
    };

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="tenant-agency-section">
            <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                <Building2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {__('Agencia')}
            </h3>

            {isClient && t.agency && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3 imcrm-text-sm">
                    <div className="imcrm-min-w-0">
                        <p>
                            {__('Empresa cliente de')} <strong>{t.agency.name}</strong>
                        </p>
                        <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                            {t.agency_paused ? __('La agencia la pausó: está en solo lectura.') : __('Su plan y su acceso siguen a la agencia.')}
                        </p>
                    </div>
                    <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={busy} onClick={() => void unlink()} data-testid="tenant-agency-unlink">
                        <Unlink className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Quitar de la agencia')}
                    </Button>
                </div>
            )}

            {!isClient && (
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <input
                        type="checkbox"
                        className="imcrm-mt-0.5"
                        checked={t.is_agency}
                        disabled={busy || (t.is_agency && (t.agency_clients ?? 0) > 0)}
                        onChange={(e) => void toggleAgency(e.target.checked)}
                        data-testid="tenant-agency-toggle"
                    />
                    <span>
                        <span className="imcrm-font-medium">{__('Es una agencia')}</span>
                        <span className="imcrm-block imcrm-text-[12px] imcrm-text-muted-foreground">
                            {t.is_agency
                                ? (t.agency_clients ?? 0) > 0
                                    ? `${t.agency_clients} ${__('empresas cliente. Para dejar de ser agencia, primero quítalas.')}`
                                    : __('Todavía no tiene empresas cliente.')
                                : __('Sus administradores crean y manejan las empresas de sus clientes desde la sección «Agencia».')}
                        </span>
                    </span>
                </label>
            )}

            {t.is_agency && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                    <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label className="imcrm-text-xs">{__('Plan con el que nacen sus clientes')}</Label>
                            <select
                                className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                value={clientPlan}
                                onChange={(e) => setClientPlan(e.target.value)}
                                data-testid="tenant-agency-client-plan"
                            >
                                <option value="">{__('El mismo plan de la agencia')}</option>
                                {(plans.data ?? []).map((p) => (
                                    <option key={p.slug} value={p.slug}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label className="imcrm-text-xs">{__('Tope de empresas cliente')}</Label>
                            <Input
                                inputMode="numeric"
                                value={maxClients}
                                onChange={(e) => setMaxClients(e.target.value)}
                                placeholder={__('Sin tope')}
                                className="imcrm-h-9"
                                data-testid="tenant-agency-max"
                            />
                        </div>
                    </div>
                    {!maxValid && <p className="imcrm-text-[12px] imcrm-text-destructive">{__('El tope tiene que ser un número entero.')}</p>}
                    {/* v0.1.451 — planes de la plataforma que la agencia puede usar como límites de los suyos. */}
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="tenant-agency-client-plans">
                        <Label className="imcrm-text-xs">{__('Otros planes que la agencia puede dar a sus clientes')}</Label>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('Al vender sus planes, la agencia elige con qué límites queda cada empresa: el plan con el que nacen y los que marques aquí.')}
                        </p>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1">
                            {(plans.data ?? [])
                                .filter((p) => p.slug !== (clientPlan || t.plan))
                                .map((p) => (
                                    <label key={p.slug} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                                        <input
                                            type="checkbox"
                                            checked={extraPlans.includes(p.slug)}
                                            onChange={(e) =>
                                                setExtraPlans((list) => (e.target.checked ? [...list, p.slug] : list.filter((x) => x !== p.slug)))
                                            }
                                        />
                                        {p.name}
                                    </label>
                                ))}
                        </div>
                    </div>
                    {/* v0.1.454 — lo que la plataforma le cobra a esta agencia. */}
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="tenant-agency-pricing">
                        <Label className="imcrm-text-xs">{__('Lo que paga a la plataforma')}</Label>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('El precio de su plan incluye algunas empresas cliente y cada una de más suma al mes (sin contar las archivadas ni las pausadas por la agencia). Puedes ponerle un trato propio; vacío = lo de su plan.')}
                        </p>
                        <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Empresas incluidas')}</Label>
                                <Input
                                    inputMode="numeric"
                                    value={incl}
                                    onChange={(e) => setIncl(e.target.value)}
                                    placeholder={ownPlan?.agency_included_clients != null ? String(ownPlan.agency_included_clients) : __('Todas')}
                                    className="imcrm-h-9"
                                    data-testid="tenant-agency-included"
                                />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('USD por extra')}</Label>
                                <Input
                                    inputMode="numeric"
                                    value={extraUsd}
                                    onChange={(e) => setExtraUsd(e.target.value)}
                                    placeholder={ownPlan?.agency_extra_usd != null ? String(ownPlan.agency_extra_usd) : '—'}
                                    className="imcrm-h-9"
                                    data-testid="tenant-agency-extra-usd"
                                />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('COP por extra')}</Label>
                                <Input
                                    inputMode="numeric"
                                    value={extraCop}
                                    onChange={(e) => setExtraCop(e.target.value)}
                                    placeholder={ownPlan?.agency_extra_cop != null ? String(ownPlan.agency_extra_cop) : '—'}
                                    className="imcrm-h-9"
                                    data-testid="tenant-agency-extra-cop"
                                />
                            </div>
                        </div>
                        {!dealValid && <p className="imcrm-text-[12px] imcrm-text-destructive">{__('Usa números enteros, sin puntos ni comas.')}</p>}
                        {pricing && (
                            <p className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2 imcrm-text-[12px]" data-testid="tenant-agency-total">
                                {pricing.base_usd === null && pricing.base_cop === null ? (
                                    __('Su plan no tiene precio: no paga nada a la plataforma.')
                                ) : (
                                    <>
                                        {formatNumber(pricing.clients)} {pricing.clients === 1 ? __('empresa cliente') : __('empresas cliente')}
                                        {pricing.included === null
                                            ? ` · ${__('todas incluidas')}`
                                            : ` · ${formatNumber(pricing.included)} ${__('incluidas')} · ${formatNumber(pricing.extras)} ${pricing.extras === 1 ? __('extra') : __('extras')}`}
                                        {' → '}
                                        <strong>
                                            {usd(pricing.total_usd)} · {cop(pricing.total_cop)}
                                        </strong>{' '}
                                        {__('al mes')}
                                        {pricing.custom && <span className="imcrm-text-muted-foreground"> · {__('trato propio')}</span>}
                                    </>
                                )}
                            </p>
                        )}
                    </div>
                    <div className="imcrm-flex imcrm-justify-end">
                        <Button
                            size="sm"
                            variant="outline"
                            className="imcrm-gap-1.5"
                            disabled={busy || !settingsDirty || !maxValid || !dealValid}
                            onClick={() =>
                                void onUpdate({
                                    agency_settings: {
                                        client_plan: clientPlan || null,
                                        max_clients: maxClients.trim() === '' ? null : Number(maxClients.trim()),
                                        client_plans: extraPlans.slice(0, 20),
                                        included_clients: toNum(incl),
                                        extra_usd: toNum(extraUsd),
                                        extra_cop: toNum(extraCop),
                                    },
                                })
                            }
                            data-testid="tenant-agency-save"
                        >
                            <Save className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Guardar')}
                        </Button>
                    </div>
                </div>
            )}

            {!isClient && !t.is_agency && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label className="imcrm-text-xs">{__('O pasarla a una agencia')}</Label>
                    {agencies.isLoading ? (
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
                    ) : (agencies.data?.data ?? []).length === 0 ? (
                        <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{__('Todavía no hay agencias. Marca primero a la agencia con «Es una agencia».')}</p>
                    ) : (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <select
                                className="imcrm-h-9 imcrm-min-w-0 imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                value={assignTo}
                                onChange={(e) => setAssignTo(e.target.value)}
                                data-testid="tenant-agency-assign"
                            >
                                <option value="">{__('Elige una agencia…')}</option>
                                {(agencies.data?.data ?? []).map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.name}
                                    </option>
                                ))}
                            </select>
                            <Button size="sm" variant="outline" disabled={busy || assignTo === ''} onClick={() => void assign()} data-testid="tenant-agency-assign-save">
                                {__('Asignar')}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

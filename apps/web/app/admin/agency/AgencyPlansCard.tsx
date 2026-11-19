import { useEffect, useState } from 'react';
import {
    AGENCY_MAX_PLANS,
    AGENCY_PLAN_PERIODS,
    agencyBillingSettingsSchema,
    agencyPeriodText,
    agencyPlanIdFor,
    type AgencyOverview,
    type AgencyPlan,
    parseLooseAmount,
} from '@imagina-base/shared';
import { Plus, Receipt, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';

import { useUpdateAgencyBilling } from './useAgency';

const CURRENCIES = ['COP', 'USD', 'MXN', 'PEN', 'CLP', 'ARS', 'EUR'];

interface PlanDraft {
    id: string;
    name: string;
    description: string;
    price: string;
    currency: string;
    period_months: number;
    limits_plan: string;
    active: boolean;
}

function toDraft(p: AgencyPlan): PlanDraft {
    return {
        id: p.id,
        name: p.name,
        description: p.description ?? '',
        price: formatNumber(p.price, { maxFrac: 2 }),
        currency: p.currency,
        period_months: p.period_months,
        limits_plan: p.limits_plan ?? '',
        active: p.active,
    };
}

/**
 * v0.1.451 (I3, ADR-S108) — Los planes que la agencia le vende a sus
 * clientes y las reglas del cobro: cuántos días de gracia hay después de que
 * vence el pago y cuántos días antes se avisa. El cobro lo hace la agencia
 * (por su cuenta, o en línea desde la próxima versión); la app lleva el
 * «pagado hasta» de cada cliente y lo pasa a solo lectura si no paga.
 */
export function AgencyPlansCard({ overview, usage }: { overview: AgencyOverview; usage: Record<string, number> }): JSX.Element {
    const save = useUpdateAgencyBilling();
    const [plans, setPlans] = useState<PlanDraft[]>(() => overview.billing.plans.map(toDraft));
    const [grace, setGrace] = useState(String(overview.billing.grace_days));
    const [remind, setRemind] = useState(String(overview.billing.remind_days));
    const [notify, setNotify] = useState(overview.billing.notify_client);
    const [dirty, setDirty] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    useEffect(() => {
        if (dirty) return;
        setPlans(overview.billing.plans.map(toDraft));
        setGrace(String(overview.billing.grace_days));
        setRemind(String(overview.billing.remind_days));
        setNotify(overview.billing.notify_client);
    }, [overview.billing, dirty]);

    const touch = (): void => {
        setDirty(true);
        setNotice(null);
        setErrors([]);
    };
    const setPlan = (i: number, patch: Partial<PlanDraft>): void => {
        touch();
        setPlans((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    };
    const addPlan = (): void => {
        touch();
        const used = plans.map((p) => p.id);
        const base = plans[plans.length - 1];
        setPlans((list) => [
            ...list,
            {
                id: agencyPlanIdFor(`plan ${list.length + 1}`, used),
                name: '',
                description: '',
                price: '',
                currency: base?.currency ?? 'COP',
                period_months: 1,
                limits_plan: '',
                active: true,
            },
        ]);
    };
    const removePlan = (i: number): void => {
        touch();
        setPlans((list) => list.filter((_, j) => j !== i));
    };

    const usedBy = (id: string): number => usage[id] ?? 0;

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        const problems: string[] = [];
        const parsedPlans = plans.map((p, i) => {
            const price = parseLooseAmount(p.price);
            if (price === null || price < 0) problems.push(`${__('Plan')} ${i + 1}: ${__('escribe el valor (sólo números).')}`);
            return {
                id: p.id,
                name: p.name.trim(),
                description: p.description.trim() || null,
                price: price ?? 0,
                currency: p.currency,
                period_months: p.period_months,
                limits_plan: p.limits_plan || null,
                active: p.active,
            };
        });
        const graceN = Number(grace);
        const remindN = Number(remind);
        const parsed = agencyBillingSettingsSchema.safeParse({
            plans: parsedPlans,
            grace_days: Number.isFinite(graceN) ? graceN : -1,
            remind_days: Number.isFinite(remindN) ? remindN : -1,
            notify_client: notify,
        });
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                const [k, idx, field] = issue.path;
                if (k === 'plans' && typeof idx === 'number') {
                    problems.push(`${__('Plan')} ${idx + 1}${field === 'name' ? '' : ` (${String(field ?? '')})`}: ${issue.message}`);
                } else if (k === 'grace_days') problems.push(__('Los días de gracia van de 0 a 60.'));
                else if (k === 'remind_days') problems.push(__('Los días de aviso van de 0 a 30.'));
                else problems.push(issue.message);
            }
        }
        if (problems.length > 0 || !parsed.success) {
            setErrors([...new Set(problems)]);
            return;
        }
        save.mutate(parsed.data, {
            onSuccess: () => {
                setDirty(false);
                setNotice({ kind: 'ok', text: __('Guardado.') });
            },
            onError: (err) => setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) }),
        });
    };

    const platformDefault = overview.limit_plans[0]?.name ?? null;

    return (
        <Card data-testid="agency-plans-card" data-tour="agency-plans">
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                    <Receipt className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                    {__('Tus planes y el cobro')}
                </CardTitle>
                <CardDescription>
                    {__('Lo que le cobras a cada empresa cliente y cada cuánto. Cada empresa lleva su «pagado hasta»: cuando vence y pasan los días de gracia, queda en solo lectura (sus datos se conservan) hasta que registres el pago.')}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form className="imcrm-flex imcrm-flex-col imcrm-gap-5" onSubmit={submit} noValidate>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="agency-plans">
                        {plans.length === 0 && (
                            <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Todavía no tienes planes. Crea uno (por ejemplo «Básico», $150.000 cada mes) y asígnalo a tus clientes.')}
                            </p>
                        )}
                        {plans.map((p, i) => (
                            <fieldset
                                key={p.id}
                                className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3"
                                data-testid="agency-plan"
                            >
                                <legend className="imcrm-sr-only">{p.name || `${__('Plan')} ${i + 1}`}</legend>
                                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-[1.4fr_1fr_0.7fr_1fr]">
                                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                                        <span className="imcrm-font-medium">{__('Nombre')}</span>
                                        <Input value={p.name} onChange={(e) => setPlan(i, { name: e.target.value })} maxLength={60} placeholder={__('Básico')} data-testid="agency-plan-name" />
                                    </label>
                                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                                        <span className="imcrm-font-medium">{__('Valor')}</span>
                                        <Input inputMode="decimal" value={p.price} onChange={(e) => setPlan(i, { price: e.target.value })} placeholder="150.000" data-testid="agency-plan-price" />
                                    </label>
                                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                                        <span className="imcrm-font-medium">{__('Moneda')}</span>
                                        <Select value={p.currency} onChange={(e) => setPlan(i, { currency: e.target.value })}>
                                            {[...new Set([p.currency, ...CURRENCIES])].map((c) => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </Select>
                                    </label>
                                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                                        <span className="imcrm-font-medium">{__('Se cobra')}</span>
                                        <Select value={p.period_months} onChange={(e) => setPlan(i, { period_months: Number(e.target.value) })} data-testid="agency-plan-period">
                                            {AGENCY_PLAN_PERIODS.map((m) => (
                                                <option key={m} value={m}>{__(agencyPeriodText(m))}</option>
                                            ))}
                                        </Select>
                                    </label>
                                </div>
                                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                                        <span className="imcrm-font-medium">{__('Qué incluye (opcional)')}</span>
                                        <Input value={p.description} onChange={(e) => setPlan(i, { description: e.target.value })} maxLength={200} placeholder={__('Soporte y hasta 5 usuarios')} />
                                    </label>
                                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                                        <span className="imcrm-font-medium">{__('Límites de la empresa')}</span>
                                        <Select value={p.limits_plan} onChange={(e) => setPlan(i, { limits_plan: e.target.value })} data-testid="agency-plan-limits">
                                            <option value="">{__('No cambiarlos')}</option>
                                            {overview.limit_plans.map((lp) => (
                                                <option key={lp.slug} value={lp.slug}>{lp.name}</option>
                                            ))}
                                        </Select>
                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {platformDefault
                                                ? __('Usuarios, registros y módulos de la empresa al asignarle el plan. Los da la plataforma.')
                                                : __('Los da la plataforma.')}
                                        </span>
                                    </label>
                                </div>
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                        <input type="checkbox" checked={p.active} onChange={(e) => setPlan(i, { active: e.target.checked })} />
                                        {__('Se puede asignar a empresas nuevas')}
                                    </label>
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                        {usedBy(p.id) > 0 && (
                                            <Badge variant="outline" className="imcrm-font-normal">
                                                {usedBy(p.id) === 1 ? __('1 empresa') : `${formatNumber(usedBy(p.id))} ${__('empresas')}`}
                                            </Badge>
                                        )}
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => removePlan(i)}
                                            title={usedBy(p.id) > 0 ? __('Las empresas que lo tienen lo conservan con su valor.') : undefined}
                                            aria-label={`${__('Quitar el plan')} ${p.name}`}
                                        >
                                            <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                            {__('Quitar')}
                                        </Button>
                                    </div>
                                </div>
                            </fieldset>
                        ))}
                        {plans.length < AGENCY_MAX_PLANS && (
                            <div>
                                <Button type="button" variant="outline" size="sm" onClick={addPlan} data-testid="agency-plan-add">
                                    <Plus className="imcrm-h-4 imcrm-w-4" />
                                    {__('Agregar un plan')}
                                </Button>
                            </div>
                        )}
                    </div>

                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-4">
                        <span className="imcrm-text-sm imcrm-font-medium">{__('Reglas del cobro')}</span>
                        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                            <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                                <span>{__('Días de gracia después de vencer')}</span>
                                <Input type="number" min={0} max={60} value={grace} onChange={(e) => (touch(), setGrace(e.target.value))} data-testid="agency-grace" />
                                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Pasados esos días sin pago, la empresa queda en solo lectura.')}</span>
                            </label>
                            <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                                <span>{__('Avisar antes de vencer (días)')}</span>
                                <Input type="number" min={0} max={30} value={remind} onChange={(e) => (touch(), setRemind(e.target.value))} data-testid="agency-remind" />
                                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Le llega un correo a tu cliente y lo ves «Por vencer» aquí.')}</span>
                            </label>
                        </div>
                        <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                            <input type="checkbox" className="imcrm-mt-0.5" checked={notify} onChange={(e) => (touch(), setNotify(e.target.checked))} data-testid="agency-notify" />
                            <span>
                                {__('Avisarles a mis clientes por correo')}
                                <span className="imcrm-block imcrm-text-[12px] imcrm-text-muted-foreground">
                                    {__('Antes de vencer, al vencer y si pasan a solo lectura. Con la marca de tu agencia. A ti te llega un aviso cuando vence.')}
                                </span>
                            </span>
                        </label>
                    </div>

                    {errors.length > 0 && (
                        <ul className="imcrm-list-disc imcrm-pl-5 imcrm-text-sm imcrm-text-destructive" role="alert" data-testid="agency-plans-errors">
                            {errors.map((e) => (
                                <li key={e}>{e}</li>
                            ))}
                        </ul>
                    )}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button type="submit" size="sm" disabled={save.isPending || !dirty} data-testid="agency-plans-save">
                            {__('Guardar')}
                        </Button>
                        {dirty && !save.isPending && <span className="imcrm-text-sm imcrm-text-muted-foreground">{__('Tienes cambios sin guardar.')}</span>}
                        {notice && (
                            <span role="status" className={notice.kind === 'ok' ? 'imcrm-text-sm imcrm-text-success' : 'imcrm-text-sm imcrm-text-destructive'}>
                                {notice.text}
                            </span>
                        )}
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

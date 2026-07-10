import { useEffect, useState } from 'react';
import { CreditCard, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import type { PlatformPlan } from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import {
    useCreatePlan,
    useDeletePlan,
    usePlatformPlans,
    useUpdatePlan,
} from '@/hooks/usePlatform';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';

/** `''` (vacío) = ilimitado / sin precio (null); un número = ese valor. */
function toLimit(v: string): number | null {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
const limitStr = (v: number | null): string => (v === null ? '' : String(v));
const fmtLimit = (v: number | null): string => (v === null ? '∞' : v.toLocaleString());

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

/**
 * Planes (operador, ADR-S15 F3). La grilla es de SOLO LECTURA — valores
 * formateados, sin inputs por celda — y toda la edición/alta vive en un panel
 * lateral (mucho menos ruido que la vieja tabla de formularios).
 */
export function PlatformPlansCard(): JSX.Element {
    const plans = usePlatformPlans();
    const del = useDeletePlan();
    // `null` = cerrado · `'new'` = alta · un slug = edición de ese plan.
    const [sheet, setSheet] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const remove = async (p: PlatformPlan): Promise<void> => {
        setError(null);
        if (!confirm(`${__('¿Borrar el plan')} "${p.name}"?`)) return;
        try {
            await del.mutateAsync(p.slug);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    const editing = sheet !== null && sheet !== 'new' ? (plans.data ?? []).find((p) => p.slug === sheet) ?? null : null;

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-tone-mint/10 imcrm-text-tone-mint">
                            <CreditCard className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>{__('Planes')}</CardTitle>
                            <CardDescription>
                                {__('Límites y precios de cada plan. Un plan con precio aparece solo en el checkout de las empresas; sin precio = no se vende self-serve.')}
                            </CardDescription>
                        </div>
                    </div>
                    <Button size="sm" className="imcrm-shrink-0 imcrm-gap-1.5" onClick={() => setSheet('new')}>
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nuevo plan')}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                {error !== null && (
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        {error}
                    </div>
                )}

                {plans.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {__('Cargando planes…')}
                    </div>
                ) : (
                    <div className="imcrm-overflow-x-auto">
                        <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                            <thead>
                                <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-xs imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                    <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Plan')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-right">{__('Registros')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-right">{__('Usuarios')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-right">{__('Automat.')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-right">{__('USD/mes')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-right">{__('COP/mes')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium" />
                                </tr>
                            </thead>
                            <tbody>
                                {(plans.data ?? []).map((p) => (
                                    <tr key={p.slug} className="imcrm-border-b imcrm-border-border/60 imcrm-transition-colors last:imcrm-border-b-0 hover:imcrm-bg-muted/30">
                                        <td className="imcrm-py-2.5 imcrm-pr-3">
                                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setSheet(p.slug)}
                                                    className="imcrm-font-medium imcrm-text-foreground hover:imcrm-text-primary hover:imcrm-underline"
                                                >
                                                    {p.name}
                                                </button>
                                                {!p.is_active && (
                                                    <Badge variant="secondary" className="imcrm-px-1.5 imcrm-py-0 imcrm-text-[10px]">{__('Inactivo')}</Badge>
                                                )}
                                            </div>
                                            <div className="imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">{p.slug}</div>
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-right imcrm-tabular-nums">{fmtLimit(p.max_records)}</td>
                                        <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-right imcrm-tabular-nums">{fmtLimit(p.max_users)}</td>
                                        <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-right imcrm-tabular-nums">{fmtLimit(p.max_automations)}</td>
                                        <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-right imcrm-tabular-nums">
                                            {p.price_usd === null ? <span className="imcrm-text-muted-foreground">—</span> : USD.format(p.price_usd)}
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5 imcrm-text-right imcrm-tabular-nums">
                                            {p.price_cop === null ? <span className="imcrm-text-muted-foreground">—</span> : COP.format(p.price_cop)}
                                        </td>
                                        <td className="imcrm-px-2 imcrm-py-2.5">
                                            <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-1">
                                                <Button variant="ghost" size="sm" className="imcrm-gap-1" onClick={() => setSheet(p.slug)} aria-label={`${__('Editar')} ${p.name}`}>
                                                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    {__('Editar')}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="imcrm-text-destructive hover:imcrm-text-destructive"
                                                    disabled={del.isPending}
                                                    onClick={() => void remove(p)}
                                                    aria-label={`${__('Borrar')} ${p.name}`}
                                                >
                                                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>

            <PlanSheet
                open={sheet !== null}
                plan={editing}
                onClose={() => setSheet(null)}
            />
        </Card>
    );
}

/**
 * Panel lateral de alta/edición de un plan. `plan` null = alta (slug editable);
 * con plan = edición (el slug no cambia).
 */
function PlanSheet({ open, plan, onClose }: { open: boolean; plan: PlatformPlan | null; onClose: () => void }): JSX.Element {
    const create = useCreatePlan();
    const update = useUpdatePlan();
    const [slug, setSlug] = useState('');
    const [name, setName] = useState('');
    const [rec, setRec] = useState('');
    const [usr, setUsr] = useState('');
    const [aut, setAut] = useState('');
    const [usd, setUsd] = useState('');
    const [cop, setCop] = useState('');
    const [active, setActive] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setSlug(plan?.slug ?? '');
        setName(plan?.name ?? '');
        setRec(limitStr(plan?.max_records ?? null));
        setUsr(limitStr(plan?.max_users ?? null));
        setAut(limitStr(plan?.max_automations ?? null));
        setUsd(limitStr(plan?.price_usd ?? null));
        setCop(limitStr(plan?.price_cop ?? null));
        setActive(plan?.is_active ?? true);
        setError(null);
    }, [plan, open]);

    const busy = create.isPending || update.isPending;

    const save = async (): Promise<void> => {
        setError(null);
        const body = {
            name: name.trim(),
            max_records: toLimit(rec),
            max_users: toLimit(usr),
            max_automations: toLimit(aut),
            price_usd: toLimit(usd),
            price_cop: toLimit(cop),
            is_active: active,
        };
        try {
            if (plan) {
                await update.mutateAsync({ slug: plan.slug, input: body });
            } else {
                await create.mutateAsync({ slug: slug.trim(), ...body });
            }
            onClose();
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    return (
        <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <SheetContent aria-describedby={undefined}>
                <SheetHeader>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-tone-mint/10 imcrm-text-tone-mint">
                            <CreditCard className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <SheetTitle>{plan ? `${__('Editar plan')} ${plan.name}` : __('Nuevo plan')}</SheetTitle>
                            {plan && <span className="imcrm-font-mono imcrm-text-[11px] imcrm-text-muted-foreground">{plan.slug}</span>}
                        </div>
                        <SheetCloseButton aria-label={__('Cerrar')} />
                    </div>
                </SheetHeader>

                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                    {!plan && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="ps-slug" className="imcrm-text-xs">{__('Slug (no cambia después)')}</Label>
                            <Input id="ps-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="growth" className="imcrm-font-mono" />
                        </div>
                    )}
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor="ps-name" className="imcrm-text-xs">{__('Nombre')}</Label>
                        <Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Growth" />
                    </div>

                    <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <legend className="imcrm-mb-1 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__('Límites (vacío = ilimitado)')}
                        </legend>
                        <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-3">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="ps-rec" className="imcrm-text-xs">{__('Registros')}</Label>
                                <Input id="ps-rec" type="number" min={0} value={rec} onChange={(e) => setRec(e.target.value)} placeholder="∞" />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="ps-usr" className="imcrm-text-xs">{__('Usuarios')}</Label>
                                <Input id="ps-usr" type="number" min={0} value={usr} onChange={(e) => setUsr(e.target.value)} placeholder="∞" />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="ps-aut" className="imcrm-text-xs">{__('Automatizaciones')}</Label>
                                <Input id="ps-aut" type="number" min={0} value={aut} onChange={(e) => setAut(e.target.value)} placeholder="∞" />
                            </div>
                        </div>
                    </fieldset>

                    <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <legend className="imcrm-mb-1 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__('Precio de checkout (vacío = no se vende en esa moneda)')}
                        </legend>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="ps-usd" className="imcrm-text-xs">{__('USD / mes (PayPal)')}</Label>
                                <Input id="ps-usd" type="number" min={0} value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="—" />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="ps-cop" className="imcrm-text-xs">{__('COP / mes (Mercado Pago)')}</Label>
                                <Input id="ps-cop" type="number" min={0} value={cop} onChange={(e) => setCop(e.target.value)} placeholder="—" />
                            </div>
                        </div>
                    </fieldset>

                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                        {__('Plan activo (asignable y vendible)')}
                    </label>

                    {error !== null && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
                </SheetBody>

                <SheetFooter className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                        {__('Cancelar')}
                    </Button>
                    <Button
                        size="sm"
                        className="imcrm-gap-1.5"
                        disabled={busy || name.trim() === '' || (!plan && slug.trim() === '')}
                        onClick={() => void save()}
                    >
                        {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Save className="imcrm-h-4 imcrm-w-4" />}
                        {plan ? __('Guardar cambios') : __('Crear plan')}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

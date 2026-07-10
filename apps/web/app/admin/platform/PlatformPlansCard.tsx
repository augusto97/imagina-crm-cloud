import { useEffect, useState } from 'react';
import { CreditCard, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import type { PlatformPlan } from '@imagina-base/shared';

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

/**
 * Planes editables (operador, ADR-S15 F3). Cada fila edita nombre + límites
 * (records/usuarios/automatizaciones; vacío = ilimitado) + precios de checkout
 * (USD/COP; vacío = no vendible en esa moneda) + activo. Se puede crear un plan
 * nuevo o borrar uno (si no lo usa ninguna empresa). Un plan custom con precio
 * aparece automáticamente en el checkout self-serve de las empresas (ADR-S12).
 */
export function PlatformPlansCard(): JSX.Element {
    const plans = usePlatformPlans();
    const create = useCreatePlan();
    const del = useDeletePlan();

    const [slug, setSlug] = useState('');
    const [name, setName] = useState('');
    const [maxRecords, setMaxRecords] = useState('');
    const [maxUsers, setMaxUsers] = useState('');
    const [maxAuto, setMaxAuto] = useState('');
    const [priceUsd, setPriceUsd] = useState('');
    const [priceCop, setPriceCop] = useState('');
    const [error, setError] = useState<string | null>(null);

    const submitNew = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        try {
            await create.mutateAsync({
                slug: slug.trim(),
                name: name.trim(),
                max_records: toLimit(maxRecords),
                max_users: toLimit(maxUsers),
                max_automations: toLimit(maxAuto),
                price_usd: toLimit(priceUsd),
                price_cop: toLimit(priceCop),
                is_active: true,
            });
            setSlug('');
            setName('');
            setMaxRecords('');
            setMaxUsers('');
            setMaxAuto('');
            setPriceUsd('');
            setPriceCop('');
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    const remove = async (p: PlatformPlan): Promise<void> => {
        setError(null);
        if (!confirm(`${__('¿Borrar el plan')} "${p.name}"?`)) return;
        try {
            await del.mutateAsync(p.slug);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error'));
        }
    };

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <CreditCard className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                    <div>
                        <CardTitle>{__('Planes')}</CardTitle>
                        <CardDescription>
                            {__('Editá los límites (registros / usuarios / automatizaciones; vacío = ilimitado) y los precios de checkout (USD / COP; vacío = no vendible en esa moneda) de cada plan, o creá uno nuevo. Un plan con precio aparece solo en el checkout de las empresas.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-5">
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
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Nombre')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Registros')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Usuarios')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Automat.')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('USD/mes')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('COP/mes')}</th>
                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-right">{__('Acciones')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(plans.data ?? []).map((p) => (
                                    <PlanRow key={p.slug} plan={p} onDelete={() => void remove(p)} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Alta de plan */}
                <form onSubmit={submitNew} className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-p-3">
                    <span className="imcrm-text-sm imcrm-font-medium">{__('Nuevo plan')}</span>
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 md:imcrm-grid-cols-4 lg:imcrm-grid-cols-7">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="np-slug" className="imcrm-text-xs">{__('Slug')}</Label>
                            <Input id="np-slug" required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="growth" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="np-name" className="imcrm-text-xs">{__('Nombre')}</Label>
                            <Input id="np-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Growth" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="np-rec" className="imcrm-text-xs">{__('Registros')}</Label>
                            <Input id="np-rec" type="number" min={0} value={maxRecords} onChange={(e) => setMaxRecords(e.target.value)} placeholder="∞" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="np-usr" className="imcrm-text-xs">{__('Usuarios')}</Label>
                            <Input id="np-usr" type="number" min={0} value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} placeholder="∞" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="np-aut" className="imcrm-text-xs">{__('Automat.')}</Label>
                            <Input id="np-aut" type="number" min={0} value={maxAuto} onChange={(e) => setMaxAuto(e.target.value)} placeholder="∞" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="np-usd" className="imcrm-text-xs">{__('USD/mes')}</Label>
                            <Input id="np-usd" type="number" min={0} value={priceUsd} onChange={(e) => setPriceUsd(e.target.value)} placeholder="—" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="np-cop" className="imcrm-text-xs">{__('COP/mes')}</Label>
                            <Input id="np-cop" type="number" min={0} value={priceCop} onChange={(e) => setPriceCop(e.target.value)} placeholder="—" />
                        </div>
                    </div>
                    <div className="imcrm-flex imcrm-justify-end">
                        <Button type="submit" disabled={create.isPending} className="imcrm-gap-2">
                            {create.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Plus className="imcrm-h-4 imcrm-w-4" />}
                            {__('Crear plan')}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

function PlanRow({ plan, onDelete }: { plan: PlatformPlan; onDelete: () => void }): JSX.Element {
    const update = useUpdatePlan();
    const [name, setName] = useState(plan.name);
    const [rec, setRec] = useState(limitStr(plan.max_records));
    const [usr, setUsr] = useState(limitStr(plan.max_users));
    const [aut, setAut] = useState(limitStr(plan.max_automations));
    const [usd, setUsd] = useState(limitStr(plan.price_usd));
    const [cop, setCop] = useState(limitStr(plan.price_cop));
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        setName(plan.name);
        setRec(limitStr(plan.max_records));
        setUsr(limitStr(plan.max_users));
        setAut(limitStr(plan.max_automations));
        setUsd(limitStr(plan.price_usd));
        setCop(limitStr(plan.price_cop));
        setDirty(false);
    }, [plan]);

    const save = (): void => {
        update.mutate({
            slug: plan.slug,
            input: {
                name: name.trim(),
                max_records: toLimit(rec),
                max_users: toLimit(usr),
                max_automations: toLimit(aut),
                price_usd: toLimit(usd),
                price_cop: toLimit(cop),
            },
        });
        setDirty(false);
    };

    const touch = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>): void => {
        setter(e.target.value);
        setDirty(true);
    };

    return (
        <tr className="imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0">
            <td className="imcrm-py-2 imcrm-pr-3 imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">{plan.slug}</td>
            <td className="imcrm-px-2 imcrm-py-2">
                <Input value={name} onChange={touch(setName)} className="imcrm-h-8 imcrm-min-w-[110px]" />
            </td>
            <td className="imcrm-px-2 imcrm-py-2">
                <Input type="number" min={0} value={rec} onChange={touch(setRec)} placeholder="∞" className="imcrm-h-8 imcrm-w-24" />
            </td>
            <td className="imcrm-px-2 imcrm-py-2">
                <Input type="number" min={0} value={usr} onChange={touch(setUsr)} placeholder="∞" className="imcrm-h-8 imcrm-w-20" />
            </td>
            <td className="imcrm-px-2 imcrm-py-2">
                <Input type="number" min={0} value={aut} onChange={touch(setAut)} placeholder="∞" className="imcrm-h-8 imcrm-w-20" />
            </td>
            <td className="imcrm-px-2 imcrm-py-2">
                <Input type="number" min={0} value={usd} onChange={touch(setUsd)} placeholder="—" className="imcrm-h-8 imcrm-w-20" />
            </td>
            <td className="imcrm-px-2 imcrm-py-2">
                <Input type="number" min={0} value={cop} onChange={touch(setCop)} placeholder="—" className="imcrm-h-8 imcrm-w-24" />
            </td>
            <td className="imcrm-px-2 imcrm-py-2">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-2">
                    <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={!dirty || update.isPending} onClick={save}>
                        <Save className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Guardar')}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="imcrm-text-destructive hover:imcrm-text-destructive"
                        onClick={onDelete}
                        aria-label={`${__('Borrar')} ${plan.name}`}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                </div>
            </td>
        </tr>
    );
}

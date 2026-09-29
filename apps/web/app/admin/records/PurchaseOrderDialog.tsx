import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { PurchaseOrderCreated, PurchasePreviewItem } from '@imagina-base/shared';
import { AlertTriangle, CheckCircle2, Loader2, Truck, X } from 'lucide-react';

import { api as cloud } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CloudApiError } from '@/lib/cloud/client';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { parseMoney } from './parseMoney';

interface PurchaseOrderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    connectionId: number;
    resource: 'products' | 'variations';
    recordIds: number[];
    onCreated?: () => void;
}

const NEW_SUPPLIER = '__new__';

function errText(err: unknown): string {
    if (err instanceof CloudApiError || err instanceof Error) return err.message;
    return __('Error desconocido');
}

/**
 * Reposición (v0.1.209): arma una orden de compra con los productos o
 * variaciones seleccionados. Cada fila trae una cantidad SUGERIDA (un mes de
 * venta + la alerta de stock, menos lo que hay y lo que ya viene en camino) y
 * el costo de la última compra; todo se puede corregir antes de crearla.
 * La orden queda como un registro más de «Órdenes de compra»: al marcarla
 * recibida, las unidades se suman al stock de la tienda.
 */
export function PurchaseOrderDialog({
    open,
    onOpenChange,
    connectionId,
    resource,
    recordIds,
    onCreated,
}: PurchaseOrderDialogProps): JSX.Element {
    const qc = useQueryClient();
    const idsKey = recordIds.join(',');
    const preview = useQuery({
        queryKey: ['purchase-preview', connectionId, resource, idsKey] as const,
        queryFn: () => cloud.purchasePreview(connectionId, { resource, record_ids: recordIds }),
        enabled: open && recordIds.length > 0,
        staleTime: 0,
        retry: false,
    });
    const suppliers = useQuery({
        queryKey: ['purchase-suppliers', connectionId] as const,
        enabled: open,
        staleTime: 30_000,
        queryFn: async () => {
            const status = await cloud.storeSyncStatus(connectionId);
            const ref = status.purchase_lists.suppliers;
            if (!ref) return [] as { id: number; name: string }[];
            const fields = await cloud.listFields(ref.id);
            const title = fields.find((f) => f.is_primary) ?? fields.find((f) => f.slug === 'nombre');
            const page = await cloud.listRecords(ref.id, { limit: 200 });
            return page.data
                .map((r) => ({ id: r.id, name: title ? String(r.data[`f${title.id}`] ?? '') : '' }))
                .filter((s) => s.name !== '')
                .sort((a, b) => a.name.localeCompare(b.name, 'es'));
        },
    });

    const [qty, setQty] = useState<Record<number, string>>({});
    const [cost, setCost] = useState<Record<number, string>>({});
    const [supplier, setSupplier] = useState<string>('');
    const [supplierName, setSupplierName] = useState('');
    const [status, setStatus] = useState<'borrador' | 'enviada'>('borrador');
    const [expected, setExpected] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [created, setCreated] = useState<PurchaseOrderCreated | null>(null);

    // Sembrar las cantidades y costos sugeridos cuando llega la vista previa.
    useEffect(() => {
        if (!preview.data) return;
        const q: Record<number, string> = {};
        const c: Record<number, string> = {};
        for (const it of preview.data) {
            if (it.blocked) continue;
            q[it.record_id] = String(it.suggested);
            c[it.record_id] = it.last_cost !== null ? String(it.last_cost) : '';
        }
        setQty(q);
        setCost(c);
    }, [preview.data]);

    // Reabrir limpia el resultado anterior.
    useEffect(() => {
        if (open) {
            setCreated(null);
            setError(null);
        }
    }, [open]);

    useEffect(() => {
        if (supplier === '' && suppliers.data) setSupplier(suppliers.data.length > 0 ? '' : NEW_SUPPLIER);
    }, [suppliers.data, supplier]);

    const items: PurchasePreviewItem[] = preview.data ?? [];
    const orderable = items.filter((it) => !it.blocked);
    const lines = useMemo(
        () =>
            orderable
                .map((it) => ({ it, q: Math.round(Number(qty[it.record_id] ?? '0')), c: parseMoney(cost[it.record_id] ?? '') }))
                .filter((l) => Number.isFinite(l.q) && l.q > 0),
        [orderable, qty, cost],
    );
    const units = lines.reduce((a, l) => a + l.q, 0);
    const total = lines.reduce((a, l) => a + (l.c ?? 0) * l.q, 0);

    const submit = async (): Promise<void> => {
        setError(null);
        if (lines.length === 0) {
            setError(__('Poné al menos una cantidad mayor a cero.'));
            return;
        }
        if (supplier === NEW_SUPPLIER && supplierName.trim() === '') {
            setError(__('Escribí el nombre del proveedor nuevo, o elegí uno de la lista.'));
            return;
        }
        setBusy(true);
        try {
            const res = await cloud.purchaseCreateOrder(connectionId, {
                resource,
                items: lines.map((l) => ({ record_id: l.it.record_id, quantity: l.q, cost: l.c })),
                supplier_id: supplier !== '' && supplier !== NEW_SUPPLIER ? Number(supplier) : null,
                supplier_name: supplier === NEW_SUPPLIER ? supplierName.trim() : null,
                status,
                expected_date: expected || null,
                notes: notes.trim() || null,
            });
            setCreated(res);
            void qc.invalidateQueries({ queryKey: ['purchase-suppliers', connectionId] });
            void qc.invalidateQueries({ queryKey: ['records'] });
            onCreated?.();
        } catch (err) {
            setError(errText(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-3xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-flex imcrm-max-h-[88vh] imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-purchase-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-3.5">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                <Truck className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                                {__('Crear orden de compra')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Al marcarla recibida, las unidades se suman solas al stock de la tienda.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    {created ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-px-5 imcrm-py-6" data-testid="imcrm-purchase-created">
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-success" />
                                {sprintf(
                                    _n('Se creó la orden %1$s con %2$d artículo.', 'Se creó la orden %1$s con %2$d artículos.', created.lines),
                                    created.order_number,
                                    created.lines,
                                )}
                            </p>
                            {created.warnings.length > 0 && (
                                <ul className="imcrm-list-disc imcrm-space-y-1 imcrm-pl-5 imcrm-text-xs imcrm-text-warning">
                                    {created.warnings.map((w) => (
                                        <li key={w}>{w}</li>
                                    ))}
                                </ul>
                            )}
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {status === 'enviada'
                                    ? __('Ya figura «En camino» en cada artículo. Cuando llegue, cambiá su estado a «Recibida».')
                                    : __('Quedó en borrador: cuando la mandes al proveedor, pasala a «Enviada» y los artículos la verán «En camino».')}
                            </p>
                            <div className="imcrm-flex imcrm-gap-2">
                                <Button asChild size="sm">
                                    <Link to={`/lists/${created.list_slug}/records/${created.order_id}`} data-testid="imcrm-purchase-open">
                                        {__('Abrir la orden')}
                                    </Link>
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                                    {__('Listo')}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-4 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4">
                                {preview.isLoading && (
                                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                        {__('Calculando qué conviene pedir…')}
                                    </p>
                                )}
                                {preview.error && (
                                    <p className="imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-purchase-preview-error">
                                        {errText(preview.error)}
                                    </p>
                                )}
                                {items.length > 0 && (
                                    <div className="imcrm-overflow-x-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                                        <table className="imcrm-w-full imcrm-min-w-[36rem] imcrm-text-sm">
                                            <thead className="imcrm-bg-muted/50 imcrm-text-xs imcrm-text-muted-foreground">
                                                <tr>
                                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-font-medium">{__('Artículo')}</th>
                                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Stock')}</th>
                                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('En camino')}</th>
                                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Vendidas 30 d')}</th>
                                                    <th className="imcrm-w-24 imcrm-px-2 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Pedir')}</th>
                                                    <th className="imcrm-w-32 imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Costo unit.')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {items.map((it) => (
                                                    <tr
                                                        key={it.record_id}
                                                        className="imcrm-border-t imcrm-border-border"
                                                        data-testid={`imcrm-purchase-row-${it.record_id}`}
                                                    >
                                                        <td className="imcrm-px-3 imcrm-py-1.5">
                                                            <div className={cn('imcrm-font-medium', it.blocked && 'imcrm-text-muted-foreground')}>{it.name}</div>
                                                            {it.sku && <div className="imcrm-text-[11px] imcrm-text-muted-foreground">SKU {it.sku}</div>}
                                                            {it.blocked && (
                                                                <div className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-warning">
                                                                    <AlertTriangle className="imcrm-h-3 imcrm-w-3" />
                                                                    {it.blocked}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="imcrm-px-2 imcrm-py-1.5 imcrm-text-right imcrm-tabular-nums">
                                                            {it.stock === null ? '—' : formatNumber(it.stock)}
                                                        </td>
                                                        <td className="imcrm-px-2 imcrm-py-1.5 imcrm-text-right imcrm-tabular-nums">
                                                            {it.in_transit ? formatNumber(it.in_transit) : '—'}
                                                        </td>
                                                        <td className="imcrm-px-2 imcrm-py-1.5 imcrm-text-right imcrm-tabular-nums">
                                                            {formatNumber(it.sold_30d)}
                                                        </td>
                                                        <td className="imcrm-px-2 imcrm-py-1.5">
                                                            {!it.blocked && (
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    step={1}
                                                                    inputMode="numeric"
                                                                    className="imcrm-h-8 imcrm-text-right"
                                                                    value={qty[it.record_id] ?? ''}
                                                                    onChange={(e) => setQty((p) => ({ ...p, [it.record_id]: e.target.value }))}
                                                                    aria-label={sprintf(__('Cantidad de %s'), it.name)}
                                                                    data-testid={`imcrm-purchase-qty-${it.record_id}`}
                                                                />
                                                            )}
                                                        </td>
                                                        <td className="imcrm-px-3 imcrm-py-1.5">
                                                            {!it.blocked && (
                                                                <Input
                                                                    inputMode="decimal"
                                                                    className="imcrm-h-8 imcrm-text-right"
                                                                    placeholder="0"
                                                                    value={cost[it.record_id] ?? ''}
                                                                    onChange={(e) => setCost((p) => ({ ...p, [it.record_id]: e.target.value }))}
                                                                    aria-label={sprintf(__('Costo de %s'), it.name)}
                                                                    data-testid={`imcrm-purchase-cost-${it.record_id}`}
                                                                />
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {items.length > 0 && (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('La cantidad sugerida cubre un mes de venta más la alerta de stock, descontando lo que hay y lo que ya viene en camino.')}
                                    </p>
                                )}

                                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <Label htmlFor="po-supplier">{__('Proveedor')}</Label>
                                        <Select
                                            id="po-supplier"
                                            value={supplier}
                                            onChange={(e) => setSupplier(e.target.value)}
                                            data-testid="imcrm-purchase-supplier"
                                        >
                                            <option value="">{__('Sin proveedor')}</option>
                                            {(suppliers.data ?? []).map((s) => (
                                                <option key={s.id} value={String(s.id)}>
                                                    {s.name}
                                                </option>
                                            ))}
                                            <option value={NEW_SUPPLIER}>{__('+ Proveedor nuevo…')}</option>
                                        </Select>
                                        {supplier === NEW_SUPPLIER && (
                                            <Input
                                                placeholder={__('Nombre del proveedor')}
                                                value={supplierName}
                                                onChange={(e) => setSupplierName(e.target.value)}
                                                data-testid="imcrm-purchase-supplier-name"
                                            />
                                        )}
                                    </div>
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <Label htmlFor="po-status">{__('Estado')}</Label>
                                        <Select
                                            id="po-status"
                                            value={status}
                                            onChange={(e) => setStatus(e.target.value as 'borrador' | 'enviada')}
                                            data-testid="imcrm-purchase-status"
                                        >
                                            <option value="borrador">{__('Borrador (todavía no se pidió)')}</option>
                                            <option value="enviada">{__('Enviada al proveedor')}</option>
                                        </Select>
                                    </div>
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                        <Label htmlFor="po-expected">{__('Llega el')}</Label>
                                        <Input
                                            id="po-expected"
                                            type="date"
                                            value={expected}
                                            onChange={(e) => setExpected(e.target.value)}
                                            data-testid="imcrm-purchase-expected"
                                        />
                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {__('Vacío: según los días de entrega del proveedor.')}
                                        </span>
                                    </div>
                                </div>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <Label htmlFor="po-notes">{__('Notas')}</Label>
                                    <Textarea id="po-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                                </div>
                                {error && (
                                    <p className="imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-purchase-error">
                                        {error}
                                    </p>
                                )}
                            </div>
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                                <span className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-purchase-summary">
                                    {sprintf(_n('%d artículo', '%d artículos', lines.length), lines.length)} · {formatNumber(units)}{' '}
                                    {__('unidades')}
                                    {total > 0 && ` · ${__('Total')} ${formatNumber(total)}`}
                                </span>
                                <div className="imcrm-flex imcrm-gap-2">
                                    <Dialog.Close asChild>
                                        <Button variant="outline" size="sm">
                                            {__('Cancelar')}
                                        </Button>
                                    </Dialog.Close>
                                    <Button
                                        size="sm"
                                        onClick={() => void submit()}
                                        disabled={busy || orderable.length === 0}
                                        data-testid="imcrm-purchase-submit"
                                    >
                                        {busy && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                                        {__('Crear orden')}
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

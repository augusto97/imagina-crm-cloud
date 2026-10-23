import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
    DATA_CONSENT_WITHDRAW_VIA_LABELS,
    type DataConsentRecordDto,
    type ListDataConsentsQuery,
} from '@imagina-base/shared';
import { Download, FileCheck2, Loader2, Search, X } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';

type Filters = Pick<ListDataConsentsQuery, 'status' | 'source'> & { from: string; to: string; q: string };

const PAGE = 50;

/** El filtro tal como viaja (sin claves vacías). */
function toQuery(f: Filters): Partial<ListDataConsentsQuery> {
    const out: Partial<ListDataConsentsQuery> = { status: f.status, source: f.source };
    if (f.from !== '') out.from = f.from;
    if (f.to !== '') out.to = f.to;
    if (f.q.trim() !== '') out.q = f.q.trim();
    return out;
}

/**
 * La evidencia de cada autorización (Ley 1581): quién, desde dónde, qué
 * versión del texto, cuándo, IP y navegador — y si la retiró. Con filtros,
 * descarga en CSV y «Registrar retiro» para los que llegan por otro canal.
 */
export function DataConsentRecords(): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const tenantId = useSession((s) => s.activeTenantId);
    const [filters, setFilters] = useState<Filters>({ status: 'all', source: 'all', from: '', to: '', q: '' });
    const q = useDebouncedValue(filters.q, 300);
    const query = useMemo(() => toQuery({ ...filters, q }), [filters, q]);
    // Las páginas que se fueron sumando con «Cargar más» (se reinician al filtrar).
    const [cursors, setCursors] = useState<number[]>([]);
    const [withdrawing, setWithdrawing] = useState<DataConsentRecordDto | null>(null);
    const [exporting, setExporting] = useState(false);

    useEffect(() => setCursors([]), [query]);

    const first = useQuery({
        queryKey: ['data-consent-records', tenantId, query],
        queryFn: () => api.dataConsentRecords({ ...query, limit: PAGE }),
        retry: false,
    });
    const more = useQuery({
        queryKey: ['data-consent-records', tenantId, query, 'more', cursors],
        queryFn: async () => {
            const pages = await Promise.all(cursors.map((before) => api.dataConsentRecords({ ...query, limit: PAGE, before })));
            return pages;
        },
        enabled: cursors.length > 0,
        retry: false,
    });

    const pages = [first.data, ...(more.data ?? [])].filter((p): p is NonNullable<typeof p> => p !== undefined);
    const items = pages.flatMap((p) => p.items);
    const nextCursor = pages.length > 0 ? pages[pages.length - 1]!.next_cursor : null;

    const set = <K extends keyof Filters>(key: K, value: Filters[K]): void => setFilters((f) => ({ ...f, [key]: value }));

    const download = async (): Promise<void> => {
        setExporting(true);
        try {
            const { blob, filename } = await api.dataConsentExport(query);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
            toast.error(e instanceof CloudApiError ? e.message : __('No se pudo descargar el archivo.'));
        } finally {
            setExporting(false);
        }
    };

    const filtered = filters.status !== 'all' || filters.source !== 'all' || filters.from !== '' || filters.to !== '' || q.trim() !== '';

    return (
        <Card data-testid="data-consent-records">
            <CardHeader className="imcrm-flex imcrm-flex-row imcrm-flex-wrap imcrm-items-start imcrm-gap-3 imcrm-space-y-0">
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                        <FileCheck2 className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Autorizaciones registradas')}
                    </CardTitle>
                    <CardDescription>
                        {__('La prueba de cada autorización: quién la dio, desde dónde, qué versión del texto aceptó, cuándo, desde qué IP y navegador, y si la retiró.')}
                    </CardDescription>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void download()}
                    disabled={exporting}
                    data-testid="data-consent-export"
                >
                    {exporting ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Download className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {__('Descargar CSV')}
                </Button>
            </CardHeader>
            <CardContent className="imcrm-space-y-3">
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2 md:imcrm-grid-cols-[1fr_1fr_auto_auto_1.4fr]">
                    <label className="imcrm-space-y-1">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Estado')}</span>
                        <Select
                            value={filters.status}
                            onChange={(e) => set('status', e.target.value as Filters['status'])}
                            data-testid="data-consent-filter-status"
                        >
                            <option value="all">{__('Todas')}</option>
                            <option value="active">{__('Vigentes')}</option>
                            <option value="withdrawn">{__('Retiradas')}</option>
                        </Select>
                    </label>
                    <label className="imcrm-space-y-1">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Origen')}</span>
                        <Select
                            value={filters.source}
                            onChange={(e) => set('source', e.target.value as Filters['source'])}
                            data-testid="data-consent-filter-source"
                        >
                            <option value="all">{__('Todos')}</option>
                            <option value="form">{__('Formularios')}</option>
                            <option value="portal">{__('Portal del cliente')}</option>
                        </Select>
                    </label>
                    <label className="imcrm-space-y-1">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Desde')}</span>
                        <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} data-testid="data-consent-filter-from" />
                    </label>
                    <label className="imcrm-space-y-1">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Hasta')}</span>
                        <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} data-testid="data-consent-filter-to" />
                    </label>
                    <label className="imcrm-col-span-2 imcrm-space-y-1 md:imcrm-col-span-1">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Titular')}</span>
                        <span className="imcrm-relative imcrm-block">
                            <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" />
                            <Input
                                className="imcrm-pl-8"
                                placeholder={__('Nombre o correo')}
                                value={filters.q}
                                onChange={(e) => set('q', e.target.value)}
                                data-testid="data-consent-filter-q"
                            />
                        </span>
                    </label>
                </div>

                {first.isLoading ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
                ) : first.isError ? (
                    <p className="imcrm-text-sm imcrm-text-destructive">
                        {first.error instanceof CloudApiError ? first.error.message : __('No se pudo cargar la lista.')}
                    </p>
                ) : items.length === 0 ? (
                    <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        {filtered
                            ? __('No hay autorizaciones con esos filtros.')
                            : __('Todavía no hay autorizaciones. Aparecen aquí cuando alguien acepta el texto en un formulario o en el portal.')}
                    </div>
                ) : (
                    <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid="data-consent-record-list">
                        {items.map((c) => (
                            <ConsentRow key={c.id} consent={c} onWithdraw={() => setWithdrawing(c)} />
                        ))}
                    </ul>
                )}

                {nextCursor !== null && (
                    <div className="imcrm-flex imcrm-justify-center">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={more.isFetching}
                            onClick={() => setCursors((c) => [...c, nextCursor])}
                        >
                            {more.isFetching && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {__('Cargar más')}
                        </Button>
                    </div>
                )}
            </CardContent>

            {withdrawing && (
                <WithdrawDialog
                    consent={withdrawing}
                    onClose={() => setWithdrawing(null)}
                    onDone={() => {
                        setWithdrawing(null);
                        void qc.invalidateQueries({ queryKey: ['data-consent-records', tenantId] });
                        void qc.invalidateQueries({ queryKey: ['data-consent', tenantId] });
                        toast.success(__('Retiro registrado.'));
                    }}
                />
            )}
        </Card>
    );
}

function ConsentRow({ consent: c, onWithdraw }: { consent: DataConsentRecordDto; onWithdraw: () => void }): JSX.Element {
    const who = c.subject_name || c.subject_email || __('Sin nombre');
    const withdrawn = c.withdrawn_at !== null;
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-px-3 imcrm-py-2.5 sm:imcrm-flex-row sm:imcrm-items-start sm:imcrm-gap-3" data-testid="data-consent-record">
            <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-space-y-0.5">
                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-sm">
                    <span className="imcrm-font-medium">{who}</span>
                    {c.subject_name && c.subject_email && <span className="imcrm-text-xs imcrm-text-muted-foreground">{c.subject_email}</span>}
                    {withdrawn ? <Badge variant="destructive">{__('Retirada')}</Badge> : <Badge variant="success">{__('Vigente')}</Badge>}
                </p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {c.source_label}
                    {c.list_slug && c.record_id !== null && (
                        <>
                            {' · '}
                            <Link className="imcrm-text-primary hover:imcrm-underline" to={`/lists/${c.list_slug}/records?record=${c.record_id}`}>
                                {__('Registro')} #{c.record_id}
                                {c.list_name ? ` ${__('en')} «${c.list_name}»` : ''}
                            </Link>
                        </>
                    )}
                </p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Aceptada el')} {formatDateTime(parseUtcDate(c.accepted_at))} · {__('versión')} {c.version}
                    {c.ip ? ` · IP ${c.ip}` : ''}
                </p>
                {c.user_agent && (
                    <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground/80" title={c.user_agent}>
                        {c.user_agent}
                    </p>
                )}
                {withdrawn && (
                    <p className="imcrm-text-xs imcrm-text-[hsl(var(--imcrm-destructive-ink))]">
                        {__('Retirada el')} {formatDateTime(parseUtcDate(c.withdrawn_at!))}
                        {c.withdrawn_via ? ` ${__(DATA_CONSENT_WITHDRAW_VIA_LABELS[c.withdrawn_via])}` : ''}
                        {c.withdrawn_by_name ? ` (${c.withdrawn_by_name})` : ''}
                        {c.withdrawn_note ? ` — ${c.withdrawn_note}` : ''}
                    </p>
                )}
            </div>
            {!withdrawn && (
                <Button type="button" variant="ghost" size="sm" className="imcrm-self-start" onClick={onWithdraw} data-testid="data-consent-withdraw">
                    {__('Registrar retiro')}
                </Button>
            )}
        </li>
    );
}

function WithdrawDialog({
    consent,
    onClose,
    onDone,
}: {
    consent: DataConsentRecordDto;
    onClose: () => void;
    onDone: () => void;
}): JSX.Element {
    const [note, setNote] = useState('');
    const m = useMutation({ mutationFn: () => api.dataConsentWithdraw(consent.id, note), onSuccess: onDone });
    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="data-consent-withdraw-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Registrar retiro de la autorización')}</Dialog.Title>
                            <Dialog.Description className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Úsalo cuando el titular pidió retirarla por otro canal (correo, teléfono, en persona). Queda registrado con tu nombre y la fecha. Los datos del registro no se borran.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    <p className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-sm">
                        <span className="imcrm-font-medium">{consent.subject_name || consent.subject_email || __('Sin nombre')}</span>
                        <span className="imcrm-text-muted-foreground"> · {consent.source_label}</span>
                    </p>
                    <label className="imcrm-space-y-1">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cómo llegó el pedido (opcional)')}</span>
                        <Textarea
                            value={note}
                            maxLength={500}
                            rows={3}
                            placeholder={__('Ej.: lo pidió por correo el 3 de octubre.')}
                            onChange={(e) => setNote(e.target.value)}
                            data-testid="data-consent-withdraw-note"
                        />
                    </label>
                    {m.isError && (
                        <p className="imcrm-text-sm imcrm-text-destructive">
                            {m.error instanceof CloudApiError ? m.error.message : __('No se pudo registrar el retiro.')}
                        </p>
                    )}
                    <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                        <Button type="button" variant="ghost" onClick={onClose}>
                            {__('Cancelar')}
                        </Button>
                        <Button type="button" variant="destructive" disabled={m.isPending} onClick={() => m.mutate()} data-testid="data-consent-withdraw-confirm">
                            {m.isPending && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {__('Registrar retiro')}
                        </Button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

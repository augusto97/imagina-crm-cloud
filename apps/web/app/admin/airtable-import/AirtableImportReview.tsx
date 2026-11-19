import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, Calculator, ChevronDown, Info, Link2, Loader2, Paperclip, Type } from 'lucide-react';
import { resolveAirtablePlan, type AirtableFieldInfo, type AirtableImportStatus, type AirtablePlan, type AirtableTableSchema, type AirtableTargetType } from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { countOf, formatBytes, patchField, patchTable, reviewInfos, setAttachments, targetLabel } from './airtablePlanEdit';

interface Props {
    status: AirtableImportStatus;
    plan: AirtablePlan;
    onPlan: (plan: AirtablePlan) => void;
    capToLimit: boolean;
    onCapToLimit: (v: boolean) => void;
    importing: boolean;
    error: string | null;
    onImport: () => void;
}

/**
 * v0.1.458 — La revisión antes de crear: qué tablas, qué campos y con qué
 * tipo, el título de cada registro, lo que queda fuera (con el porqué) y los
 * límites del plan. La vista previa usa la MISMA función que el servidor
 * (`resolveAirtablePlan`): lo que se ve es lo que se crea.
 */
export function AirtableImportReview({ status, plan, onPlan, capToLimit, onCapToLimit, importing, error, onImport }: Props): JSX.Element {
    const resolved = useMemo(
        () => resolveAirtablePlan(plan, status.tables, status.scan, { currency: status.defaults.currency, country: status.defaults.country }),
        [plan, status.tables, status.scan, status.defaults],
    );
    const infos = useMemo(() => reviewInfos(plan, status.tables, status.scan), [plan, status.tables, status.scan]);
    const limit = status.limit;
    const remaining = limit?.records_remaining ?? null;
    const overRecords = remaining !== null && resolved.records > remaining;
    const room = limit?.storage_room ?? null;
    const allFiles = status.scan.reduce(
        (acc, s) => {
            for (const a of Object.values(s.attachments)) {
                acc.files += a.files;
                acc.bytes += a.bytes;
                acc.big += a.too_big;
            }
            return acc;
        },
        { files: 0, bytes: 0, big: 0 },
    );
    const overStorage = plan.attachments && room !== null && resolved.file_bytes > room;
    const blocked = resolved.errors.length > 0 || overStorage || (overRecords && !capToLimit) || (remaining !== null && remaining <= 0);
    const willImport = overRecords && capToLimit && remaining !== null ? remaining : resolved.records;
    const included = plan.tables.filter((t) => t.include).length;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="airtable-review">
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4 sm:imcrm-p-5" data-tour="airtable-review-summary">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                    <h2 className="imcrm-text-base imcrm-font-semibold">{sprintf(__('«%s» en Airtable'), status.base?.name ?? '')}</h2>
                    <span className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="airtable-review-totals">
                        {countOf(included, __('tabla'), __('tablas'))} · {countOf(resolved.records, __('registro'), __('registros'))}
                    </span>
                </div>
                {included > 1 && (
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 sm:imcrm-max-w-md">
                        <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Carpeta donde quedan las listas')}</span>
                        <Input value={plan.folder_name ?? ''} onChange={(e) => onPlan({ ...plan, folder_name: e.target.value.slice(0, 80) })} data-testid="airtable-folder" />
                    </label>
                )}
                {allFiles.files + allFiles.big > 0 && (
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-sm" data-tour="airtable-attachments">
                        <input type="checkbox" className="imcrm-mt-0.5" checked={plan.attachments} onChange={(e) => onPlan(setAttachments(plan, status.tables, e.target.checked))} data-testid="airtable-attachments" />
                        <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                                <Paperclip className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                {sprintf(__('Traer los adjuntos (%1$s, %2$s)'), countOf(allFiles.files, __('archivo'), __('archivos')), formatBytes(allFiles.bytes))}
                            </span>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {limit?.storage_external
                                    ? __('Se guardan en el almacenamiento propio de tu empresa.')
                                    : room === null
                                      ? __('Cuentan para el almacenamiento de tu plan.')
                                      : sprintf(__('Cuentan para el almacenamiento de tu plan: te quedan %s.'), formatBytes(Math.max(0, room)))}
                                {allFiles.big > 0 && ` ${allFiles.big === 1 ? __('1 archivo pesa más de 15 MB y no se baja.') : sprintf(__('%s archivos pesan más de 15 MB y no se bajan.'), String(allFiles.big))}`}
                            </span>
                        </span>
                    </label>
                )}
                {overStorage && (
                    <Notice tone="warn" testId="airtable-storage-warning">
                        {sprintf(__('Los adjuntos pesan %1$s y en tu plan quedan %2$s: desmarca «Traer los adjuntos» o libera espacio.'), formatBytes(resolved.file_bytes), formatBytes(Math.max(0, room ?? 0)))}
                    </Notice>
                )}
                {overRecords && remaining !== null && (
                    <Notice tone="warn" testId="airtable-limit-warning">
                        <span className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <span>
                                {remaining <= 0
                                    ? __('Tu plan ya no tiene lugar para más registros. Pasa a un plan mayor para importar.')
                                    : sprintf(__('La base trae %1$s registros y a tu plan le quedan %2$s.'), resolved.records.toLocaleString('es'), remaining.toLocaleString('es'))}
                            </span>
                            {remaining > 0 && (
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-font-medium">
                                    <input type="checkbox" checked={capToLimit} onChange={(e) => onCapToLimit(e.target.checked)} data-testid="airtable-cap" />
                                    {sprintf(__('Importar sólo los primeros %s registros'), remaining.toLocaleString('es'))}
                                </label>
                            )}
                        </span>
                    </Notice>
                )}
                {resolved.errors.map((e) => (
                    <Notice key={e} tone="error">
                        {e}
                    </Notice>
                ))}
                {resolved.notes.map((n) => (
                    <Notice key={n} tone="info">
                        {n}
                    </Notice>
                ))}
            </section>

            {status.tables.map((t) => (
                <TableCard key={t.id} table={t} plan={plan} infos={infos.get(t.id) ?? new Map()} records={status.scan.find((s) => s.table_id === t.id)?.records ?? 0} onPlan={onPlan} tables={status.tables} />
            ))}

            {error && (
                <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-destructive-ink))]" role="alert" data-testid="airtable-apply-error">
                    {error}
                </p>
            )}
            <div className="imcrm-sticky imcrm-bottom-0 imcrm-z-10 imcrm--mx-1 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-bg-background/95 imcrm-px-1 imcrm-py-3 imcrm-backdrop-blur sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-justify-between">
                <span className="imcrm-text-sm imcrm-text-muted-foreground">
                    {resolved.lists.length === 1 ? sprintf(__('Se crea 1 lista con %s.'), countOf(willImport, __('registro'), __('registros'))) : sprintf(__('Se crean %1$s listas con %2$s.'), String(resolved.lists.length), countOf(willImport, __('registro'), __('registros')))}
                </span>
                <Button onClick={onImport} disabled={blocked || importing} className="imcrm-gap-2" data-testid="airtable-import-apply" data-tour="airtable-import-apply">
                    {importing ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <ArrowRight className="imcrm-h-4 imcrm-w-4" />}
                    {__('Importar')}
                </Button>
            </div>
        </div>
    );
}

function Notice({ tone, children, testId }: { tone: 'warn' | 'error' | 'info'; children: React.ReactNode; testId?: string }): JSX.Element {
    const Icon = tone === 'info' ? Info : AlertTriangle;
    return (
        <div
            className={cn(
                'imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-px-3 imcrm-py-2 imcrm-text-sm',
                tone === 'error' && 'imcrm-bg-destructive/10 imcrm-text-[hsl(var(--imcrm-destructive-ink))]',
                tone === 'warn' && 'imcrm-bg-warning/15 imcrm-text-foreground',
                tone === 'info' && 'imcrm-bg-muted imcrm-text-muted-foreground',
            )}
            role={tone === 'info' ? undefined : 'alert'}
            data-testid={testId}
        >
            <Icon className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
            <div className="imcrm-min-w-0 imcrm-flex-1">{children}</div>
        </div>
    );
}

function TableCard({
    table,
    tables,
    plan,
    infos,
    records,
    onPlan,
}: {
    table: AirtableTableSchema;
    tables: readonly AirtableTableSchema[];
    plan: AirtablePlan;
    infos: Map<string, AirtableFieldInfo>;
    records: number;
    onPlan: (p: AirtablePlan) => void;
}): JSX.Element | null {
    const pt = plan.tables.find((x) => x.table_id === table.id);
    if (!pt) return null;
    const rows = table.fields.map((f) => ({ f, p: pt.fields.find((x) => x.field_id === f.id), info: infos.get(f.id) }));
    const usable = rows.filter((r) => r.info && r.info.type !== null && !r.info.locked && r.p);
    const locked = rows.filter((r) => !r.info || r.info.type === null || r.info.locked);
    const kept = usable.filter((r) => r.p!.include || r.f.id === pt.title_field_id).length;
    const title = table.fields.find((f) => f.id === pt.title_field_id);

    return (
        <section className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4 sm:imcrm-p-5', !pt.include && 'imcrm-opacity-60')} data-testid={`airtable-table-${table.id}`}>
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-3 sm:imcrm-flex-row sm:imcrm-items-end sm:imcrm-justify-between">
                <label className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{sprintf(__('Tabla «%s» → nombre de la lista'), table.name)}</span>
                    <Input value={pt.name} onChange={(e) => onPlan(patchTable(plan, table.id, { name: e.target.value.slice(0, 80) }))} disabled={!pt.include} className="imcrm-text-base imcrm-font-semibold sm:imcrm-max-w-md" data-testid={`airtable-table-name-${table.id}`} />
                </label>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" checked={pt.include} onChange={(e) => onPlan(patchTable(plan, table.id, { include: e.target.checked }))} data-testid={`airtable-table-include-${table.id}`} />
                    {__('Importar esta tabla')}
                </label>
            </header>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(__('%1$s · %2$s · título: «%3$s»'), countOf(records, __('registro'), __('registros')), countOf(kept, __('campo'), __('campos')), title?.name ?? '')}
            </p>
            {pt.include && (
                <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-rounded-lg imcrm-border" data-tour="airtable-fields">
                    {usable.map(({ f, p, info }) => {
                        const isTitle = f.id === pt.title_field_id;
                        const Icon = fieldTypeIcon(p!.type);
                        const linkTo = info!.link_table_id ? tables.find((x) => x.id === info!.link_table_id)?.name : null;
                        return (
                            <div key={f.id} className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-p-3 md:imcrm-flex-row md:imcrm-items-start', !p!.include && !isTitle && 'imcrm-opacity-60')} data-testid={`airtable-field-${f.id}`}>
                                <label className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 md:imcrm-w-56 md:imcrm-shrink-0">
                                    <input
                                        type="checkbox"
                                        checked={p!.include || isTitle}
                                        disabled={isTitle}
                                        onChange={(e) => onPlan(patchField(plan, table.id, f.id, { include: e.target.checked }))}
                                        aria-label={sprintf(__('Importar «%s»'), f.name)}
                                        data-testid={`airtable-field-include-${f.id}`}
                                    />
                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                        <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{f.name}</span>
                                        <span className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                                            {isTitle && (
                                                <Badge variant="secondary" className="imcrm-gap-1 imcrm-text-[10px]">
                                                    <Type className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                    {__('Título')}
                                                </Badge>
                                            )}
                                            {info!.fixed && (
                                                <Badge variant="outline" className="imcrm-gap-1 imcrm-text-[10px]">
                                                    <Calculator className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                    {__('Valor fijo')}
                                                </Badge>
                                            )}
                                            {linkTo && (
                                                <Badge variant="outline" className="imcrm-gap-1 imcrm-text-[10px]">
                                                    <Link2 className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                    {linkTo}
                                                </Badge>
                                            )}
                                        </span>
                                    </span>
                                </label>
                                {(p!.include || isTitle) && (
                                    <div className="imcrm-grid imcrm-min-w-0 imcrm-flex-1 imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                                        <Input
                                            value={p!.label}
                                            onChange={(e) => onPlan(patchField(plan, table.id, f.id, { label: e.target.value.slice(0, 80) }))}
                                            aria-label={sprintf(__('Nombre del campo «%s»'), f.name)}
                                            className="imcrm-h-9"
                                            data-testid={`airtable-field-label-${f.id}`}
                                        />
                                        <div className="imcrm-relative">
                                            <Icon className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-2.5 imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                                            <Select
                                                value={p!.type}
                                                onChange={(e) => onPlan(patchField(plan, table.id, f.id, { type: e.target.value as AirtableTargetType }))}
                                                disabled={info!.alternatives.length < 2}
                                                className="imcrm-h-9 imcrm-pl-8"
                                                aria-label={sprintf(__('Tipo del campo «%s»'), f.name)}
                                                data-testid={`airtable-field-type-${f.id}`}
                                            >
                                                {info!.alternatives.map((a) => (
                                                    <option key={a} value={a}>
                                                        {targetLabel(a)}
                                                    </option>
                                                ))}
                                            </Select>
                                        </div>
                                        <p className="imcrm-text-xs imcrm-text-muted-foreground sm:imcrm-col-span-2">{info!.reason}</p>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {pt.include && locked.length > 0 && (
                <details className="imcrm-group imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-px-3 imcrm-py-2" data-testid={`airtable-locked-${table.id}`}>
                    <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-text-muted-foreground">
                        <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-transition-transform group-open:imcrm-rotate-180" aria-hidden />
                        {locked.length === 1 ? __('1 campo que no se importa') : sprintf(__('%s campos que no se importan'), String(locked.length))}
                    </summary>
                    <ul className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        {locked.map(({ f, info }) => (
                            <li key={f.id} className="imcrm-text-xs">
                                <span className="imcrm-font-medium">{f.name}</span>
                                <span className="imcrm-text-muted-foreground"> — {info?.reason ?? __('No se puede importar.')}</span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </section>
    );
}

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, Info, Link2, Loader2, ShieldCheck, Sparkles, Split, Wand2 } from 'lucide-react';
import {
    FILE_IMPORT_DATA_KIND_LABELS,
    FILE_IMPORT_FIELD_TYPES,
    resolveFileImportPlan,
    type FileImportAnalysis,
    type FileImportField,
    type FileImportFieldType,
    type FileImportPlan,
    type FileImportSheetProfile,
} from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { OptionChip } from '@/admin/records/renderCellValue';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { fieldTypeLabel } from '@/lib/fieldTypeCatalog';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldOption } from '@/admin/records/fieldOptions';

import { movedColumns, patchEntity, patchField, patchLink, patchList, previewCell } from './planEdit';

interface Props {
    analysis: FileImportAnalysis;
    plan: FileImportPlan;
    onPlan: (plan: FileImportPlan) => void;
    notes: string[];
    /** La IA: estado y acción. */
    ai: {
        running: boolean;
        stage: string | null;
        error: string | null;
        used: boolean;
        onStart: () => void;
        onBackToDraft: (() => void) | null;
    };
    /** Con el plan lleno: importar sólo los que entran. */
    capToLimit: boolean;
    onCapToLimit: (v: boolean) => void;
    creating: boolean;
    createError: string | null;
    onCreate: () => void;
}

/**
 * v0.1.339 (ADR-S88) — La revisión del plan: cada columna con el tipo que se
 * propone y por qué, cómo van a quedar sus valores, qué se descarta, qué pasa
 * a una lista aparte y qué se vincula. La vista previa usa el MISMO lector
 * que el servidor: lo que se ve es lo que se crea.
 */
export function FileImportReview({ analysis, plan, onPlan, notes, ai, capToLimit, onCapToLimit, creating, createError, onCreate }: Props): JSX.Element {
    const resolved = useMemo(() => resolveFileImportPlan(plan, analysis.sheets), [plan, analysis.sheets]);
    const remaining = analysis.limit.remaining;
    const overLimit = remaining !== null && resolved.records > remaining;
    const blocked = resolved.errors.length > 0 || (overLimit && !capToLimit) || resolved.lists.length === 0;
    const toCreate = overLimit && capToLimit ? remaining! : resolved.records;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5 imcrm-pb-24" data-testid="file-import-review">
            <SummaryCard analysis={analysis} plan={plan} notes={notes} />
            <AiCard analysis={analysis} ai={ai} />

            {plan.lists.map((l) => (
                <SheetSection key={l.sheet} analysis={analysis} plan={plan} sheet={l.sheet} onPlan={onPlan} multiple={plan.lists.length > 1} />
            ))}

            {resolved.lists.length > 1 && (
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-bg-card imcrm-p-4 sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-gap-3">
                    <span className="imcrm-text-sm imcrm-font-medium">{__('Carpeta donde quedan las listas')}</span>
                    <Input
                        value={plan.folder_name ?? ''}
                        placeholder={resolved.folder_name ?? ''}
                        onChange={(e) => onPlan({ ...plan, folder_name: e.target.value.slice(0, 80) })}
                        className="sm:imcrm-max-w-sm"
                        data-testid="file-import-folder"
                    />
                </label>
            )}

            {overLimit && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-4" data-testid="file-import-limit">
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" aria-hidden />
                        {sprintf(
                            __('El archivo trae %1$s registros y a tu plan le quedan %2$s. Puedes importar los primeros %2$s o pasar a un plan mayor.'),
                            String(resolved.records),
                            String(remaining),
                        )}
                    </p>
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                        <input type="checkbox" checked={capToLimit} onChange={(e) => onCapToLimit(e.target.checked)} data-testid="file-import-cap" />
                        {sprintf(__('Importar sólo los primeros %s'), String(remaining))}
                    </label>
                </div>
            )}

            {(resolved.errors.length > 0 || resolved.notes.length > 0) && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="file-import-errors">
                    {resolved.errors.map((e) => (
                        <li
                            key={e}
                            className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-destructive-ink))]"
                        >
                            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                            {e}
                        </li>
                    ))}
                    {resolved.notes.map((e) => (
                        <li key={e} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted imcrm-px-3 imcrm-py-2 imcrm-text-sm">
                            <Info className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            {e}
                        </li>
                    ))}
                </ul>
            )}

            <div className="imcrm-sticky imcrm-bottom-0 imcrm-z-10 -imcrm-mx-2 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-bg-background/95 imcrm-px-2 imcrm-py-3 imcrm-backdrop-blur sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-justify-between">
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="file-import-totals">
                    {resolved.lists.length === 1
                        ? sprintf(__('Se va a crear 1 lista con %s registros.'), String(toCreate))
                        : sprintf(__('Se van a crear %1$s listas con %2$s registros.'), String(resolved.lists.length), String(toCreate))}
                </p>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 sm:imcrm-items-end">
                    {createError && <span className="imcrm-text-sm imcrm-text-[hsl(var(--imcrm-destructive-ink))]">{createError}</span>}
                    <Button onClick={onCreate} disabled={blocked || creating || ai.running} className="imcrm-gap-2" data-testid="file-import-create" data-tour="file-import-create">
                        {creating ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <ArrowRight className="imcrm-h-4 imcrm-w-4" />}
                        {resolved.lists.length > 1 ? __('Crear las listas') : __('Crear la lista')}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function SummaryCard({ analysis, plan, notes }: { analysis: FileImportAnalysis; plan: FileImportPlan; notes: string[] }): JSX.Element {
    const rows = analysis.sheets.reduce((n, s) => n + s.rows, 0);
    const truncated = analysis.sheets.filter((s) => s.truncated);
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4 sm:imcrm-p-5" data-testid="file-import-summary">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Badge variant="secondary">{FILE_IMPORT_DATA_KIND_LABELS[plan.kind]}</Badge>
                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                    {analysis.sheets.length === 1
                        ? sprintf(__('%1$s filas · %2$s columnas'), String(rows), String(analysis.sheets[0]!.headers.length))
                        : sprintf(__('%1$s hojas · %2$s filas'), String(analysis.sheets.length), String(rows))}
                </span>
                {plan.ai_used && (
                    <Badge variant="info" className="imcrm-gap-1">
                        <Sparkles className="imcrm-h-3 imcrm-w-3" aria-hidden />
                        {__('Afinado con IA')}
                    </Badge>
                )}
            </div>
            {plan.summary && <p className="imcrm-text-sm imcrm-text-foreground">{plan.summary}</p>}
            {[
                ...notes,
                ...truncated.map((s) => sprintf(__('«%1$s» tiene %2$s filas: se toman las primeras %3$s.'), s.name, String(s.total_rows), String(s.rows))),
                ...analysis.sheets
                    .filter((s) => (s.extra_columns ?? 0) > 0)
                    .map((s) => sprintf(__('«%1$s» tiene %2$s columnas de más: se toman las primeras %3$s.'), s.name || __('El archivo'), String(s.extra_columns), String(s.headers.length))),
            ].map((n) => (
                <p key={n} className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                    <Info className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                    {n}
                </p>
            ))}
        </section>
    );
}

function AiCard({ analysis, ai }: { analysis: FileImportAnalysis; ai: Props['ai'] }): JSX.Element | null {
    const [consent, setConsent] = useState(false);
    if (ai.used && !ai.running) {
        return ai.onBackToDraft ? (
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-info/30 imcrm-bg-info/5 imcrm-px-4 imcrm-py-3 imcrm-text-sm">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-text-info" aria-hidden />
                    {__('La IA revisó el plan: lo que cambió está marcado con ✦.')}
                </span>
                <Button variant="ghost" size="sm" onClick={ai.onBackToDraft} data-testid="file-import-ai-undo">
                    {__('Deshacer la mejora')}
                </Button>
            </div>
        ) : null;
    }
    const stages: Record<string, string> = {
        thinking: __('La IA está revisando las columnas…'),
        checking: __('Revisando la propuesta…'),
        fixing: __('Corrigiendo detalles…'),
    };
    return (
        <section
            className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-4 sm:imcrm-p-5"
            data-testid="file-import-ai"
            data-tour="file-import-ai"
        >
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                    <Wand2 className="imcrm-h-5 imcrm-w-5" aria-hidden />
                </span>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <h2 className="imcrm-text-sm imcrm-font-semibold">{__('Mejorar con IA')}</h2>
                    <p className="imcrm-text-[13px] imcrm-text-muted-foreground">
                        {__(
                            'Este plan lo armaron reglas automáticas. La IA puede afinarlo: nombres más claros, juntar opciones escritas distinto («PAGADO», «pagada»), elegir mejor los tipos y decir qué columnas no hacen falta. Después lo revisas igual.',
                        )}
                    </p>
                </div>
            </div>
            {!analysis.ai.available ? (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted imcrm-px-3 imcrm-py-2 imcrm-text-xs" data-testid="file-import-ai-unavailable">
                    <Info className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                    {analysis.ai.reason}
                </p>
            ) : ai.running ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm" data-testid="file-import-ai-running">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-primary" />
                    {stages[ai.stage ?? 'thinking'] ?? stages.thinking}
                </p>
            ) : (
                <>
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-card imcrm-p-3 imcrm-text-[13px]">
                        <input type="checkbox" className="imcrm-mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="file-import-ai-consent" />
                        <span className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                                <ShieldCheck className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-success" aria-hidden />
                                {__('Acepto enviar un resumen protegido del archivo al proveedor de IA')}
                            </span>
                            <span className="imcrm-text-muted-foreground">
                                {__(
                                    'Viajan los nombres de las columnas, el tipo que parece tener cada una y ejemplos con los correos, teléfonos, documentos y nombres ocultos. Los valores de categorías (estados, ciudades, tipos) sí se envían para poder ordenarlos. El archivo completo no sale de tu navegador.',
                                )}
                            </span>
                        </span>
                    </label>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                        <Button onClick={ai.onStart} disabled={!consent} className="imcrm-gap-2" data-testid="file-import-ai-start">
                            <Sparkles className="imcrm-h-4 imcrm-w-4" />
                            {__('Mejorar con IA')}
                        </Button>
                        {analysis.ai.remaining !== null && (
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {analysis.ai.remaining === 1 ? __('Te queda 1 análisis con IA este mes.') : sprintf(__('Te quedan %s análisis con IA este mes.'), String(analysis.ai.remaining))}
                            </span>
                        )}
                    </div>
                    {ai.error && (
                        <p className="imcrm-text-sm imcrm-text-[hsl(var(--imcrm-destructive-ink))]" data-testid="file-import-ai-error">
                            {ai.error}
                        </p>
                    )}
                </>
            )}
        </section>
    );
}

function SheetSection({
    analysis,
    plan,
    sheet,
    onPlan,
    multiple,
}: {
    analysis: FileImportAnalysis;
    plan: FileImportPlan;
    sheet: number;
    onPlan: (p: FileImportPlan) => void;
    multiple: boolean;
}): JSX.Element {
    const list = plan.lists.find((l) => l.sheet === sheet)!;
    const profile = analysis.sheets.find((s) => s.index === sheet)!;
    const [showDropped, setShowDropped] = useState(false);
    const moved = movedColumns(plan, sheet);
    const linkByColumn = new Map(plan.links.filter((l) => l.sheet === sheet).map((l) => [l.column, l]));
    const kept = list.fields.filter((f) => f.include);
    const dropped = list.fields.filter((f) => !f.include);
    const textColumns = list.fields.filter((f) => f.type === 'text' || f.type === 'long_text');
    const entities = plan.entities.filter((e) => e.sheet === sheet);
    const records = Math.max(0, profile.rows - (list.skip_duplicates ? profile.duplicate_rows : 0));
    const set = (column: number, patch: Parameters<typeof patchField>[4]) => onPlan(patchField(plan, analysis.sheets, sheet, column, patch, analysis.defaults));

    return (
        <section
            className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-p-4 sm:imcrm-p-5', !list.include && 'imcrm-opacity-60')}
            data-testid={`file-import-sheet-${sheet}`}
        >
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-3 sm:imcrm-flex-row sm:imcrm-items-end sm:imcrm-justify-between">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                    {multiple && <span className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Hoja «%s»'), profile.name)}</span>}
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Nombre de la lista')}</span>
                        <Input
                            value={list.name}
                            onChange={(e) => onPlan(patchList(plan, sheet, { name: e.target.value.slice(0, 80) }))}
                            className="imcrm-text-base imcrm-font-semibold sm:imcrm-max-w-md"
                            data-testid={`file-import-list-name-${sheet}`}
                        />
                    </label>
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-xs">
                        <span className="imcrm-font-medium imcrm-text-muted-foreground">{__('Título de cada registro')}</span>
                        <Select
                            value={String(list.title_column)}
                            onChange={(e) =>
                                onPlan(
                                    patchList(plan, sheet, {
                                        title_column: Number(e.target.value),
                                    }),
                                )
                            }
                            className="imcrm-h-9 imcrm-min-w-[12rem]"
                            data-testid={`file-import-title-${sheet}`}
                        >
                            {textColumns.map((f) => (
                                <option key={f.column} value={f.column}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </label>
                    {multiple && (
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <input
                                type="checkbox"
                                checked={list.include}
                                onChange={(e) => onPlan(patchList(plan, sheet, { include: e.target.checked }))}
                                data-testid={`file-import-include-sheet-${sheet}`}
                            />
                            {__('Importar esta hoja')}
                        </label>
                    )}
                </div>
            </header>

            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(__('%1$s registros · %2$s campos'), String(records), String(kept.length - [...moved.keys()].filter((c) => kept.some((f) => f.column === c)).length))}
                {profile.duplicate_rows > 0 && (
                    <label className="imcrm-ml-3 imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-foreground">
                        <input
                            type="checkbox"
                            checked={list.skip_duplicates}
                            onChange={(e) => onPlan(patchList(plan, sheet, { skip_duplicates: e.target.checked }))}
                            data-testid={`file-import-dupes-${sheet}`}
                        />
                        {sprintf(__('Saltar %s filas repetidas'), String(profile.duplicate_rows))}
                    </label>
                )}
            </p>

            {entities.map((e) => (
                <div
                    key={e.key_column}
                    className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-p-3', e.include ? 'imcrm-border-primary/40 imcrm-bg-primary/5' : 'imcrm-border-dashed')}
                    data-testid={`file-import-entity-${sheet}-${e.key_column}`}
                >
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            className="imcrm-mt-0.5"
                            checked={e.include}
                            onChange={(ev) =>
                                onPlan(
                                    patchEntity(plan, sheet, e.key_column, {
                                        include: ev.target.checked,
                                    }),
                                )
                            }
                            data-testid={`file-import-entity-toggle-${sheet}-${e.key_column}`}
                        />
                        <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                                <Split className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                {sprintf(__('Separar «%1$s» en su propia lista (%2$s registros), vinculada'), profile.headers[e.key_column] ?? '', String(e.records))}
                            </span>
                            {e.reason && <span className="imcrm-text-xs imcrm-text-muted-foreground">{e.reason}</span>}
                        </span>
                    </label>
                    {e.include && (
                        <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-pl-6 sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-gap-2">
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Nombre de esa lista')}</span>
                            <Input
                                value={e.name}
                                onChange={(ev) =>
                                    onPlan(
                                        patchEntity(plan, sheet, e.key_column, {
                                            name: ev.target.value.slice(0, 80),
                                        }),
                                    )
                                }
                                className="imcrm-h-8 sm:imcrm-max-w-xs"
                            />
                        </label>
                    )}
                </div>
            ))}

            <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-rounded-lg imcrm-border" data-tour="file-import-columns">
                {kept.map((f) => (
                    <ColumnRow
                        key={f.column}
                        field={f}
                        profile={profile}
                        isTitle={f.column === list.title_column}
                        movedTo={moved.get(f.column) ?? null}
                        keyOf={plan.entities.find((e) => e.include && e.sheet === sheet && e.key_column === f.column)?.name ?? null}
                        link={linkByColumn.get(f.column) ?? null}
                        linkTarget={plan.lists.find((l) => l.key === linkByColumn.get(f.column)?.to)?.name ?? null}
                        onField={(patch) => set(f.column, patch)}
                        onLink={(v) => onPlan(patchLink(plan, sheet, f.column, v))}
                    />
                ))}
            </div>

            {dropped.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <button
                        type="button"
                        className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-text-sm imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground"
                        onClick={() => setShowDropped((v) => !v)}
                        aria-expanded={showDropped}
                        data-testid={`file-import-dropped-toggle-${sheet}`}
                    >
                        <ChevronDown className={cn('imcrm-h-4 imcrm-w-4 imcrm-transition-transform', showDropped && 'imcrm-rotate-180')} />
                        {sprintf(__('Columnas que no se importan (%s)'), String(dropped.length))}
                    </button>
                    {showDropped && (
                        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            {dropped.map((f) => (
                                <li
                                    key={f.column}
                                    className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-justify-between"
                                    data-testid={`file-import-dropped-${sheet}-${f.column}`}
                                >
                                    <span className="imcrm-text-sm">
                                        <span className="imcrm-font-medium">{profile.headers[f.column]}</span>
                                        {f.reason && <span className="imcrm-ml-2 imcrm-text-xs imcrm-text-muted-foreground">{f.reason}</span>}
                                    </span>
                                    <Button variant="ghost" size="sm" onClick={() => set(f.column, { include: true })}>
                                        {__('Importarla igual')}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}

function ColumnRow({
    field,
    profile,
    isTitle,
    movedTo,
    keyOf,
    link,
    linkTarget,
    onField,
    onLink,
}: {
    field: FileImportField;
    profile: FileImportSheetProfile;
    isTitle: boolean;
    movedTo: string | null;
    /** Esta columna es la que se separa en otra lista: aquí queda como vínculo a ella. */
    keyOf: string | null;
    link: FileImportPlan['links'][number] | null;
    linkTarget: string | null;
    onField: (patch: Parameters<typeof patchField>[4]) => void;
    onLink: (v: boolean) => void;
}): JSX.Element {
    const Icon = fieldTypeIcon(field.type);
    const header = profile.headers[field.column] ?? '';
    const previews = (profile.preview ?? []).slice(0, 3).map((r) => previewCell(field, r[field.column] ?? ''));
    const bad = previews.some((p) => !p.ok);
    return (
        <div
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-p-3 lg:imcrm-grid lg:imcrm-grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)] lg:imcrm-items-start lg:imcrm-gap-4',
                movedTo && 'imcrm-bg-primary/5',
            )}
            data-testid={`file-import-col-${profile.index}-${field.column}`}
        >
            <div className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-2">
                <input
                    type="checkbox"
                    className="imcrm-mt-2.5"
                    checked
                    disabled={isTitle}
                    aria-label={sprintf(__('Importar «%s»'), header)}
                    title={isTitle ? __('Es el título: siempre se importa.') : __('Desmarca para no importarla')}
                    onChange={() => onField({ include: false })}
                    data-testid={`file-import-col-include-${profile.index}-${field.column}`}
                />
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                    <Input
                        value={field.label}
                        onChange={(e) => onField({ label: e.target.value })}
                        className="imcrm-h-8"
                        aria-label={sprintf(__('Nombre del campo para «%s»'), header)}
                        data-testid={`file-import-col-label-${profile.index}-${field.column}`}
                    />
                    <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                        {sprintf(__('Columna «%s»'), header)}
                        {isTitle && <span className="imcrm-ml-1.5 imcrm-font-semibold imcrm-text-primary">{__('· título')}</span>}
                        {field.ai && (
                            <span className="imcrm-ml-1.5 imcrm-text-info" title={__('La IA cambió esta columna')}>
                                ✦
                            </span>
                        )}
                    </span>
                </div>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-pl-6 lg:imcrm-pl-0">
                {keyOf ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid={`file-import-col-key-${profile.index}-${field.column}`}>
                        <span className="imcrm-flex imcrm-h-8 imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium imcrm-text-primary">
                            <Link2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                            {sprintf(__('Vínculo a «%s»'), keyOf)}
                        </span>
                        <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{sprintf(__('Cada fila queda conectada con su registro en «%s».'), keyOf)}</span>
                    </div>
                ) : (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                        <Select
                            value={field.type}
                            onChange={(e) => onField({ type: e.target.value as FileImportFieldType })}
                            className="imcrm-h-8"
                            aria-label={sprintf(__('Tipo de «%s»'), header)}
                            data-testid={`file-import-col-type-${profile.index}-${field.column}`}
                        >
                            {(isTitle ? (['text', 'long_text'] as const) : FILE_IMPORT_FIELD_TYPES).map((t) => (
                                <option key={t} value={t}>
                                    {fieldTypeLabel(t)}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}
                {field.reason && !keyOf && <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{field.reason}</span>}
                {movedTo && (
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary">
                        <Split className="imcrm-h-3 imcrm-w-3" aria-hidden />
                        {sprintf(__('Pasa a «%s»'), movedTo)}
                    </span>
                )}
                {link && linkTarget && (
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[12px]" data-testid={`file-import-link-${profile.index}-${field.column}`}>
                        <input type="checkbox" checked={link.include} onChange={(e) => onLink(e.target.checked)} />
                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" aria-hidden />
                        {sprintf(__('Vincular con «%1$s» (%2$s %% coincide)'), linkTarget, String(Math.round((link.match ?? 0) * 100)))}
                    </label>
                )}
            </div>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1.5 imcrm-pl-6 lg:imcrm-pl-0">
                {field.options && field.options.length > 0 && !keyOf ? (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1" data-testid={`file-import-col-options-${profile.index}-${field.column}`}>
                        {field.options.slice(0, 12).map((o) => (
                            <span key={o.value} title={o.aliases.length > 1 ? sprintf(__('Incluye: %s'), o.aliases.join(', ')) : undefined}>
                                <OptionChip opt={o as FieldOption} fallback={o.label} />
                            </span>
                        ))}
                        {field.options.length > 12 && <span className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('+%s más'), String(field.options.length - 12))}</span>}
                    </div>
                ) : (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-gap-y-0.5 imcrm-text-[12px]">
                        {previews.map((p, i) => (
                            <span key={i} className={cn('imcrm-truncate', p.ok ? 'imcrm-text-foreground' : 'imcrm-text-[hsl(var(--imcrm-warning-ink))]')}>
                                {p.text}
                            </span>
                        ))}
                    </div>
                )}
                {bad && (
                    <span className="imcrm-text-[11px] imcrm-text-[hsl(var(--imcrm-warning-ink))]">
                        {__('Algunos valores no encajan con este tipo: esas celdas van a quedar vacías (se avisa cuáles).')}
                    </span>
                )}
            </div>
        </div>
    );
}

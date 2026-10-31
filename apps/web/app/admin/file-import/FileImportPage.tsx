import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, FileSpreadsheet, Link2, Loader2, Sparkles, Split, Upload, Wand2 } from 'lucide-react';
import type { FileImportAnalysis, FileImportApplyResult, FileImportPlan } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useAnalyzeFile, useApplyFileImport, useFileImportAiJob, useStartFileImportAi } from '@/hooks/useFileImport';
import { __ } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { SPREADSHEET_ACCEPT } from '../records/import/useSpreadsheetFile';
import { FileImportDone } from './FileImportDone';
import { FileImportReview } from './FileImportReview';
import { keepUserEdits } from './planEdit';
import { prepareFile, type PreparedFile } from './prepareFile';

type Step = 'upload' | 'review' | 'done';

/**
 * v0.1.339 (ADR-S88) — «Crear desde un archivo»: se sube un Excel o un CSV y
 * sale una lista (o varias, vinculadas) casi sola. Las reglas proponen un
 * plan al instante; la IA, si la persona quiere, lo afina con un resumen
 * protegido; la persona revisa y crea; al final se le recomiendan vistas, un
 * tablero y automatizaciones que puede aprobar con un clic.
 */
export function FileImportPage(): JSX.Element {
    const [params] = useSearchParams();
    const groupId = Number(params.get('carpeta')) || undefined;
    const canCreate = useCan(CAP.MANAGE_LISTS);
    const [step, setStep] = useState<Step>('upload');
    const [prepared, setPrepared] = useState<PreparedFile | null>(null);
    const [analysis, setAnalysis] = useState<FileImportAnalysis | null>(null);
    const [plan, setPlan] = useState<FileImportPlan | null>(null);
    const [draft, setDraft] = useState<FileImportPlan | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [reading, setReading] = useState(false);
    const [capToLimit, setCapToLimit] = useState(false);
    const [result, setResult] = useState<FileImportApplyResult | null>(null);
    const [aiWanted, setAiWanted] = useState(false);
    /** El plan como estaba justo antes de pedir la mejora con IA (para deshacerla). */
    const [beforeAi, setBeforeAi] = useState<FileImportPlan | null>(null);

    const analyze = useAnalyzeFile();
    const startAi = useStartFileImportAi();
    const aiJob = useFileImportAiJob(analysis?.id ?? null, aiWanted);
    const create = useApplyFileImport();

    const onFile = useCallback(
        async (file: File) => {
            setError(null);
            setReading(true);
            try {
                const p = await prepareFile(file);
                setPrepared(p);
                const a = await analyze.mutateAsync({ file_name: p.fileName, source: p.source, sheets: p.sheets });
                setAnalysis(a);
                setPlan(a.plan);
                setDraft(a.plan);
                setBeforeAi(null);
                setAiWanted(false);
                setCapToLimit(false);
                setStep('review');
            } catch (err) {
                setError(err instanceof Error ? err.message : __('No se pudo leer el archivo.'));
            } finally {
                setReading(false);
            }
        },
        [analyze],
    );

    // El análisis con IA terminó: su plan reemplaza al borrador (se puede volver).
    const appliedAi = useRef<string | null>(null);
    useEffect(() => {
        const job = aiJob.data;
        if (!job || job.state !== 'done' || !job.plan || !analysis) return;
        if (appliedAi.current === analysis.id) return;
        appliedAi.current = analysis.id;
        // Lo que la persona ya cambió a mano se respeta; la IA completa el resto.
        const proposed = job.plan;
        setPlan((current) => (current && draft ? keepUserEdits(draft, current, proposed) : proposed));
    }, [aiJob.data, analysis, draft]);

    if (!canCreate) {
        return (
            <div className="imcrm-mx-auto imcrm-max-w-xl imcrm-py-16 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                {__('Tu rol no puede crear listas. Pídeselo a un administrador.')}
            </div>
        );
    }

    if (step === 'done' && result && plan) return <FileImportDone result={result} kind={plan.kind} />;

    const aiRunning = aiWanted && (startAi.isPending || aiJob.data?.state === 'running');
    const aiError = startAi.error instanceof Error ? startAi.error.message : aiJob.data?.state === 'error' ? aiJob.data.error?.message ?? null : null;

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-6xl imcrm-flex-col imcrm-gap-4 imcrm-py-2 sm:imcrm-py-4" data-testid="file-import">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Button variant="ghost" size="sm" asChild className="imcrm-h-8 imcrm-gap-1.5 imcrm-px-2">
                        <Link to="/lists">
                            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                            {__('Listas')}
                        </Link>
                    </Button>
                    <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">{__('Crear desde un archivo')}</h1>
                </div>
                {step === 'review' && prepared && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <FileSpreadsheet className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        <span className="imcrm-max-w-[16rem] imcrm-truncate">{prepared.fileName}</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setStep('upload');
                                setAnalysis(null);
                                setPlan(null);
                                setAiWanted(false);
                            }}
                            data-testid="file-import-change-file"
                        >
                            {__('Cambiar archivo')}
                        </Button>
                    </div>
                )}
            </div>

            {step === 'upload' || !analysis || !plan ? (
                <UploadStep reading={reading} error={error} onFile={(f) => void onFile(f)} />
            ) : (
                <FileImportReview
                    analysis={analysis}
                    plan={plan}
                    onPlan={setPlan}
                    notes={prepared?.notes ?? []}
                    ai={{
                        running: aiRunning,
                        stage: aiJob.data?.stage ?? null,
                        error: aiError,
                        used: plan.ai_used,
                        onStart: () => {
                            setBeforeAi(plan);
                            setAiWanted(true);
                            appliedAi.current = null;
                            startAi.mutate(analysis.id);
                        },
                        onBackToDraft: plan.ai_used && (beforeAi ?? draft) ? () => setPlan(beforeAi ?? draft) : null,
                    }}
                    capToLimit={capToLimit}
                    onCapToLimit={setCapToLimit}
                    creating={create.isPending}
                    createError={create.error instanceof Error ? create.error.message : null}
                    onCreate={() => {
                        if (!prepared) return;
                        create.mutate(
                            {
                                analysis_id: analysis.id,
                                plan,
                                file_name: prepared.fileName,
                                source: prepared.source,
                                sheets: prepared.sheets,
                                ...(capToLimit && analysis.limit.remaining !== null ? { max_records: analysis.limit.remaining } : {}),
                                ...(groupId ? { group_id: groupId } : {}),
                            },
                            {
                                onSuccess: (res) => {
                                    setResult(res);
                                    setStep('done');
                                    window.scrollTo({ top: 0 });
                                },
                            },
                        );
                    }}
                />
            )}
        </div>
    );
}

function UploadStep({ reading, error, onFile }: { reading: boolean; error: string | null; onFile: (f: File) => void }): JSX.Element {
    const input = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5">
            <button
                type="button"
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f) onFile(f);
                }}
                disabled={reading}
                className={cn(
                    'imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-rounded-2xl imcrm-border-2 imcrm-border-dashed imcrm-bg-card imcrm-px-6 imcrm-py-12 imcrm-text-center imcrm-transition-colors',
                    over ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-border-primary/50',
                )}
                data-testid="file-import-drop"
                data-tour="file-import-drop"
            >
                <span className="imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-bg-primary/10 imcrm-text-primary">
                    {reading ? <Loader2 className="imcrm-h-7 imcrm-w-7 imcrm-animate-spin" /> : <Upload className="imcrm-h-7 imcrm-w-7" />}
                </span>
                <span className="imcrm-text-base imcrm-font-semibold">{reading ? __('Leyendo y analizando tu archivo…') : __('Sube tu Excel o CSV')}</span>
                <span className="imcrm-max-w-md imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Arrástralo aquí o haz clic para elegirlo. La primera fila tiene que tener los nombres de las columnas. Un Excel con varias hojas se convierte en varias listas vinculadas.')}
                </span>
            </button>
            <input
                ref={input}
                type="file"
                accept={SPREADSHEET_ACCEPT}
                className="imcrm-hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.target.value = '';
                }}
                data-testid="file-import-input"
            />
            {error && (
                <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-destructive-ink))]" role="alert" data-testid="file-import-error">
                    {error}
                </p>
            )}
            <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-4">
                {[
                    { icon: Wand2, title: __('El tipo de cada columna'), text: __('Fechas, montos, teléfonos, correos, opciones con color… según los datos, no sólo el nombre.') },
                    { icon: Split, title: __('Lo repetido, en su lista'), text: __('Si una columna de clientes se repite con sus datos, los separa en otra lista vinculada.') },
                    { icon: Link2, title: __('Hojas vinculadas'), text: __('Si una hoja nombra registros de otra, quedan conectadas.') },
                    { icon: Sparkles, title: __('Recomendaciones'), text: __('Al final te sugiere vistas, un tablero y automatizaciones para aprobar.') },
                ].map((b) => (
                    <div key={b.title} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-bg-card imcrm-p-3">
                        <b.icon className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                        <span className="imcrm-text-sm imcrm-font-medium">{b.title}</span>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{b.text}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

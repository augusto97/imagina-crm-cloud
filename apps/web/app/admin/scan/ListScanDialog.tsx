import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
    SCAN_FILL_FIELD_TYPES,
    SCAN_SEARCH_FIELD_TYPES,
    pickScanField,
    readScanFieldId,
    type CodeSearchHit,
    type CodeSearchResult,
} from '@imagina-base/shared';
import { CheckCircle2, CircleHelp, Loader2, Plus, ScanLine, Volume2, VolumeX, Vibrate, XCircle } from 'lucide-react';

import { CodeScanner } from '@/components/scan/CodeScanner';
import { ScanDialog } from '@/components/scan/ScanDialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useUpdateList } from '@/hooks/useLists';
import { __, sprintf } from '@/lib/i18n';
import { codeForField, parseRecordLinkCode, searchCode } from '@/lib/scan/codeSearch';
import { readFeedbackPrefs, signalScan, writeFeedbackPrefs, type ScanFeedbackPrefs } from '@/lib/scan/feedback';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

import { ScanHitList } from './ScanHitList';

const MODE_KEY = 'imcrm:scan:mode';

type Status = 'searching' | 'found' | 'many' | 'missing' | 'error';
interface LogEntry {
    id: number;
    code: string;
    status: Status;
    hits: CodeSearchHit[];
    message?: string;
}

type Single =
    | { kind: 'scan' }
    | { kind: 'searching'; code: string }
    | { kind: 'result'; result: CodeSearchResult }
    | { kind: 'error'; code: string; message: string };

function readMode(): 'single' | 'continuous' {
    try {
        return window.localStorage.getItem(MODE_KEY) === 'continuous' ? 'continuous' : 'single';
    } catch {
        return 'single';
    }
}

/**
 * H3 — «Escanear» en la barra de una lista: busca el código por el campo
 * «Código» de la lista (el elegido en sus ajustes o el que lo dice en el
 * nombre). Uno → abre la ficha; varios → la lista; ninguno → «Crear registro»
 * con el código ya puesto en ese campo. El modo CONTINUO (inventario,
 * entradas a un evento) busca cada lectura sin cerrar la cámara, con sonido
 * o vibración opcional.
 */
export default function ListScanDialog({
    open,
    onOpenChange,
    list,
    fields,
    canCreate,
    canManageList,
    onOpenRecord,
    onCreate,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    list: ListSummary;
    fields: FieldEntity[];
    canCreate: boolean;
    canManageList: boolean;
    onOpenRecord: (recordId: number) => void;
    onCreate: (prefill: Record<string, unknown>) => void;
}): JSX.Element {
    const navigate = useNavigate();
    const toast = useToast();
    const updateList = useUpdateList(list.id);
    const [mode, setMode] = useState<'single' | 'continuous'>(readMode);
    const [single, setSingle] = useState<Single>({ kind: 'scan' });
    const [round, setRound] = useState(0);
    const [log, setLog] = useState<LogEntry[]>([]);
    const [feedback, setFeedback] = useState<ScanFeedbackPrefs>(readFeedbackPrefs);
    const settings = useMemo(() => list.settings ?? {}, [list.settings]);

    const scannable = useMemo(() => fields.filter((f) => (SCAN_SEARCH_FIELD_TYPES as readonly string[]).includes(f.type)), [fields]);
    const scanField = useMemo(() => pickScanField(scannable, settings), [scannable, settings]);
    const configured = readScanFieldId(settings);
    const fillable = useMemo(() => fields.filter((f) => (SCAN_FILL_FIELD_TYPES as readonly string[]).includes(f.type)), [fields]);
    // Dónde se pone el código al crear: el campo «Código» (si se puede escribir)
    // o, si se busca en todos, el que elija la persona (por defecto el primero).
    const [fillPick, setFillPick] = useState<number | null>(null);
    const fillField =
        scanField && (SCAN_FILL_FIELD_TYPES as readonly string[]).includes(scanField.type)
            ? scanField
            : scanField
              ? null
              : (fillable.find((f) => f.id === fillPick) ?? fillable[0] ?? null);

    const setModeAndRemember = (m: 'single' | 'continuous'): void => {
        setMode(m);
        setSingle({ kind: 'scan' });
        setRound((r) => r + 1);
        try {
            window.localStorage.setItem(MODE_KEY, m);
        } catch {
            /* nada */
        }
    };

    const toggleFeedback = (key: keyof ScanFeedbackPrefs): void => {
        const next = { ...feedback, [key]: !feedback[key] };
        setFeedback(next);
        writeFeedbackPrefs(next);
    };

    const chooseField = (id: number): void => {
        const { scan_field_id: _old, ...rest } = settings as Record<string, unknown>;
        updateList.mutate(
            { settings: id > 0 ? { ...rest, scan_field_id: id } : rest },
            {
                onSuccess: () => toast.success(__('Campo del código guardado')),
                onError: (err) => toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : String(err)),
            },
        );
    };

    const close = (): void => onOpenChange(false);

    const createWith = (code: string): void => {
        if (!fillField) return;
        const value = codeForField(code, fillField.type);
        if (!value.ok) {
            toast.error(__('No se puede usar este código'), value.message);
            return;
        }
        close();
        onCreate({ [fillField.slug]: value.value });
    };

    const openLinked = (code: string): boolean => {
        const link = parseRecordLinkCode(code, window.location.origin);
        if (!link) return false;
        close();
        if (link.listSlug === list.slug) onOpenRecord(link.recordId);
        else navigate(`/lists/${link.listSlug}/records?record=${link.recordId}`);
        return true;
    };

    // ── Modo único ──
    const onSingleCode = async (code: string): Promise<void> => {
        if (openLinked(code)) return;
        setSingle({ kind: 'searching', code });
        try {
            const result = await searchCode(code, { list: list.id });
            if (result.hits.length === 1) {
                close();
                onOpenRecord(result.hits[0]!.record_id);
                return;
            }
            setSingle({ kind: 'result', result });
        } catch (err) {
            setSingle({ kind: 'error', code, message: err instanceof Error ? err.message : String(err) });
        }
    };

    // ── Modo continuo ──
    const onContinuousCode = async (code: string): Promise<void> => {
        const id = Date.now() + Math.random();
        setLog((l) => [{ id, code, status: 'searching' as Status, hits: [] }, ...l].slice(0, 40));
        try {
            const result = await searchCode(code, { list: list.id });
            const status: Status = result.hits.length === 0 ? 'missing' : result.hits.length === 1 ? 'found' : 'many';
            signalScan(status === 'found' ? 'found' : status === 'many' ? 'many' : 'missing', feedback);
            setLog((l) => l.map((e) => (e.id === id ? { ...e, status, hits: result.hits } : e)));
        } catch (err) {
            signalScan('missing', feedback);
            setLog((l) => l.map((e) => (e.id === id ? { ...e, status: 'error', message: err instanceof Error ? err.message : String(err) } : e)));
        }
    };

    const again = (): void => {
        setSingle({ kind: 'scan' });
        setRound((r) => r + 1);
    };

    const where = scanField
        ? sprintf(__('Busca por «%s»'), scanField.label)
        : __('Busca en todos los campos de texto y número');

    return (
        <ScanDialog
            open={open}
            onOpenChange={(o) => {
                if (!o) {
                    again();
                    setLog([]);
                }
                onOpenChange(o);
            }}
            title={sprintf(__('Escanear en «%s»'), list.name)}
            description={where}
            testId="list-scan-dialog"
        >
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <div className="imcrm-inline-flex imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-0.5" role="group" aria-label={__('Modo')}>
                        {(['single', 'continuous'] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                aria-pressed={mode === m}
                                onClick={() => setModeAndRemember(m)}
                                className={cn(
                                    'imcrm-rounded imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium',
                                    mode === m ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                )}
                                data-testid={`scan-mode-${m}`}
                            >
                                {m === 'single' ? __('Un código') : __('Escaneo continuo')}
                            </button>
                        ))}
                    </div>
                    {mode === 'continuous' && (
                        <div className="imcrm-flex imcrm-gap-1">
                            <button
                                type="button"
                                aria-pressed={feedback.sound}
                                onClick={() => toggleFeedback('sound')}
                                title={feedback.sound ? __('Sonido activado') : __('Sonido apagado')}
                                aria-label={__('Sonido')}
                                className={cn('imcrm-rounded-md imcrm-p-1.5', feedback.sound ? 'imcrm-text-foreground' : 'imcrm-text-muted-foreground/60')}
                            >
                                {feedback.sound ? <Volume2 className="imcrm-h-4 imcrm-w-4" /> : <VolumeX className="imcrm-h-4 imcrm-w-4" />}
                            </button>
                            <button
                                type="button"
                                aria-pressed={feedback.vibrate}
                                onClick={() => toggleFeedback('vibrate')}
                                title={feedback.vibrate ? __('Vibración activada') : __('Vibración apagada')}
                                aria-label={__('Vibración')}
                                className={cn('imcrm-rounded-md imcrm-p-1.5', feedback.vibrate ? 'imcrm-text-foreground' : 'imcrm-text-muted-foreground/60 imcrm-line-through')}
                            >
                                <Vibrate className="imcrm-h-4 imcrm-w-4" />
                            </button>
                        </div>
                    )}
                </div>

                {canManageList && scannable.length > 0 && (
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                        <span className="imcrm-shrink-0">{__('Campo del código')}</span>
                        <Select
                            value={String(configured ?? 0)}
                            onChange={(e) => chooseField(Number(e.target.value))}
                            className="imcrm-h-8 imcrm-min-w-0 imcrm-flex-1"
                            disabled={updateList.isPending}
                            data-testid="scan-field-select"
                        >
                            <option value="0">
                                {scanField && configured === null
                                    ? sprintf(__('Automático (%s)'), scanField.label)
                                    : __('Automático (todos los de texto y número)')}
                            </option>
                            {scannable.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </label>
                )}

                {mode === 'continuous' ? (
                    <>
                        <CodeScanner key={`c-${round}`} continuous onCode={(c) => void onContinuousCode(c)} />
                        <LastBanner entry={log[0]} />
                        {log.length > 0 && (
                            <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border" data-testid="scan-log">
                                {log.map((e) => (
                                    <li key={e.id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-sm" data-scan-status={e.status}>
                                        <StatusIcon status={e.status} />
                                        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                            <span className="imcrm-truncate imcrm-font-mono imcrm-text-xs">{e.code}</span>
                                            <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                                {e.status === 'found'
                                                    ? e.hits[0]!.title || sprintf(__('Registro #%d'), e.hits[0]!.record_id)
                                                    : e.status === 'many'
                                                      ? sprintf(__('%d registros'), e.hits.length)
                                                      : e.status === 'missing'
                                                        ? __('No está en la lista')
                                                        : e.status === 'error'
                                                          ? (e.message ?? __('Error'))
                                                          : __('Buscando…')}
                                            </span>
                                        </span>
                                        {e.status === 'found' && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="imcrm-h-7"
                                                onClick={() => {
                                                    close();
                                                    onOpenRecord(e.hits[0]!.record_id);
                                                }}
                                            >
                                                {__('Abrir')}
                                            </Button>
                                        )}
                                        {e.status === 'missing' && canCreate && fillField && (
                                            <Button type="button" variant="ghost" size="sm" className="imcrm-h-7" onClick={() => createWith(e.code)}>
                                                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {__('Crear')}
                                            </Button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                ) : single.kind === 'scan' ? (
                    <CodeScanner key={`s-${round}`} onCode={(c) => void onSingleCode(c)} />
                ) : single.kind === 'searching' ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-10 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                        {sprintf(__('Buscando «%s»…'), single.code)}
                    </p>
                ) : single.kind === 'error' ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="scan-error">
                        <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive">{single.message}</p>
                        <Button type="button" variant="outline" size="sm" className="imcrm-self-start" onClick={again}>
                            <ScanLine className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Escanear otro')}
                        </Button>
                    </div>
                ) : (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="scan-result">
                        <p className="imcrm-text-sm">
                            {single.result.hits.length === 0
                                ? sprintf(__('No hay ningún registro con el código «%s» en «%s».'), single.result.code, list.name)
                                : sprintf(__('El código «%s» aparece en %d registros:'), single.result.code, single.result.hits.length)}
                        </p>
                        {single.result.hits.length > 0 && (
                            <ScanHitList
                                hits={single.result.hits}
                                showList={false}
                                onPick={(h) => {
                                    close();
                                    onOpenRecord(h.record_id);
                                }}
                            />
                        )}
                        {single.result.hits.length === 0 && canCreate && fillField === null && scanField && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {sprintf(__('«%s» lo pone la app sola: el registro nuevo no puede llevar este código.'), scanField.label)}
                            </p>
                        )}
                        {single.result.hits.length === 0 && canCreate && !scanField && fillable.length > 1 && (
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                                <span className="imcrm-shrink-0">{__('Poner el código en')}</span>
                                <Select value={String(fillField?.id ?? 0)} onChange={(e) => setFillPick(Number(e.target.value))} className="imcrm-h-8 imcrm-flex-1">
                                    {fillable.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                                </Select>
                            </label>
                        )}
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            {single.result.hits.length === 0 && canCreate && fillField && (
                                <Button type="button" size="sm" onClick={() => createWith(single.result.code)} data-testid="scan-create">
                                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Crear registro con este código')}
                                </Button>
                            )}
                            <Button type="button" variant="outline" size="sm" onClick={again} data-testid="scan-again">
                                <ScanLine className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Escanear otro')}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </ScanDialog>
    );
}

function StatusIcon({ status }: { status: Status }): JSX.Element {
    if (status === 'searching') return <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-animate-spin imcrm-text-muted-foreground" />;
    if (status === 'found') return <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-success" aria-label={__('Encontrado')} />;
    if (status === 'many') return <CircleHelp className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" aria-label={__('Varios')} />;
    return <XCircle className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-destructive" aria-label={__('No encontrado')} />;
}

/** El resultado de la ÚLTIMA lectura, grande (entradas a un evento: se ve de lejos). */
function LastBanner({ entry }: { entry: LogEntry | undefined }): JSX.Element | null {
    if (!entry || entry.status === 'searching') return null;
    const tone =
        entry.status === 'found'
            ? 'imcrm-bg-success/15 imcrm-text-success'
            : entry.status === 'many'
              ? 'imcrm-bg-warning/15 imcrm-text-foreground'
              : 'imcrm-bg-destructive/10 imcrm-text-destructive';
    const text =
        entry.status === 'found'
            ? sprintf(__('Encontrado: %s'), entry.hits[0]!.title || sprintf(__('Registro #%d'), entry.hits[0]!.record_id))
            : entry.status === 'many'
              ? sprintf(__('Varios registros con «%s»'), entry.code)
              : entry.status === 'missing'
                ? sprintf(__('«%s» no está en la lista'), entry.code)
                : (entry.message ?? __('No se pudo buscar'));
    return (
        <div className={cn('imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-3 imcrm-py-2.5 imcrm-text-sm imcrm-font-semibold', tone)} data-testid="scan-last" role="status">
            <StatusIcon status={entry.status} />
            <span className="imcrm-truncate">{text}</span>
        </div>
    );
}

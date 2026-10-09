import { useState } from 'react';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { AI_INPUT_TYPES, type AiFieldTask } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useAiFieldStatus, useFillAiField } from '@/hooks/useAiFields';
import { useFields } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { formatDateTime } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

const TASKS: Array<{ key: AiFieldTask; label: string; hint: string }> = [
    { key: 'summarize', label: 'Resumir', hint: 'Un resumen corto de lo que dicen las fuentes (una nota larga, un correo, un PDF).' },
    { key: 'classify', label: 'Clasificar', hint: 'Elige UNA de las opciones que le des (prioridad, tema, sentimiento…).' },
    { key: 'extract', label: 'Extraer un dato', hint: 'Saca un dato puntual: el NIT de una factura, la ciudad de una dirección…' },
    { key: 'translate', label: 'Traducir', hint: 'Traduce el texto de las fuentes a otro idioma.' },
    { key: 'custom', label: 'Personalizado', hint: 'Escribe lo que quieres que haga con las fuentes.' },
];

const LANGUAGES = ['inglés', 'español', 'portugués', 'francés', 'alemán', 'italiano'];

/**
 * v0.1.277 (ADR-S41) — Configuración de un campo con IA: qué hace, de qué
 * campos lee (también PDF e imágenes adjuntos), y si se recalcula solo.
 * Con el campo ya creado, además «Llenar» la columna y el último error.
 */
export function AiFieldEditor({
    config,
    onChange,
    listId,
    currentFieldId,
}: {
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    listId?: number;
    currentFieldId?: number;
}): JSX.Element {
    const fields = useFields(listId);
    const task = (typeof config.task === 'string' ? config.task : '') as AiFieldTask | '';
    const inputs = Array.isArray(config.inputs) ? (config.inputs as number[]) : [];
    const options = Array.isArray(config.options) ? (config.options as string[]) : [];
    const set = (patch: Record<string, unknown>): void => onChange({ ...config, ...patch });
    const eligible = (fields.data ?? []).filter((f) => AI_INPUT_TYPES.includes(f.type) && f.id !== currentFieldId);
    const [optionsText, setOptionsText] = useState(options.join('\n'));
    const length = typeof config.length === 'string' ? config.length : 'short';
    const quality = config.quality === 'best' ? 'best' : 'fast';

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="ai-field-editor">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Qué hace')}</Label>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5 sm:imcrm-grid-cols-3">
                    {TASKS.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => set({ task: t.key })}
                            aria-pressed={task === t.key}
                            className={cn(
                                'imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-1.5 imcrm-text-left imcrm-text-xs',
                                task === t.key ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                            )}
                            data-ai-task={t.key}
                        >
                            {__(t.label)}
                        </button>
                    ))}
                </div>
                {task && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__(TASKS.find((t) => t.key === task)!.hint)}</p>}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs">{__('Lee de estos campos')}</Label>
                {eligible.length === 0 ? (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Esta lista todavía no tiene campos que la IA pueda leer.')}</p>
                ) : (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" data-testid="ai-field-inputs">
                        {eligible.map((f) => {
                            const on = inputs.includes(f.id);
                            const Icon = fieldTypeIcon(f.type);
                            return (
                                <button
                                    key={f.id}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => set({ inputs: on ? inputs.filter((i) => i !== f.id) : [...inputs, f.id].slice(0, 10) })}
                                    className={cn(
                                        'imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-px-2 imcrm-py-0.5 imcrm-text-xs',
                                        on ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                                    )}
                                    data-ai-input={f.slug}
                                >
                                    <Icon className="imcrm-h-3 imcrm-w-3" />
                                    {f.label}
                                </button>
                            );
                        })}
                    </div>
                )}
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('De un campo Archivo lee los PDF y las imágenes (hasta 3, de 5 MB cada uno).')}
                </p>
            </div>

            {task === 'classify' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label className="imcrm-text-xs">{__('Opciones (una por renglón)')}</Label>
                    <Textarea
                        rows={4}
                        value={optionsText}
                        onChange={(e) => {
                            setOptionsText(e.target.value);
                            set({ options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 30) });
                        }}
                        placeholder={__('Alta\nMedia\nBaja')}
                        data-testid="ai-field-options"
                    />
                </div>
            )}

            {task === 'translate' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label className="imcrm-text-xs">{__('Idioma')}</Label>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                        {LANGUAGES.map((l) => (
                            <button
                                key={l}
                                type="button"
                                aria-pressed={config.language === l}
                                onClick={() => set({ language: l })}
                                className={cn(
                                    'imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs',
                                    config.language === l ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                                )}
                            >
                                {__(l)}
                            </button>
                        ))}
                    </div>
                    <Input
                        value={typeof config.language === 'string' ? config.language : ''}
                        onChange={(e) => set({ language: e.target.value })}
                        placeholder={__('Otro idioma…')}
                        className="imcrm-h-8"
                    />
                </div>
            )}

            {task !== '' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label className="imcrm-text-xs">
                        {task === 'extract' ? __('Qué dato extraer') : task === 'custom' ? __('Instrucciones') : __('Indicaciones extra (opcional)')}
                    </Label>
                    <Textarea
                        rows={3}
                        value={typeof config.prompt === 'string' ? config.prompt : ''}
                        onChange={(e) => set({ prompt: e.target.value })}
                        placeholder={
                            task === 'extract'
                                ? __('Ej.: el número de NIT del cliente')
                                : task === 'custom'
                                  ? __('Ej.: escribe un mensaje de bienvenida corto para este cliente')
                                  : __('Ej.: menciona siempre el monto y la fecha')
                        }
                        maxLength={2000}
                        data-testid="ai-field-prompt"
                    />
                </div>
            )}

            {(task === 'summarize' || task === 'translate' || task === 'custom') && (
                <Segmented
                    label={__('Largo de la respuesta')}
                    value={length}
                    options={[
                        ['short', __('Corta')],
                        ['medium', __('Media')],
                        ['long', __('Larga')],
                    ]}
                    onChange={(v) => set({ length: v })}
                />
            )}

            <Segmented
                label={__('Modelo')}
                value={quality}
                options={[
                    ['fast', __('Rápido (recomendado)')],
                    ['best', __('El del asistente')],
                ]}
                onChange={(v) => set({ quality: v })}
            />

            <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                <input
                    type="checkbox"
                    className="imcrm-mt-0.5"
                    checked={config.auto !== false}
                    onChange={(e) => set({ auto: e.target.checked })}
                    data-testid="ai-field-auto"
                />
                <span>
                    {__('Recalcular solo cuando cambian los campos que lee')}
                    <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Cada cálculo usa un pedido de IA (cuenta para la cuota del plan si la empresa usa la clave compartida).')}
                    </span>
                </span>
            </label>

            {listId && currentFieldId ? <AiFieldActions listId={listId} fieldId={currentFieldId} /> : null}
        </div>
    );
}

function Segmented({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: Array<[string, string]>;
    onChange: (v: string) => void;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label className="imcrm-text-xs">{label}</Label>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5 imcrm-text-xs">
                {options.map(([k, l]) => (
                    <button
                        key={k}
                        type="button"
                        aria-pressed={value === k}
                        onClick={() => onChange(k)}
                        className={cn('imcrm-flex-1 imcrm-rounded imcrm-px-2 imcrm-py-1', value === k ? 'imcrm-bg-background imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground')}
                    >
                        {l}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** Con el campo creado: llenar la columna y el último error. */
function AiFieldActions({ listId, fieldId }: { listId: number; fieldId: number }): JSX.Element {
    const status = useAiFieldStatus(listId, fieldId);
    const fill = useFillAiField(listId, fieldId);
    const toast = useToast();
    const run = (onlyEmpty: boolean): void =>
        fill.mutate(onlyEmpty, {
            onSuccess: (r) =>
                toast.success(
                    r.queued === 0 ? __('No había registros para completar') : sprintf(__('Completando %d registros en segundo plano'), r.queued),
                    r.capped ? (r.reason ?? __('Se encolaron los primeros 500.')) : undefined,
                ),
            onError: (err) => toast.error(__('No se pudo'), err instanceof Error ? err.message : String(err)),
        });
    const err = status.data?.last_error;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-medium">
                <Sparkles className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" />
                {__('Registros que ya existen')}
            </p>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                <Button size="sm" variant="outline" disabled={fill.isPending} onClick={() => run(true)} data-testid="ai-field-fill">
                    {fill.isPending && <Loader2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                    {__('Completar los vacíos')}
                </Button>
                <Button size="sm" variant="ghost" disabled={fill.isPending} onClick={() => run(false)}>
                    {__('Recalcular todos')}
                </Button>
            </div>
            {err && (
                <p className="imcrm-flex imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-destructive" data-testid="ai-field-last-error">
                    <AlertTriangle className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    <span>
                        {__('Último error')} ({formatDateTime(new Date(err.at))}, {sprintf(__('registro #%d'), err.record_id)}): {err.message}
                    </span>
                </p>
            )}
        </div>
    );
}

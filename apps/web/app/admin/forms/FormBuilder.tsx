import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
    AlertTriangle,
    ArrowDown,
    ArrowUp,
    Check as CheckIcon,
    Code2,
    Copy,
    ExternalLink,
    EyeOff,
    GripVertical,
    Heading2,
    Link2,
    Loader2,
    Monitor,
    Plus,
    Redo2,
    Smartphone,
    Trash2,
    Type,
    Undo2,
    X,
} from 'lucide-react';
import {
    buildPublicFormItems,
    FORM_CONDITION_OPS,
    type FormCondition,
    type FormConditionOp,
    type FormConfig,
    type FormDto,
    type FormItem,
    type PublicFormMeta,
} from '@imagina-base/shared';

import { ThemeToggle } from '@/components/ThemeToggle';
import { ColorField } from '@/components/design/DesignStyleControls';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useBrandingData } from '@/hooks/useBranding';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { getTenantFormat } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section, Segmented } from '../automations/email/EmailBlockInspector';
import {
    addContentItem,
    addFieldItem,
    availableFields,
    conditionCandidates,
    missingRequired,
    moveItem,
    moveItemTo,
    questionCount,
    removeItem,
    updateItem,
    updateSettings,
} from './formDesignOps';
import { formEmbedCode, formPublicUrl, useUpdateForm } from './useForms';

/**
 * v0.1.275 — Constructor de formularios a pantalla completa (ADR-S39).
 *
 * El centro es la PÁGINA REAL que ve el visitante (la sirve el API en modo
 * vista previa y recibe el diseño por postMessage): lo que se ve al diseñar
 * es lo que se publica, sin una segunda implementación que se desfase.
 */

const OP_LABELS: Record<FormConditionOp, string> = {
    eq: 'es',
    neq: 'no es',
    in: 'es alguno de',
    contains: 'contiene',
    gt: 'es mayor que',
    lt: 'es menor que',
    is_empty: 'está vacío',
    is_not_empty: 'tiene respuesta',
};

interface Draft {
    name: string;
    config: FormConfig;
}

interface History {
    past: FormConfig[];
    future: FormConfig[];
}

export interface FormBuilderProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    form: FormDto;
    fields: FieldEntity[];
}

export default function FormBuilder(props: FormBuilderProps): JSX.Element {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40" />
                <Dialog.Content
                    aria-describedby={undefined}
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-bg-background imcrm-text-foreground focus:imcrm-outline-none"
                    onEscapeKeyDown={(e) => e.preventDefault()}
                    data-testid="form-builder"
                >
                    <Dialog.Title className="imcrm-sr-only">{__('Constructor de formularios')}</Dialog.Title>
                    {props.open && <Builder {...props} />}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Builder({ onOpenChange, listId, form, fields }: FormBuilderProps): JSX.Element {
    const toast = useToast();
    const confirm = useConfirm();
    const update = useUpdateForm(listId);
    const branding = useBrandingData();
    const narrow = useMediaQuery('(max-width: 1023px)');

    const [draft, setDraft] = useState<Draft>({ name: form.name, config: form.config });
    const [saved, setSaved] = useState<Draft>({ name: form.name, config: form.config });
    const [enabled, setEnabled] = useState(form.enabled);
    const [history, setHistory] = useState<History>({ past: [], future: [] });
    const [selected, setSelected] = useState<string | null>(null);
    const [leftTab, setLeftTab] = useState<'add' | 'structure'>('add');
    const [mobileTab, setMobileTab] = useState<'build' | 'preview' | 'settings'>('preview');
    const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
    const [shareOpen, setShareOpen] = useState(false);

    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    const config = draft.config;
    const fieldsById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

    const change = useCallback((next: FormConfig) => {
        setDraft((d) => {
            setHistory((h) => ({ past: [...h.past.slice(-60), d.config], future: [] }));
            return { ...d, config: next };
        });
    }, []);
    const undo = useCallback(() => {
        setHistory((h) => {
            const prev = h.past[h.past.length - 1];
            if (!prev) return h;
            setDraft((d) => {
                h.future.unshift(d.config);
                return { ...d, config: prev };
            });
            return { past: h.past.slice(0, -1), future: h.future };
        });
    }, []);
    const redo = useCallback(() => {
        setHistory((h) => {
            const next = h.future[0];
            if (!next) return h;
            setDraft((d) => {
                h.past.push(d.config);
                return { ...d, config: next };
            });
            return { past: h.past, future: h.future.slice(1) };
        });
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            const mod = e.metaKey || e.ctrlKey;
            if (!mod) return;
            const tag = (e.target as HTMLElement | null)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
            } else if (e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [undo, redo]);

    // ── Vista previa: la página real, alimentada por postMessage ──
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false);
    const meta = useMemo<PublicFormMeta>(() => {
        const s = config.settings;
        const b = branding.data;
        return {
            title: s.title || draft.name,
            description: s.description,
            submit_label: s.submit_label || 'Enviar',
            success_title: s.success_title,
            success_message: s.success_message,
            redirect_url: s.redirect_url,
            allow_another: s.allow_another,
            allow_prefill: s.allow_prefill,
            accent_color: s.accent_color ?? b?.primary_color ?? '#0e7490',
            logo_url: s.show_logo ? (b?.logo_url ?? null) : null,
            company: b?.app_name ?? '',
            number_format: getTenantFormat().number_format,
            items: buildPublicFormItems(config, fields),
            closed: null,
            stamp: '',
            max_upload_bytes: 20 * 1024 * 1024,
        };
    }, [config, draft.name, fields, branding.data]);

    useEffect(() => {
        const onMessage = (e: MessageEvent): void => {
            if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow) return;
            const data = e.data as { type?: string; id?: string } | null;
            if (data?.type === 'imb-form-ready') setReady(true);
            if (data?.type === 'imb-form-select' && typeof data.id === 'string') {
                setSelected(data.id);
                if (narrow) setMobileTab('settings');
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [narrow]);
    useEffect(() => {
        if (!ready) return;
        iframeRef.current?.contentWindow?.postMessage({ type: 'imb-form-preview', meta, selected }, window.location.origin);
    }, [ready, meta, selected]);

    const save = async (extra: { enabled?: boolean } = {}): Promise<boolean> => {
        try {
            const doc = await update.mutateAsync({ id: form.id, body: { name: draft.name.trim() || form.name, config: draft.config, ...extra } });
            const next = { name: doc.name, config: doc.config };
            setDraft(next);
            setSaved(next);
            setEnabled(doc.enabled);
            return true;
        } catch (err) {
            toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : String(err));
            return false;
        }
    };

    const togglePublish = async (): Promise<void> => {
        const next = !enabled;
        if (next && questionCount(config) === 0) {
            toast.error(__('Agrega al menos una pregunta'), __('Un formulario sin preguntas no crea nada.'));
            return;
        }
        if (await save({ enabled: next })) {
            toast.success(next ? __('Formulario publicado') : __('El formulario dejó de recibir respuestas'));
            if (next) setShareOpen(true);
        }
    };

    const close = async (): Promise<void> => {
        if (dirty) {
            const ok = await confirm({
                title: __('¿Salir sin guardar?'),
                description: __('Tienes cambios que todavía no guardaste.'),
                confirmLabel: __('Salir sin guardar'),
                destructive: true,
            });
            if (!ok) return;
        }
        onOpenChange(false);
    };

    const missing = missingRequired(fields, config);
    const selectedItem = config.items.find((i) => i.id === selected) ?? null;

    const addField = (fieldId: number): void => {
        const { config: next, id } = addFieldItem(config, fieldId, selected);
        change(next);
        setSelected(id);
    };
    const addContent = (type: 'heading' | 'text'): void => {
        const { config: next, id } = addContentItem(config, type, selected);
        change(next);
        setSelected(id);
    };

    const left = (
        <LeftPanel
            tab={leftTab}
            onTab={setLeftTab}
            config={config}
            fields={fields}
            fieldsById={fieldsById}
            selected={selected}
            onSelect={(id) => {
                setSelected(id);
                if (narrow) setMobileTab('settings');
            }}
            onAddField={addField}
            onAddContent={addContent}
            onChange={change}
        />
    );
    const right = selectedItem ? (
        <ItemInspector
            key={selectedItem.id}
            item={selectedItem}
            config={config}
            fieldsById={fieldsById}
            onChange={change}
            onClose={() => setSelected(null)}
        />
    ) : (
        <SettingsInspector draft={draft} setName={(name) => setDraft((d) => ({ ...d, name }))} config={config} onChange={change} missing={missing} />
    );
    const preview = (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-bg-canvas">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-1.5">
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Vista previa — toca una pregunta para editarla')}
                </span>
                <div role="group" aria-label={__('Dispositivo')} className="imcrm-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-0.5">
                    {(
                        [
                            ['desktop', Monitor, __('Computadora')],
                            ['mobile', Smartphone, __('Celular')],
                        ] as const
                    ).map(([key, Icon, label]) => (
                        <button
                            key={key}
                            type="button"
                            title={label}
                            aria-pressed={device === key}
                            onClick={() => setDevice(key)}
                            className={cn(
                                'imcrm-rounded imcrm-p-1',
                                device === key ? 'imcrm-bg-background imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground',
                            )}
                        >
                            <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                        </button>
                    ))}
                </div>
            </div>
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-justify-center imcrm-overflow-hidden imcrm-p-3">
                <iframe
                    ref={iframeRef}
                    src="/api/v1/public/f/preview"
                    title={__('Vista previa del formulario')}
                    className={cn(
                        'imcrm-h-full imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-white',
                        device === 'mobile' ? 'imcrm-w-[375px]' : 'imcrm-w-full imcrm-max-w-[760px]',
                    )}
                    data-testid="form-preview"
                />
            </div>
        </div>
    );

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col">
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2">
                <Button variant="ghost" size="icon" aria-label={__('Cerrar')} onClick={() => void close()}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="imcrm-h-8 imcrm-w-56 imcrm-max-w-[45vw] imcrm-font-medium"
                    aria-label={__('Nombre del formulario')}
                />
                <PublishSwitch enabled={enabled} busy={update.isPending} onClick={() => void togglePublish()} />
                <div className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-1">
                    <Button variant="ghost" size="icon" aria-label={__('Deshacer')} disabled={history.past.length === 0} onClick={undo}>
                        <Undo2 className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={__('Rehacer')} disabled={history.future.length === 0} onClick={redo}>
                        <Redo2 className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                    <ThemeToggle />
                    <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setShareOpen((o) => !o)} data-testid="form-share">
                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        <span className="imcrm-hidden sm:imcrm-inline">{__('Compartir')}</span>
                    </Button>
                    <Button size="sm" disabled={!dirty || update.isPending} onClick={() => void save().then((ok) => ok && toast.success(__('Formulario guardado')))} data-testid="form-save">
                        {update.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : __('Guardar')}
                    </Button>
                </div>
            </header>
            {shareOpen && <SharePanel form={form} enabled={enabled} onClose={() => setShareOpen(false)} onPublish={() => void togglePublish()} />}

            {narrow ? (
                <>
                    <div role="tablist" className="imcrm-flex imcrm-border-b imcrm-border-border">
                        {(
                            [
                                ['build', __('Preguntas')],
                                ['preview', __('Vista previa')],
                                ['settings', selectedItem ? __('Editar') : __('Ajustes')],
                            ] as const
                        ).map(([key, label]) => (
                            <button
                                key={key}
                                role="tab"
                                type="button"
                                aria-selected={mobileTab === key}
                                onClick={() => setMobileTab(key)}
                                className={cn(
                                    'imcrm-flex-1 imcrm-border-b-2 imcrm-py-2 imcrm-text-sm',
                                    mobileTab === key ? 'imcrm-border-primary imcrm-font-medium' : 'imcrm-border-transparent imcrm-text-muted-foreground',
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto">
                        {mobileTab === 'build' && left}
                        {mobileTab === 'preview' && <div className="imcrm-h-full">{preview}</div>}
                        {mobileTab === 'settings' && right}
                    </div>
                </>
            ) : (
                <div className="imcrm-grid imcrm-min-h-0 imcrm-flex-1 imcrm-grid-cols-[280px_minmax(0,1fr)_320px]">
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border">{left}</aside>
                    <main className="imcrm-min-h-0">{preview}</main>
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-l imcrm-border-border">{right}</aside>
                </div>
            )}
        </div>
    );
}

function PublishSwitch({ enabled, busy, onClick }: { enabled: boolean; busy: boolean; onClick: () => void }): JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busy}
            onClick={onClick}
            data-testid="form-publish"
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-full imcrm-border imcrm-py-1 imcrm-pl-1.5 imcrm-pr-3 imcrm-text-[12px] imcrm-font-medium imcrm-transition-colors',
                enabled
                    ? 'imcrm-border-success/30 imcrm-bg-success/10 imcrm-text-success'
                    : 'imcrm-border-border imcrm-bg-muted imcrm-text-muted-foreground',
            )}
        >
            <span
                className={cn(
                    'imcrm-relative imcrm-inline-flex imcrm-h-4 imcrm-w-7 imcrm-items-center imcrm-rounded-full imcrm-transition-colors',
                    enabled ? 'imcrm-bg-success' : 'imcrm-bg-border',
                )}
                aria-hidden
            >
                <span
                    className={cn(
                        'imcrm-inline-block imcrm-h-3 imcrm-w-3 imcrm-rounded-full imcrm-bg-white imcrm-shadow imcrm-transition-transform',
                        enabled ? 'imcrm-translate-x-3.5' : 'imcrm-translate-x-0.5',
                    )}
                />
            </span>
            {enabled ? __('Publicado') : __('Sin publicar')}
        </button>
    );
}

function CopyRow({ label, value, testId }: { label: string; value: string; testId?: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{label}</span>
            <div className="imcrm-flex imcrm-gap-1.5">
                <Input readOnly value={value} className="imcrm-h-8 imcrm-font-mono imcrm-text-[11px]" onFocus={(e) => e.currentTarget.select()} data-testid={testId} />
                <Button
                    variant="outline"
                    size="sm"
                    className="imcrm-shrink-0 imcrm-gap-1"
                    onClick={() =>
                        void navigator.clipboard.writeText(value).then(() => {
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1500);
                        })
                    }
                >
                    {copied ? <CheckIcon className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {copied ? __('Copiado') : __('Copiar')}
                </Button>
            </div>
        </div>
    );
}

function SharePanel({ form, enabled, onClose, onPublish }: { form: FormDto; enabled: boolean; onClose: () => void; onPublish: () => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-bg-muted/40 imcrm-px-4 imcrm-py-3" data-testid="form-share-panel">
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div>
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Compartir el formulario')}</p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {enabled
                            ? __('Cualquiera con el enlace puede responder. Cada respuesta crea un registro en la lista.')
                            : __('Todavía no está publicado: el enlace responde «no disponible» hasta que lo publiques.')}
                    </p>
                </div>
                <Button variant="ghost" size="icon" aria-label={__('Cerrar')} onClick={onClose}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
            {!enabled && (
                <Button size="sm" className="imcrm-self-start" onClick={onPublish}>
                    {__('Publicar ahora')}
                </Button>
            )}
            <div className="imcrm-grid imcrm-gap-3 md:imcrm-grid-cols-2">
                <CopyRow label={__('Enlace')} value={formPublicUrl(form)} testId="form-link" />
                <CopyRow label={__('Insertar en tu sitio')} value={formEmbedCode(form)} testId="form-embed" />
            </div>
            <a
                href={formPublicUrl(form)}
                target="_blank"
                rel="noreferrer"
                className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-text-xs imcrm-text-primary hover:imcrm-underline"
            >
                <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                {__('Abrir en otra pestaña')}
            </a>
        </div>
    );
}

// ─────────────────────────── Panel izquierdo ───────────────────────────

interface LeftPanelProps {
    tab: 'add' | 'structure';
    onTab: (t: 'add' | 'structure') => void;
    config: FormConfig;
    fields: FieldEntity[];
    fieldsById: Map<number, FieldEntity>;
    selected: string | null;
    onSelect: (id: string) => void;
    onAddField: (fieldId: number) => void;
    onAddContent: (type: 'heading' | 'text') => void;
    onChange: (next: FormConfig) => void;
}

function itemTitle(item: FormItem, fieldsById: Map<number, FieldEntity>): string {
    if (item.type === 'heading') return item.text || __('Título de sección');
    if (item.type === 'text') return item.text.split('\n')[0] || __('Texto');
    return item.label.trim() || fieldsById.get(item.field_id)?.label || __('Campo borrado');
}

function LeftPanel(p: LeftPanelProps): JSX.Element {
    const available = availableFields(p.fields, p.config);
    const [dragId, setDragId] = useState<string | null>(null);
    const [dropAt, setDropAt] = useState<number | null>(null);
    return (
        <div className="imcrm-flex imcrm-flex-col">
            <div role="tablist" className="imcrm-flex imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-2 imcrm-pt-2">
                {(
                    [
                        ['add', __('Agregar')],
                        ['structure', `${__('Preguntas')} (${p.config.items.length})`],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        key={key}
                        role="tab"
                        type="button"
                        aria-selected={p.tab === key}
                        onClick={() => p.onTab(key)}
                        className={cn(
                            '-imcrm-mb-px imcrm-border-b-2 imcrm-px-2 imcrm-pb-2 imcrm-text-xs',
                            p.tab === key ? 'imcrm-border-primary imcrm-font-medium imcrm-text-foreground' : 'imcrm-border-transparent imcrm-text-muted-foreground',
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {p.tab === 'add' ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-3">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__('Campos de la lista')}
                        </p>
                        {available.length === 0 ? (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Ya están todos los campos que se pueden preguntar.')}</p>
                        ) : (
                            available.map((f) => {
                                const Icon = fieldTypeIcon(f.type);
                                return (
                                    <button
                                        key={f.id}
                                        type="button"
                                        onClick={() => p.onAddField(f.id)}
                                        className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                                        data-add-field={f.slug}
                                    >
                                        <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{f.label}</span>
                                        {f.is_required && <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{__('obligatorio')}</span>}
                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                                    </button>
                                );
                            })
                        )}
                        <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Las personas del equipo, las relaciones y los campos calculados no se preguntan en un formulario público.')}
                        </p>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__('Contenido')}
                        </p>
                        <button type="button" onClick={() => p.onAddContent('heading')} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-sm hover:imcrm-bg-accent">
                            <Heading2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                            {__('Título de sección')}
                        </button>
                        <button type="button" onClick={() => p.onAddContent('text')} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-sm hover:imcrm-bg-accent">
                            <Type className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                            {__('Texto o aclaración')}
                        </button>
                    </div>
                </div>
            ) : (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-p-2" data-testid="form-structure">
                    {p.config.items.length === 0 && (
                        <li className="imcrm-px-2 imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Todavía no hay preguntas. Agrégalas desde la pestaña «Agregar».')}
                        </li>
                    )}
                    {p.config.items.map((item, idx) => {
                        const Icon =
                            item.type === 'heading' ? Heading2 : item.type === 'text' ? Type : fieldTypeIcon(p.fieldsById.get(item.field_id)?.type ?? 'text');
                        return (
                            <li
                                key={item.id}
                                draggable
                                onDragStart={(e) => {
                                    setDragId(item.id);
                                    e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragOver={(e) => {
                                    if (!dragId) return;
                                    e.preventDefault();
                                    const r = e.currentTarget.getBoundingClientRect();
                                    setDropAt(e.clientY < r.top + r.height / 2 ? idx : idx + 1);
                                }}
                                onDragEnd={() => {
                                    setDragId(null);
                                    setDropAt(null);
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    if (dragId && dropAt !== null) {
                                        const from = p.config.items.findIndex((i) => i.id === dragId);
                                        p.onChange(moveItemTo(p.config, dragId, from < dropAt ? dropAt - 1 : dropAt));
                                    }
                                    setDragId(null);
                                    setDropAt(null);
                                }}
                                className={cn(
                                    'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-transparent imcrm-px-1.5 imcrm-py-1.5 imcrm-text-sm',
                                    p.selected === item.id ? 'imcrm-border-primary/40 imcrm-bg-primary/5' : 'hover:imcrm-bg-accent',
                                    dropAt === idx && 'imcrm-border-t-primary',
                                    dropAt === idx + 1 && idx === p.config.items.length - 1 && 'imcrm-border-b-primary',
                                )}
                                data-structure-item={item.id}
                            >
                                <GripVertical className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-cursor-grab imcrm-text-muted-foreground" />
                                <button type="button" className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-1.5 imcrm-text-left" onClick={() => p.onSelect(item.id)}>
                                    <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                    <span className={cn('imcrm-truncate', item.type === 'heading' && 'imcrm-font-medium')}>{itemTitle(item, p.fieldsById)}</span>
                                    {item.type === 'field' && item.hidden && <EyeOff className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground" aria-label={__('Oculto')} />}
                                    {item.show_if && <span className="imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-text-[10px] imcrm-text-muted-foreground">{__('si…')}</span>}
                                </button>
                                <span className="imcrm-flex imcrm-opacity-0 group-hover:imcrm-opacity-100 group-focus-within:imcrm-opacity-100">
                                    <button type="button" aria-label={__('Subir')} disabled={idx === 0} onClick={() => p.onChange(moveItem(p.config, item.id, -1))} className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30">
                                        <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                    <button type="button" aria-label={__('Bajar')} disabled={idx === p.config.items.length - 1} onClick={() => p.onChange(moveItem(p.config, item.id, 1))} className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30">
                                        <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                </span>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}

// ─────────────────────────── Inspector ───────────────────────────

function ItemInspector({
    item,
    config,
    fieldsById,
    onChange,
    onClose,
}: {
    item: FormItem;
    config: FormConfig;
    fieldsById: Map<number, FieldEntity>;
    onChange: (next: FormConfig) => void;
    onClose: () => void;
}): JSX.Element {
    const set = (patch: Partial<FormItem>): void => onChange(updateItem(config, item.id, patch));
    const field = item.type === 'field' ? fieldsById.get(item.field_id) : undefined;
    const title = item.type === 'heading' ? __('Título de sección') : item.type === 'text' ? __('Texto') : (field?.label ?? __('Pregunta'));

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-4" data-testid="form-item-inspector">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    <p className="imcrm-truncate imcrm-text-sm imcrm-font-semibold">{title}</p>
                    {field && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Se guarda en el campo')} «{field.label}»</p>}
                </div>
                <div className="imcrm-flex imcrm-shrink-0 imcrm-gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={__('Quitar del formulario')}
                        onClick={() => {
                            onChange(removeItem(config, item.id));
                            onClose();
                        }}
                    >
                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={__('Volver a los ajustes')} onClick={onClose}>
                        <X className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                </div>
            </div>

            {item.type === 'heading' && (
                <Field label={__('Título')}>
                    <Input value={item.text} onChange={(e) => set({ text: e.target.value })} />
                </Field>
            )}
            {item.type === 'text' && (
                <Field label={__('Texto')} hint={__('Una línea en blanco separa párrafos.')}>
                    <Textarea rows={5} value={item.text} onChange={(e) => set({ text: e.target.value })} />
                </Field>
            )}
            {item.type === 'field' && field && (
                <>
                    <Field label={__('Pregunta')} hint={__('Vacío = el nombre del campo.')}>
                        <Input value={item.label} placeholder={field.label} onChange={(e) => set({ label: e.target.value })} data-testid="form-item-label" />
                    </Field>
                    <Field label={__('Ayuda')} hint={__('Aparece debajo de la pregunta.')}>
                        <Textarea rows={2} value={item.help} placeholder={field.description ?? ''} onChange={(e) => set({ help: e.target.value })} />
                    </Field>
                    {!['checkbox', 'select', 'multi_select', 'rating', 'file', 'date', 'datetime'].includes(field.type) && (
                        <Field label={__('Texto de ejemplo')}>
                            <Input value={item.placeholder} onChange={(e) => set({ placeholder: e.target.value })} />
                        </Field>
                    )}
                    {field.type === 'select' && (
                        <Segmented
                            label={__('Cómo se elige')}
                            value={item.display}
                            options={[
                                { value: 'auto', label: __('Automático') },
                                { value: 'radio', label: __('Botones') },
                                { value: 'dropdown', label: __('Lista') },
                            ]}
                            onChange={(v) => set({ display: v })}
                        />
                    )}
                    <Section title={__('Respuesta')}>
                        {field.is_required ? (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Obligatoria: la lista exige este campo.')}</p>
                        ) : (
                            <Check label={__('Obligatoria')} checked={item.required} onChange={(v) => set({ required: v })} />
                        )}
                        <Check label={__('Oculta: se completa desde la dirección')} checked={item.hidden} onChange={(v) => set({ hidden: v })} />
                        {item.hidden && (
                            <p className="imcrm-break-all imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-[11px]">
                                …/f/xxxx?{field.slug}=valor
                            </p>
                        )}
                    </Section>
                </>
            )}

            <ConditionEditor item={item} config={config} fieldsById={fieldsById} onSet={(show_if) => set({ show_if })} />
        </div>
    );
}

function ConditionEditor({
    item,
    config,
    fieldsById,
    onSet,
}: {
    item: FormItem;
    config: FormConfig;
    fieldsById: Map<number, FieldEntity>;
    onSet: (c: FormCondition | null) => void;
}): JSX.Element {
    const candidates = conditionCandidates(config, item.id).filter((c) => fieldsById.has(c.field_id));
    const cond = item.show_if;
    const ctl = cond ? fieldsById.get(cond.field_id) : undefined;
    const options = ctl && (ctl.type === 'select' || ctl.type === 'multi_select')
        ? ((ctl.config.options as Array<{ value: string; label?: string }> | undefined) ?? [])
        : [];
    const ops: FormConditionOp[] = ctl?.type === 'checkbox'
        ? ['eq', 'is_empty', 'is_not_empty']
        : ctl && ['number', 'currency', 'percent', 'rating', 'duration'].includes(ctl.type)
          ? ['eq', 'neq', 'gt', 'lt', 'is_empty', 'is_not_empty']
          : ctl && (ctl.type === 'select' || ctl.type === 'multi_select')
            ? ['eq', 'neq', 'is_empty', 'is_not_empty']
            : [...FORM_CONDITION_OPS].filter((o) => o !== 'in' && o !== 'gt' && o !== 'lt');
    const needsValue = cond && cond.op !== 'is_empty' && cond.op !== 'is_not_empty';

    return (
        <Section title={__('Mostrar sólo si…')}>
            {candidates.length === 0 ? (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Para depender de otra respuesta, esa pregunta tiene que estar antes.')}
                </p>
            ) : !cond ? (
                <Button
                    variant="outline"
                    size="sm"
                    className="imcrm-self-start"
                    onClick={() => onSet({ field_id: candidates[candidates.length - 1]!.field_id, op: 'eq', value: '' })}
                >
                    {__('Agregar una condición')}
                </Button>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-condition">
                    <Select
                        value={String(cond.field_id)}
                        onChange={(e) => onSet({ field_id: Number(e.target.value), op: 'eq', value: '' })}
                        aria-label={__('Pregunta que controla')}
                    >
                        {candidates.map((c) => (
                            <option key={c.field_id} value={c.field_id}>
                                {fieldsById.get(c.field_id)?.label}
                            </option>
                        ))}
                    </Select>
                    <Select value={cond.op} onChange={(e) => onSet({ ...cond, op: e.target.value as FormConditionOp })} aria-label={__('Comparación')}>
                        {ops.map((o) => (
                            <option key={o} value={o}>
                                {__(OP_LABELS[o])}
                            </option>
                        ))}
                    </Select>
                    {needsValue &&
                        (ctl?.type === 'checkbox' ? (
                            <Select value={String(cond.value === true)} onChange={(e) => onSet({ ...cond, value: e.target.value === 'true' })}>
                                <option value="true">{__('Marcada')}</option>
                                <option value="false">{__('Sin marcar')}</option>
                            </Select>
                        ) : options.length > 0 ? (
                            <Select value={String(cond.value ?? '')} onChange={(e) => onSet({ ...cond, value: e.target.value })} aria-label={__('Valor')}>
                                <option value="">{__('Elige una opción')}</option>
                                {options.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label || o.value}
                                    </option>
                                ))}
                            </Select>
                        ) : (
                            <Input value={String(cond.value ?? '')} onChange={(e) => onSet({ ...cond, value: e.target.value })} aria-label={__('Valor')} />
                        ))}
                    <Button variant="ghost" size="sm" className="imcrm-self-start imcrm-text-muted-foreground" onClick={() => onSet(null)}>
                        {__('Quitar la condición')}
                    </Button>
                </div>
            )}
        </Section>
    );
}

function SettingsInspector({
    draft,
    setName,
    config,
    onChange,
    missing,
}: {
    draft: Draft;
    setName: (name: string) => void;
    config: FormConfig;
    onChange: (next: FormConfig) => void;
    missing: FieldEntity[];
}): JSX.Element {
    const s = config.settings;
    const set = (patch: Partial<FormConfig['settings']>): void => onChange(updateSettings(config, patch));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-4" data-testid="form-settings">
            {missing.length > 0 && (
                <div className="imcrm-flex imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs" data-testid="form-missing-required">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    <span>
                        {__('La lista exige')} {missing.map((f) => `«${f.label}»`).join(', ')}{' '}
                        {__('y el formulario puede no traerlo: esas respuestas no se van a poder guardar. Agrégalo como pregunta visible y sin condición, o quítale el «obligatorio» en la lista.')}
                    </span>
                </div>
            )}
            <div>
                <p className="imcrm-text-sm imcrm-font-semibold">{__('Ajustes del formulario')}</p>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Toca una pregunta en la vista previa para editarla.')}</p>
            </div>
            <Field label={__('Nombre interno')} hint={__('Sólo lo ve tu equipo.')}>
                <Input value={draft.name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={__('Título')}>
                <Input value={s.title} onChange={(e) => set({ title: e.target.value })} data-testid="form-title" />
            </Field>
            <Field label={__('Descripción')}>
                <Textarea rows={3} value={s.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field label={__('Texto del botón')}>
                <Input value={s.submit_label} onChange={(e) => set({ submit_label: e.target.value })} />
            </Field>

            <Section title={__('Después de enviar')}>
                <Field label={__('Título del agradecimiento')}>
                    <Input value={s.success_title} onChange={(e) => set({ success_title: e.target.value })} />
                </Field>
                <Field label={__('Mensaje')}>
                    <Textarea rows={2} value={s.success_message} onChange={(e) => set({ success_message: e.target.value })} />
                </Field>
                <Field label={__('O llevar a esta dirección')} hint={__('Opcional. Tiene que empezar con https://')}>
                    <Input
                        value={s.redirect_url ?? ''}
                        placeholder="https://tusitio.com/gracias"
                        onChange={(e) => set({ redirect_url: e.target.value.trim() === '' ? null : e.target.value.trim() })}
                    />
                </Field>
                <Check label={__('Ofrecer «Enviar otra respuesta»')} checked={s.allow_another} onChange={(v) => set({ allow_another: v })} />
            </Section>

            <Section title={__('Cuándo recibe respuestas')}>
                <Field label={__('Hasta el día')} hint={__('Vacío = sin fecha de cierre.')}>
                    <Input type="date" value={s.closes_at ?? ''} onChange={(e) => set({ closes_at: e.target.value || null })} />
                </Field>
                <Field label={__('Hasta un máximo de respuestas')} hint={__('Vacío = sin límite (cupos de un evento, por ejemplo).')}>
                    <Input
                        type="number"
                        min={1}
                        value={s.max_submissions ?? ''}
                        onChange={(e) => set({ max_submissions: e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value))) })}
                    />
                </Field>
                <Field label={__('Mensaje cuando está cerrado')}>
                    <Textarea rows={2} value={s.closed_message} onChange={(e) => set({ closed_message: e.target.value })} />
                </Field>
            </Section>

            <Section title={__('Apariencia')}>
                <ColorField label={__('Color')} value={s.accent_color} placeholder={__('El de tu marca')} onChange={(v) => set({ accent_color: v })} />
                <Check label={__('Mostrar el logo de la empresa')} checked={s.show_logo} onChange={(v) => set({ show_logo: v })} />
            </Section>

            <Section title={__('Insertar en tu sitio')}>
                <Check
                    label={__('Completar respuestas desde la dirección')}
                    checked={s.allow_prefill}
                    onChange={(v) => set({ allow_prefill: v })}
                />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Ej.: …?nombre=Ana&origen=instagram. Sirve para las preguntas ocultas que marcan de dónde vino cada respuesta.')}
                </p>
                <Field label={__('Sitios que pueden insertarlo')} hint={__('Uno por renglón (ej.: tusitio.com). Vacío = cualquier sitio.')}>
                    <Textarea
                        rows={3}
                        value={s.allowed_domains.join('\n')}
                        onChange={(e) =>
                            set({
                                allowed_domains: e.target.value
                                    .split(/\n|,/)
                                    .map((d) => d.trim())
                                    .filter(Boolean)
                                    .slice(0, 50),
                            })
                        }
                    />
                </Field>
            </Section>
            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                <Code2 className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                {__('Para avisarle a alguien de cada respuesta, arma una automatización con «Cuando se envía un formulario».')}
            </p>
        </div>
    );
}

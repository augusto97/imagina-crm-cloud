import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
    AlarmClock,
    ArrowDown,
    ArrowUp,
    CalendarClock,
    CalendarDays,
    Check as CheckIcon,
    Copy,
    ExternalLink,
    Link2,
    ListChecks,
    Loader2,
    Mail,
    Monitor,
    Plus,
    Redo2,
    RefreshCw,
    Send,
    Smartphone,
    Tag,
    Trash2,
    Undo2,
    Users,
    X,
    type LucideIcon,
} from 'lucide-react';
import {
    BOOKING_MAPPING_KEYS,
    BOOKING_SLOT_INTERVALS,
    BOOKING_STATUS_LABELS,
    type BookingConfig,
    type BookingMappingKey,
    type BookingPageDto,
    type BookingStaff,
    type BookingStatus,
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
import { useCaptchaAvailability, useDataConsentAvailability } from '../forms/useForms';
import { SmsCounter } from '@/cloud/components/sms/smsUi';
import { useSmsConnections } from '@/cloud/components/sms/useSmsConnections';
import { extractFieldOptions } from '../records/fieldOptions';
import {
    addQuestion,
    addService,
    addStaff,
    availableQuestionFields,
    buildPreviewMeta,
    copyDayToWeekdays,
    dayProblem,
    mappingCandidates,
    moveQuestion,
    moveService,
    nextInterval,
    reminderLabel,
    removeException,
    removeQuestion,
    removeService,
    removeStaff,
    sectionProblems,
    setDayIntervals,
    setException,
    setMapping,
    setReminders,
    toggleStaffService,
    updateQuestion,
    updateService,
    updateStaff,
    type BookingSection,
} from './bookingDesignOps';
import {
    bookingEmbedCode,
    bookingPublicUrl,
    fetchPreviewSlots,
    useBookingOptions,
    useUpdateBookingPage,
    type BookingEditorOptions,
} from './useBookingPages';

/**
 * D5 — Constructor de la agenda a pantalla completa. El centro es la PÁGINA
 * REAL que ve el cliente (la sirve el API en modo vista previa y recibe la
 * configuración por postMessage; los horarios los calcula el servidor con la
 * configuración EN EDICIÓN): lo que se ve al armarla es lo que se publica.
 * La página pública siempre se ve clara y con la marca; el editor sigue el
 * modo oscuro de la app.
 */

interface Draft {
    name: string;
    config: BookingConfig;
}

export interface BookingBuilderProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    page: BookingPageDto;
    fields: FieldEntity[];
}

const SECTIONS: Array<{ id: BookingSection; label: string; icon: LucideIcon }> = [
    { id: 'servicios', label: 'Servicios', icon: Tag },
    { id: 'atienden', label: 'Quién atiende', icon: Users },
    { id: 'disponibilidad', label: 'Disponibilidad', icon: CalendarDays },
    { id: 'reglas', label: 'Reglas', icon: AlarmClock },
    { id: 'campos', label: 'Campos de la lista', icon: ListChecks },
    { id: 'correos', label: 'Correos y recordatorios', icon: Mail },
    { id: 'publicar', label: 'Publicar', icon: Send },
];

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export default function BookingBuilder(props: BookingBuilderProps): JSX.Element {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40" />
                <Dialog.Content
                    aria-describedby={undefined}
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-bg-background imcrm-text-foreground focus:imcrm-outline-none"
                    onEscapeKeyDown={(e) => e.preventDefault()}
                    data-testid="booking-builder"
                >
                    <Dialog.Title className="imcrm-sr-only">{__('Constructor de la agenda')}</Dialog.Title>
                    {props.open && <Builder {...props} />}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Builder({ onOpenChange, listId, page, fields }: BookingBuilderProps): JSX.Element {
    const toast = useToast();
    const confirm = useConfirm();
    const update = useUpdateBookingPage(listId);
    const options = useBookingOptions(listId);
    const branding = useBrandingData();
    const captcha = useCaptchaAvailability(listId);
    const dataConsent = useDataConsentAvailability(listId);
    const narrow = useMediaQuery('(max-width: 1023px)');

    const [current, setCurrent] = useState<BookingPageDto>(page);
    const [draft, setDraft] = useState<Draft>({ name: page.name, config: page.config });
    const [saved, setSaved] = useState<Draft>({ name: page.name, config: page.config });
    const [past, setPast] = useState<BookingConfig[]>([]);
    const [future, setFuture] = useState<BookingConfig[]>([]);
    const [section, setSection] = useState<BookingSection>('servicios');
    const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
    const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
    const [shareOpen, setShareOpen] = useState(false);

    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    const config = draft.config;
    const configRef = useRef(config);
    configRef.current = config;

    const change = useCallback((next: BookingConfig) => {
        setDraft((d) => {
            setPast((p) => [...p.slice(-60), d.config]);
            setFuture([]);
            return { ...d, config: next };
        });
    }, []);
    const undo = useCallback(() => {
        setPast((p) => {
            const prev = p[p.length - 1];
            if (!prev) return p;
            setDraft((d) => {
                setFuture((f) => [d.config, ...f]);
                return { ...d, config: prev };
            });
            return p.slice(0, -1);
        });
    }, []);
    const redo = useCallback(() => {
        setFuture((f) => {
            const next = f[0];
            if (!next) return f;
            setDraft((d) => {
                setPast((p) => [...p, d.config]);
                return { ...d, config: next };
            });
            return f.slice(1);
        });
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (!(e.metaKey || e.ctrlKey)) return;
            const tag = (e.target as HTMLElement | null)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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
    const members = useMemo(() => options.data?.members ?? [], [options.data]);
    const timeZone = options.data?.time_zone ?? 'America/Bogota';
    const meta = useMemo(
        () =>
            buildPreviewMeta(config, {
                name: draft.name,
                fields,
                members,
                accent: branding.data?.primary_color ?? '#0e7490',
                logoUrl: branding.data?.logo_url ?? null,
                company: branding.data?.app_name ?? '',
                timeZone,
                numberFormat: getTenantFormat().number_format,
                captchaProvider: captcha.data?.provider ?? null,
                dataConsent: dataConsent.data?.active ? (dataConsent.data.consent ?? null) : null,
            }),
        [config, draft.name, fields, members, branding.data, timeZone, captcha.data?.provider, dataConsent.data],
    );

    useEffect(() => {
        const onMessage = (e: MessageEvent): void => {
            if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow) return;
            const data = e.data as { type?: string; id?: number; service?: string; staff?: string; from?: string; to?: string } | null;
            if (data?.type === 'imb-booking-ready') setReady(true);
            if (data?.type === 'imb-booking-slots-request' && typeof data.id === 'number') {
                const reply = (slots: unknown[]): void => {
                    iframeRef.current?.contentWindow?.postMessage({ type: 'imb-booking-slots', id: data.id, slots }, window.location.origin);
                };
                fetchPreviewSlots(listId, page.id, {
                    config: configRef.current,
                    service_id: String(data.service ?? ''),
                    staff_id: String(data.staff ?? 'any'),
                    from: String(data.from ?? ''),
                    to: String(data.to ?? ''),
                })
                    .then((res) => reply(res.slots))
                    .catch(() => reply([]));
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [listId, page.id]);
    useEffect(() => {
        if (!ready) return;
        iframeRef.current?.contentWindow?.postMessage({ type: 'imb-booking-preview', meta }, window.location.origin);
    }, [ready, meta]);

    const problems = useMemo(() => sectionProblems(config, fields), [config, fields]);
    const problemCount = Object.values(problems).reduce((n, list) => n + (list?.length ?? 0), 0);

    const save = async (extra: { enabled?: boolean; regenerate_token?: boolean } = {}): Promise<boolean> => {
        try {
            const doc = await update.mutateAsync({ id: page.id, body: { name: draft.name.trim() || page.name, config: draft.config, ...extra } });
            const next = { name: doc.name, config: doc.config };
            setDraft(next);
            setSaved(next);
            setCurrent(doc);
            return true;
        } catch (err) {
            toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : String(err));
            return false;
        }
    };

    const togglePublish = async (): Promise<void> => {
        const next = !current.enabled;
        if (next && problemCount > 0) {
            const first = SECTIONS.find((s) => (problems[s.id]?.length ?? 0) > 0);
            if (first) setSection(first.id);
            toast.error(__('Todavía no se puede publicar'), Object.values(problems).flat()[0] ?? '');
            return;
        }
        if (await save({ enabled: next })) {
            toast.success(next ? __('Agenda publicada') : __('La agenda dejó de recibir reservas'));
            if (next) setShareOpen(true);
        }
    };

    const regenerate = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Cambiar la dirección?'),
            description: __('La dirección actual deja de funcionar al instante (también donde la hayas insertado). Las citas ya agendadas y sus enlaces para cambiar o cancelar no se ven afectados.'),
            confirmLabel: __('Cambiar la dirección'),
            destructive: true,
        });
        if (ok && (await save({ regenerate_token: true }))) toast.success(__('Dirección nueva lista'));
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

    const opts: BookingEditorOptions = options.data ?? { members: [], calendars: [], time_zone: timeZone, time_zone_set: false };
    const editor = (
        <SectionEditor
            section={section}
            config={config}
            onChange={change}
            fields={fields}
            options={opts}
            page={current}
            problems={problems}
            captchaAvailable={captcha.data ?? null}
            consentActive={dataConsent.data?.active === true}
            onPublish={() => void togglePublish()}
            onRegenerate={() => void regenerate()}
            busy={update.isPending}
        />
    );
    const nav = (
        <nav className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-p-2" aria-label={__('Secciones de la agenda')} data-testid="booking-nav">
            {SECTIONS.map((s) => {
                const Icon = s.icon;
                const has = (problems[s.id]?.length ?? 0) > 0;
                return (
                    <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                            setSection(s.id);
                            if (narrow) setMobileTab('edit');
                        }}
                        aria-current={section === s.id ? 'page' : undefined}
                        data-booking-section={s.id}
                        className={cn(
                            'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-sm',
                            section === s.id ? 'imcrm-bg-primary/10 imcrm-font-medium imcrm-text-foreground' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                        )}
                    >
                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{__(s.label)}</span>
                        {has && <span className="imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-destructive" aria-label={__('Falta algo')} />}
                    </button>
                );
            })}
        </nav>
    );
    const preview = (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-bg-canvas">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-1.5">
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Vista previa con los horarios reales — nada se reserva aquí')}
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
                            className={cn('imcrm-rounded imcrm-p-1', device === key ? 'imcrm-bg-background imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground')}
                        >
                            <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                        </button>
                    ))}
                </div>
            </div>
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-justify-center imcrm-overflow-hidden imcrm-p-3">
                <iframe
                    ref={iframeRef}
                    src="/api/v1/public/b/preview"
                    title={__('Vista previa de la agenda')}
                    className={cn('imcrm-h-full imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-white', device === 'mobile' ? 'imcrm-w-[375px]' : 'imcrm-w-full imcrm-max-w-[760px]')}
                    data-testid="booking-preview"
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
                    aria-label={__('Nombre de la agenda')}
                />
                <PublishSwitch enabled={current.enabled} busy={update.isPending} onClick={() => void togglePublish()} />
                <div className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-1">
                    <Button variant="ghost" size="icon" aria-label={__('Deshacer')} disabled={past.length === 0} onClick={undo}>
                        <Undo2 className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={__('Rehacer')} disabled={future.length === 0} onClick={redo}>
                        <Redo2 className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                    <ThemeToggle />
                    <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setShareOpen((o) => !o)} data-testid="booking-share">
                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        <span className="imcrm-hidden sm:imcrm-inline">{__('Compartir')}</span>
                    </Button>
                    <Button
                        size="sm"
                        disabled={!dirty || update.isPending}
                        onClick={() => void save().then((ok) => ok && toast.success(__('Agenda guardada')))}
                        data-testid="booking-save"
                    >
                        {update.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : __('Guardar')}
                    </Button>
                </div>
            </header>
            {shareOpen && <SharePanel page={current} onClose={() => setShareOpen(false)} onPublish={() => void togglePublish()} />}

            {narrow ? (
                <>
                    <div role="tablist" className="imcrm-flex imcrm-border-b imcrm-border-border">
                        {(
                            [
                                ['edit', __('Ajustes')],
                                ['preview', __('Vista previa')],
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
                        {mobileTab === 'edit' ? (
                            <div className="imcrm-flex imcrm-flex-col">
                                <div className="imcrm-border-b imcrm-border-border imcrm-p-3">
                                    <Select value={section} onChange={(e) => setSection(e.target.value as BookingSection)} aria-label={__('Sección')} data-testid="booking-section-select">
                                        {SECTIONS.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {__(s.label)}
                                                {(problems[s.id]?.length ?? 0) > 0 ? ' •' : ''}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                                {editor}
                            </div>
                        ) : (
                            <div className="imcrm-h-full">{preview}</div>
                        )}
                    </div>
                </>
            ) : (
                <div className="imcrm-grid imcrm-min-h-0 imcrm-flex-1 imcrm-grid-cols-[210px_420px_minmax(0,1fr)]">
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border">{nav}</aside>
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-r imcrm-border-border">{editor}</aside>
                    <main className="imcrm-min-h-0">{preview}</main>
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
            data-testid="booking-publish"
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-full imcrm-border imcrm-py-1 imcrm-pl-1.5 imcrm-pr-3 imcrm-text-[12px] imcrm-font-medium imcrm-transition-colors',
                enabled ? 'imcrm-border-success/30 imcrm-bg-success/10 imcrm-text-success' : 'imcrm-border-border imcrm-bg-muted imcrm-text-muted-foreground',
            )}
        >
            <span className={cn('imcrm-relative imcrm-inline-flex imcrm-h-4 imcrm-w-7 imcrm-items-center imcrm-rounded-full imcrm-transition-colors', enabled ? 'imcrm-bg-success' : 'imcrm-bg-border')} aria-hidden>
                <span className={cn('imcrm-inline-block imcrm-h-3 imcrm-w-3 imcrm-rounded-full imcrm-bg-white imcrm-shadow imcrm-transition-transform', enabled ? 'imcrm-translate-x-3.5' : 'imcrm-translate-x-0.5')} />
            </span>
            {enabled ? __('Publicada') : __('Sin publicar')}
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

function SharePanel({ page, onClose, onPublish }: { page: BookingPageDto; onClose: () => void; onPublish: () => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-bg-muted/40 imcrm-px-4 imcrm-py-3" data-testid="booking-share-panel">
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div>
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Compartir la agenda')}</p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {page.enabled
                            ? __('Cualquiera con el enlace puede agendar. Cada cita crea un registro en la lista.')
                            : __('Todavía no está publicada: el enlace responde «no disponible» hasta que la publiques.')}
                    </p>
                </div>
                <Button variant="ghost" size="icon" aria-label={__('Cerrar')} onClick={onClose}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
            {!page.enabled && (
                <Button size="sm" className="imcrm-self-start" onClick={onPublish}>
                    {__('Publicar ahora')}
                </Button>
            )}
            <div className="imcrm-grid imcrm-gap-3 md:imcrm-grid-cols-2">
                <CopyRow label={__('Enlace')} value={bookingPublicUrl(page)} testId="booking-link" />
                <CopyRow label={__('Insertar en tu sitio')} value={bookingEmbedCode(page)} testId="booking-embed" />
            </div>
            <a href={bookingPublicUrl(page)} target="_blank" rel="noreferrer" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-text-xs imcrm-text-primary hover:imcrm-underline">
                <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                {__('Abrir en otra pestaña')}
            </a>
        </div>
    );
}

// ─────────────────────────── Secciones ───────────────────────────

interface SectionEditorProps {
    section: BookingSection;
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
    fields: FieldEntity[];
    options: BookingEditorOptions;
    page: BookingPageDto;
    problems: Partial<Record<BookingSection, string[]>>;
    captchaAvailable: { provider: string | null; reason?: string | null } | null;
    consentActive: boolean;
    onPublish: () => void;
    onRegenerate: () => void;
    busy: boolean;
}

function SectionEditor(p: SectionEditorProps): JSX.Element {
    const meta = SECTIONS.find((s) => s.id === p.section)!;
    const list = p.problems[p.section] ?? [];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-4" data-testid={`booking-editor-${p.section}`}>
            <div>
                <h2 className="imcrm-text-base imcrm-font-semibold">{__(meta.label)}</h2>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{SECTION_HINTS[p.section]}</p>
            </div>
            {list.length > 0 && p.section !== 'publicar' && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive" data-testid="booking-section-problems">
                    {list.map((m) => (
                        <li key={m}>{__(m)}</li>
                    ))}
                </ul>
            )}
            {p.section === 'servicios' && <ServicesEditor {...p} />}
            {p.section === 'atienden' && <StaffEditor {...p} />}
            {p.section === 'disponibilidad' && <AvailabilityEditor {...p} />}
            {p.section === 'reglas' && <RulesEditor {...p} />}
            {p.section === 'campos' && <FieldsEditor {...p} />}
            {p.section === 'correos' && <EmailsEditor {...p} />}
            {p.section === 'publicar' && <PublishEditor {...p} />}
        </div>
    );
}

const SECTION_HINTS: Record<BookingSection, string> = {
    servicios: __('Lo que se puede agendar y cuánto dura cada cosa. El precio es sólo informativo: no se cobra.'),
    atienden: __('Las personas del equipo (las que pueden editar esta lista) o los recursos —una sala, un consultorio— que atienden las citas.'),
    disponibilidad: __('El horario de cada uno, en la zona horaria de la empresa. Los días con otro horario o cerrados van en «Días especiales».'),
    reglas: __('Cuánto margen dejar entre citas, con cuánta anticipación se puede agendar y hasta cuándo.'),
    campos: __('En qué campo de la lista se guarda cada dato de la cita, y qué más se le pregunta al cliente.'),
    correos: __('El correo de confirmación (con el archivo para agregarla al calendario), los recordatorios y lo que ve al terminar.'),
    publicar: __('Cómo se ve la página, dónde se puede insertar y su enlace.'),
};

const DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120, 180];

function ServicesEditor({ config, onChange }: SectionEditorProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {config.services.map((s, i) => (
                <div key={s.id} className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-service={s.id}>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                        <Input value={s.name} onChange={(e) => onChange(updateService(config, s.id, { name: e.target.value }))} aria-label={__('Nombre del servicio')} className="imcrm-h-8 imcrm-font-medium" data-testid="service-name" />
                        <IconBtn label={__('Subir')} disabled={i === 0} onClick={() => onChange(moveService(config, s.id, -1))}>
                            <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                        </IconBtn>
                        <IconBtn label={__('Bajar')} disabled={i === config.services.length - 1} onClick={() => onChange(moveService(config, s.id, 1))}>
                            <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                        </IconBtn>
                        <IconBtn label={__('Quitar el servicio')} onClick={() => onChange(removeService(config, s.id))}>
                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        </IconBtn>
                    </div>
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                        <Field label={__('Duración')}>
                            <Select
                                value={DURATIONS.includes(s.duration_min) ? String(s.duration_min) : 'custom'}
                                onChange={(e) => {
                                    if (e.target.value !== 'custom') onChange(updateService(config, s.id, { duration_min: Number(e.target.value) }));
                                }}
                                data-testid="service-duration"
                            >
                                {DURATIONS.map((m) => (
                                    <option key={m} value={m}>
                                        {m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`}
                                    </option>
                                ))}
                                {!DURATIONS.includes(s.duration_min) && <option value="custom">{`${s.duration_min} min`}</option>}
                            </Select>
                        </Field>
                        <Field label={__('Precio (opcional)')}>
                            <Input
                                type="number"
                                min={0}
                                value={s.price ?? ''}
                                onChange={(e) => onChange(updateService(config, s.id, { price: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) }))}
                                placeholder="80000"
                            />
                        </Field>
                    </div>
                    <Field label={__('Descripción (opcional)')}>
                        <Textarea rows={2} value={s.description} onChange={(e) => onChange(updateService(config, s.id, { description: e.target.value }))} />
                    </Field>
                    <Check label={__('Disponible para agendar')} checked={s.active} onChange={(v) => onChange(updateService(config, s.id, { active: v }))} />
                </div>
            ))}
            <Button variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-self-start" onClick={() => onChange(addService(config).config)} data-testid="service-add">
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Agregar servicio')}
            </Button>
        </div>
    );
}

function StaffEditor({ config, onChange, options }: SectionEditorProps): JSX.Element {
    const used = new Set(config.staff.flatMap((s) => (s.kind === 'user' && s.staff_user_id !== null ? [s.staff_user_id] : [])));
    const free = options.members.filter((m) => !used.has(m.id));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Segmented
                label={__('Con varias personas o recursos')}
                value={config.settings.choose_staff}
                options={[
                    { value: 'visitor', label: __('El cliente elige') },
                    { value: 'auto', label: __('Se asigna solo') },
                ]}
                onChange={(v) => onChange({ ...config, settings: { ...config.settings, choose_staff: v } })}
            />
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {config.settings.choose_staff === 'visitor'
                    ? __('El cliente ve quién atiende y también «El primero disponible», que reparte las citas por turno entre quienes están libres.')
                    : __('El cliente no elige: la cita va a quien esté libre, por turno.')}
            </p>
            {config.staff.map((s) => (
                <StaffCard key={s.id} staff={s} config={config} onChange={onChange} options={options} used={used} />
            ))}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="imcrm-gap-1.5"
                    disabled={free.length === 0}
                    title={free.length === 0 ? __('Ya están todas las personas que pueden editar la lista') : undefined}
                    onClick={() => onChange(addStaff(config, 'user', free[0]?.id ?? null).config)}
                    data-testid="staff-add-user"
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar persona')}
                </Button>
                <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => onChange(addStaff(config, 'resource').config)} data-testid="staff-add-resource">
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar recurso')}
                </Button>
            </div>
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {__('Una persona aparece si puede editar esta lista (si no, no vería sus propias citas). Si atiende en otras agendas de la empresa, sus citas de allá también ocupan su horario aquí.')}
            </p>
        </div>
    );
}

function StaffCard({
    staff,
    config,
    onChange,
    options,
    used,
}: {
    staff: BookingStaff;
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
    options: BookingEditorOptions;
    used: Set<number>;
}): JSX.Element {
    const calendars = options.calendars.filter((c) => c.owner_user_id === null || c.owner_user_id === staff.staff_user_id);
    const offers = (svcId: string): boolean => staff.services.length === 0 || staff.services.includes(svcId);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-staff={staff.id}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                <span className="imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-text-muted-foreground">
                    {staff.kind === 'user' ? __('Persona') : __('Recurso')}
                </span>
                {staff.kind === 'user' ? (
                    <Select
                        value={staff.staff_user_id === null ? '' : String(staff.staff_user_id)}
                        onChange={(e) => onChange(updateStaff(config, staff.id, { staff_user_id: e.target.value === '' ? null : Number(e.target.value), connection_id: null }))}
                        aria-label={__('Persona')}
                        className="imcrm-h-8"
                        data-testid="staff-user"
                    >
                        <option value="">{__('Elige a alguien…')}</option>
                        {options.members
                            .filter((m) => m.id === staff.staff_user_id || !used.has(m.id))
                            .map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.name}
                                </option>
                            ))}
                    </Select>
                ) : (
                    <Input value={staff.name} onChange={(e) => onChange(updateStaff(config, staff.id, { name: e.target.value }))} aria-label={__('Nombre del recurso')} className="imcrm-h-8" placeholder={__('Sala 1')} data-testid="staff-resource" />
                )}
                <IconBtn label={__('Quitar')} onClick={() => onChange(removeStaff(config, staff.id))}>
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                </IconBtn>
            </div>
            {staff.kind === 'user' && (
                <Field label={__('Nombre que ve el cliente (opcional)')}>
                    <Input value={staff.name} onChange={(e) => onChange(updateStaff(config, staff.id, { name: e.target.value }))} placeholder={__('Su nombre en la app')} className="imcrm-h-8" />
                </Field>
            )}
            {config.services.length > 1 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Servicios que atiende')}</span>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-gap-y-1">
                        {config.services.map((svc) => (
                            <Check key={svc.id} label={svc.name} checked={offers(svc.id)} onChange={(v) => onChange(toggleStaffService(config, staff.id, svc.id, v))} />
                        ))}
                    </div>
                </div>
            )}
            {staff.kind === 'user' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-2">
                    <Field label={__('Su calendario (Google Calendar u Outlook)')}>
                        <Select
                            value={staff.connection_id === null ? '' : String(staff.connection_id)}
                            onChange={(e) => onChange(updateStaff(config, staff.id, { connection_id: e.target.value === '' ? null : Number(e.target.value) }))}
                            className="imcrm-h-8"
                            data-testid="staff-calendar"
                        >
                            <option value="">{__('Ninguno')}</option>
                            {calendars.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.account ? ` · ${c.account}` : ''}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    {calendars.length === 0 && (
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Conecta Google Calendar u Outlook en Ajustes → Integraciones para no ofrecer los horarios en que ya está ocupado.')}</p>
                    )}
                    {staff.connection_id !== null && (
                        <>
                            <Check label={__('No ofrecer los horarios ocupados en su calendario')} checked={staff.read_busy} onChange={(v) => onChange(updateStaff(config, staff.id, { read_busy: v }))} />
                            <Check label={__('Agregar cada cita a su calendario')} checked={staff.create_events} onChange={(v) => onChange(updateStaff(config, staff.id, { create_events: v }))} />
                            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                                {__('Del calendario sólo se lee la hora de inicio y de fin de cada evento: nunca el título, la descripción ni los invitados.')}
                            </p>
                        </>
                    )}
                </div>
            )}
            <Check label={__('Recibe citas')} checked={staff.active} onChange={(v) => onChange(updateStaff(config, staff.id, { active: v }))} />
        </div>
    );
}

function staffName(s: BookingStaff, members: BookingEditorOptions['members']): string {
    if (s.name.trim()) return s.name.trim();
    if (s.kind === 'user') return members.find((m) => m.id === s.staff_user_id)?.name ?? __('Persona sin elegir');
    return __('Recurso sin nombre');
}

function AvailabilityEditor({ config, onChange, options }: SectionEditorProps): JSX.Element {
    const [sel, setSel] = useState<string | null>(config.staff[0]?.id ?? null);
    const staff = config.staff.find((s) => s.id === sel) ?? config.staff[0];
    const [exDate, setExDate] = useState('');
    if (!staff) return <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Primero agrega a alguien en «Quién atiende».')}</p>;
    const a = staff.availability;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {config.staff.length > 1 && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" role="tablist" aria-label={__('Quién atiende')}>
                    {config.staff.map((s) => (
                        <button
                            key={s.id}
                            type="button"
                            role="tab"
                            aria-selected={s.id === staff.id}
                            onClick={() => setSel(s.id)}
                            className={cn(
                                'imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-1 imcrm-text-xs',
                                s.id === staff.id ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium' : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent',
                            )}
                            data-availability-staff={s.id}
                        >
                            {staffName(s, options.members)}
                        </button>
                    ))}
                </div>
            )}
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                <CalendarClock className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Horarios en la zona de la empresa')}: {options.time_zone}
                {!options.time_zone_set && ` (${__('elígela en Ajustes → Formato regional')})`}
            </p>
            <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid="availability-week">
                {WEEK_ORDER.map((dow) => {
                    const day = a.week[dow] ?? [];
                    const problem = dayProblem(day);
                    return (
                        <div key={dow} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-px-3 imcrm-py-2" data-day={dow}>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <label className="imcrm-flex imcrm-w-28 imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                    <input
                                        type="checkbox"
                                        checked={day.length > 0}
                                        onChange={(e) => onChange(setDayIntervals(config, staff.id, dow, e.target.checked ? [{ start: '08:00', end: '17:00' }] : []))}
                                        data-day-toggle={dow}
                                    />
                                    {__(DAY_NAMES[dow]!)}
                                </label>
                                {day.length === 0 && <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('No atiende')}</span>}
                                {day.length > 0 && dow >= 1 && dow <= 5 && (
                                    <button type="button" className="imcrm-ml-auto imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline" onClick={() => onChange(copyDayToWeekdays(config, staff.id, dow))}>
                                        {__('Copiar a lun–vie')}
                                    </button>
                                )}
                            </div>
                            {day.map((t, i) => (
                                <div key={i} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-pl-6">
                                    <Input
                                        type="time"
                                        step={300}
                                        value={t.start}
                                        onChange={(e) => onChange(setDayIntervals(config, staff.id, dow, day.map((x, j) => (j === i ? { ...x, start: e.target.value || x.start } : x))))}
                                        className="imcrm-h-8 imcrm-w-32"
                                        aria-label={__('Desde')}
                                        data-interval-start={`${dow}-${i}`}
                                    />
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">–</span>
                                    <Input
                                        type="time"
                                        step={300}
                                        value={t.end === '24:00' ? '23:59' : t.end}
                                        onChange={(e) => onChange(setDayIntervals(config, staff.id, dow, day.map((x, j) => (j === i ? { ...x, end: e.target.value || x.end } : x))))}
                                        className="imcrm-h-8 imcrm-w-32"
                                        aria-label={__('Hasta')}
                                        data-interval-end={`${dow}-${i}`}
                                    />
                                    <IconBtn label={__('Quitar el tramo')} onClick={() => onChange(setDayIntervals(config, staff.id, dow, day.filter((_, j) => j !== i)))}>
                                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </IconBtn>
                                    {i === day.length - 1 && nextInterval(day) && day.length < 6 && (
                                        <IconBtn label={__('Agregar otro tramo')} onClick={() => onChange(setDayIntervals(config, staff.id, dow, [...day, nextInterval(day)!]))}>
                                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                        </IconBtn>
                                    )}
                                </div>
                            ))}
                            {problem && <p className="imcrm-pl-6 imcrm-text-[11px] imcrm-text-destructive">{__(problem)}</p>}
                        </div>
                    );
                })}
            </div>
            <Check
                label={__('No atender en festivos de Colombia')}
                checked={a.skip_holidays}
                onChange={(v) => onChange(updateStaff(config, staff.id, { availability: { ...a, skip_holidays: v } }))}
                testId="availability-holidays"
            />
            <Section title={__('Días especiales')}>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Vacaciones, un día cerrado o un sábado con otro horario. Pisan al horario de la semana (y a los festivos).')}
                </p>
                {a.exceptions.map((ex) => (
                    <div key={ex.date} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-exception={ex.date}>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <span className="imcrm-font-mono imcrm-text-xs">{ex.date}</span>
                            <Select
                                value={ex.closed ? 'closed' : 'open'}
                                onChange={(e) =>
                                    onChange(
                                        setException(config, staff.id, {
                                            ...ex,
                                            closed: e.target.value === 'closed',
                                            intervals: e.target.value === 'closed' ? [] : ex.intervals.length ? ex.intervals : [{ start: '09:00', end: '13:00' }],
                                        }),
                                    )
                                }
                                className="imcrm-h-8 imcrm-flex-1"
                            >
                                <option value="closed">{__('Cerrado')}</option>
                                <option value="open">{__('Otro horario')}</option>
                            </Select>
                            <IconBtn label={__('Quitar el día')} onClick={() => onChange(removeException(config, staff.id, ex.date))}>
                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            </IconBtn>
                        </div>
                        {!ex.closed &&
                            ex.intervals.map((t, i) => (
                                <div key={i} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                    <Input type="time" step={300} value={t.start} onChange={(e) => onChange(setException(config, staff.id, { ...ex, intervals: ex.intervals.map((x, j) => (j === i ? { ...x, start: e.target.value || x.start } : x)) }))} className="imcrm-h-8 imcrm-w-32" />
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">–</span>
                                    <Input type="time" step={300} value={t.end === '24:00' ? '23:59' : t.end} onChange={(e) => onChange(setException(config, staff.id, { ...ex, intervals: ex.intervals.map((x, j) => (j === i ? { ...x, end: e.target.value || x.end } : x)) }))} className="imcrm-h-8 imcrm-w-32" />
                                </div>
                            ))}
                        <Input value={ex.note} onChange={(e) => onChange(setException(config, staff.id, { ...ex, note: e.target.value }))} placeholder={__('Nota interna (opcional)')} className="imcrm-h-8" />
                    </div>
                ))}
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Input type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} className="imcrm-h-8 imcrm-w-44" aria-label={__('Fecha')} data-testid="exception-date" />
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!/^\d{4}-\d{2}-\d{2}$/.test(exDate)}
                        onClick={() => {
                            onChange(setException(config, staff.id, { date: exDate, closed: true, intervals: [], note: '' }));
                            setExDate('');
                        }}
                        data-testid="exception-add"
                    >
                        {__('Agregar día')}
                    </Button>
                </div>
            </Section>
        </div>
    );
}

const NOTICE_OPTIONS = [0, 30, 60, 120, 240, 720, 1440, 2880];

function RulesEditor({ config, onChange }: SectionEditorProps): JSX.Element {
    const r = config.rules;
    const set = (patch: Partial<BookingConfig['rules']>): void => onChange({ ...config, rules: { ...r, ...patch } });
    const minutes = (n: number): string => (n === 0 ? __('Sin aviso mínimo') : n < 60 ? `${n} min` : n % 1440 === 0 ? `${n / 1440} ${n === 1440 ? __('día') : __('días')}` : `${n / 60} h`);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Field label={__('Margen antes (min)')} hint={__('Para prepararse.')}>
                    <Input type="number" min={0} max={240} value={r.buffer_before_min} onChange={(e) => set({ buffer_before_min: clampInt(e.target.value, 0, 240) })} data-testid="rule-buffer-before" />
                </Field>
                <Field label={__('Margen después (min)')} hint={__('Limpieza, traslado o notas.')}>
                    <Input type="number" min={0} max={240} value={r.buffer_after_min} onChange={(e) => set({ buffer_after_min: clampInt(e.target.value, 0, 240) })} data-testid="rule-buffer-after" />
                </Field>
            </div>
            <Field label={__('Aviso mínimo')} hint={__('No se puede agendar, cambiar ni cancelar en línea con menos anticipación.')}>
                <Select value={String(r.min_notice_min)} onChange={(e) => set({ min_notice_min: Number(e.target.value) })} data-testid="rule-notice">
                    {[...new Set([...NOTICE_OPTIONS, r.min_notice_min])]
                        .sort((x, y) => x - y)
                        .map((n) => (
                            <option key={n} value={n}>
                                {minutes(n)}
                            </option>
                        ))}
                </Select>
            </Field>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Field label={__('Hasta cuántos días adelante')}>
                    <Input type="number" min={1} max={365} value={r.max_days_ahead} onChange={(e) => set({ max_days_ahead: clampInt(e.target.value, 1, 365) })} data-testid="rule-days" />
                </Field>
                <Field label={__('Un horario cada')}>
                    <Select value={String(r.slot_interval_min)} onChange={(e) => set({ slot_interval_min: Number(e.target.value) })} data-testid="rule-interval">
                        {BOOKING_SLOT_INTERVALS.map((n) => (
                            <option key={n} value={n}>
                                {n < 60 ? `${n} min` : `${n / 60} h`}
                            </option>
                        ))}
                    </Select>
                </Field>
            </div>
            <Field label={__('Máximo de citas por día (por persona o recurso)')} hint={__('Vacío = sin tope.')}>
                <Input
                    type="number"
                    min={1}
                    max={200}
                    value={r.max_per_day ?? ''}
                    onChange={(e) => set({ max_per_day: e.target.value === '' ? null : clampInt(e.target.value, 1, 200) })}
                    placeholder={__('Sin tope')}
                    data-testid="rule-max-day"
                />
            </Field>
            <Check label={__('El cliente puede cambiar el horario desde su correo')} checked={r.allow_reschedule} onChange={(v) => set({ allow_reschedule: v })} />
            <Check label={__('El cliente puede cancelar desde su correo')} checked={r.allow_cancel} onChange={(v) => set({ allow_cancel: v })} />
        </div>
    );
}

const MAPPING_LABELS: Record<BookingMappingKey, { label: string; hint?: string }> = {
    start_field_id: { label: 'Inicio de la cita', hint: 'Un campo Fecha y hora. Obligatorio.' },
    end_field_id: { label: 'Fin de la cita' },
    duration_field_id: { label: 'Duración' },
    person_field_id: { label: 'Quién atiende (persona)' },
    resource_field_id: { label: 'Recurso' },
    service_field_id: { label: 'Servicio', hint: 'Si es una selección, al publicar se crea una opción por servicio.' },
    name_field_id: { label: 'Nombre del cliente' },
    email_field_id: { label: 'Correo del cliente' },
    phone_field_id: { label: 'Teléfono del cliente' },
    status_field_id: { label: 'Estado', hint: 'Una selección: al publicar se crean «Confirmada», «Reprogramada» y «Cancelada» si no existen.' },
};

function FieldsEditor({ config, onChange, fields }: SectionEditorProps): JSX.Element {
    const statusField = config.mapping.status_field_id !== null ? fields.find((f) => f.id === config.mapping.status_field_id) : undefined;
    const statusOptions = statusField ? extractFieldOptions(statusField) : [];
    const available = availableQuestionFields(fields, config);
    const byId = new Map(fields.map((f) => [f.id, f]));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {BOOKING_MAPPING_KEYS.map((key) => {
                const cands = mappingCandidates(fields, key);
                const meta = MAPPING_LABELS[key];
                const value = config.mapping[key];
                return (
                    <Field key={key} label={__(meta.label)} {...(meta.hint ? { hint: __(meta.hint) } : {})}>
                        <Select value={value === null ? '' : String(value)} onChange={(e) => onChange(setMapping(config, key, e.target.value === '' ? null : Number(e.target.value)))} data-mapping={key}>
                            <option value="">{key === 'start_field_id' ? __('Elige un campo…') : __('No guardarlo')}</option>
                            {cands.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                        {cands.length === 0 && key === 'start_field_id' && <p className="imcrm-text-[11px] imcrm-text-destructive">{__('La lista no tiene un campo «Fecha y hora»: agrégalo en Campos.')}</p>}
                    </Field>
                );
            })}
            {statusField && (
                <Section title={__('Valores del estado')}>
                    {(['confirmed', 'rescheduled', 'cancelled'] as BookingStatus[]).map((st) => {
                        const k = `status_${st}` as const;
                        return (
                            <Field key={st} label={__(BOOKING_STATUS_LABELS[st])}>
                                <Select value={config.mapping[k] ?? ''} onChange={(e) => onChange({ ...config, mapping: { ...config.mapping, [k]: e.target.value === '' ? null : e.target.value } })} data-status-value={st}>
                                    <option value="">{`${__('Se crea al publicar')}: «${__(BOOKING_STATUS_LABELS[st])}»`}</option>
                                    {statusOptions.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        );
                    })}
                </Section>
            )}
            <Section title={__('Lo que se le pregunta al cliente')}>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Siempre se piden nombre y correo. El teléfono, según esta opción:')}</p>
                <Segmented
                    label={__('Teléfono')}
                    value={config.settings.ask_phone}
                    options={[
                        { value: 'required', label: __('Obligatorio') },
                        { value: 'optional', label: __('Opcional') },
                        { value: 'hidden', label: __('No pedirlo') },
                    ]}
                    onChange={(v) => onChange({ ...config, settings: { ...config.settings, ask_phone: v } })}
                />
                {config.questions.map((q, i) =>
                    q.type === 'field' ? (
                        <div key={q.id} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-question={q.id}>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                {(() => {
                                    const Icon = fieldTypeIcon(byId.get(q.field_id)?.type ?? 'text');
                                    return <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />;
                                })()}
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{byId.get(q.field_id)?.label ?? __('Campo borrado')}</span>
                                <IconBtn label={__('Subir')} disabled={i === 0} onClick={() => onChange(moveQuestion(config, q.id, -1))}>
                                    <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                                </IconBtn>
                                <IconBtn label={__('Bajar')} disabled={i === config.questions.length - 1} onClick={() => onChange(moveQuestion(config, q.id, 1))}>
                                    <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                                </IconBtn>
                                <IconBtn label={__('Quitar la pregunta')} onClick={() => onChange(removeQuestion(config, q.id))}>
                                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                </IconBtn>
                            </div>
                            <Input value={q.label} placeholder={byId.get(q.field_id)?.label ?? ''} onChange={(e) => onChange(updateQuestion(config, q.id, { label: e.target.value }))} className="imcrm-h-8" aria-label={__('Pregunta')} />
                            <Input value={q.help} placeholder={__('Ayuda (opcional)')} onChange={(e) => onChange(updateQuestion(config, q.id, { help: e.target.value }))} className="imcrm-h-8" />
                            {byId.get(q.field_id)?.is_required ? (
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Obligatoria: la lista exige este campo.')}</p>
                            ) : (
                                <Check label={__('Obligatoria')} checked={q.required} onChange={(v) => onChange(updateQuestion(config, q.id, { required: v }))} />
                            )}
                        </div>
                    ) : null,
                )}
                {available.length > 0 && (
                    <Select value="" onChange={(e) => e.target.value && onChange(addQuestion(config, Number(e.target.value)))} data-testid="question-add">
                        <option value="">{__('+ Agregar una pregunta…')}</option>
                        {available.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                )}
            </Section>
        </div>
    );
}

const REMINDER_PRESETS = [10, 30, 60, 120, 180, 1440, 2880, 10080];

function EmailsEditor({ config, onChange, captchaAvailable, consentActive }: SectionEditorProps): JSX.Element {
    const n = config.notifications;
    const s = config.settings;
    const setN = (patch: Partial<BookingConfig['notifications']>): void => onChange({ ...config, notifications: { ...n, ...patch } });
    const setS = (patch: Partial<BookingConfig['settings']>): void => onChange({ ...config, settings: { ...s, ...patch } });
    const minutes = n.reminders.map((r) => r.minutes_before);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Check label={__('Mandarle al cliente la confirmación por correo')} checked={n.confirm_email} onChange={(v) => setN({ confirm_email: v })} testId="email-confirm" />
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {__('Sale con la marca de la empresa, el archivo para agregarla a su calendario y los enlaces para cambiar el horario o cancelar. Usa el correo de la empresa (Ajustes → Correo).')}
            </p>
            <Field label={__('Indicaciones para el cliente (opcional)')} hint={__('Van en el correo: qué traer, cómo llegar, el enlace de la videollamada…')}>
                <Textarea rows={3} value={n.email_note} onChange={(e) => setN({ email_note: e.target.value })} data-testid="email-note" />
            </Field>
            <Section title={__('Recordatorios por correo')}>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" data-testid="reminders">
                    {minutes.map((m) => (
                        <span key={m} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-py-0.5 imcrm-pl-2.5 imcrm-pr-1 imcrm-text-xs" data-reminder={m}>
                            {__(reminderLabel(m))}
                            <button type="button" aria-label={__('Quitar el recordatorio')} className="imcrm-rounded-full imcrm-p-0.5 hover:imcrm-bg-accent" onClick={() => onChange(setReminders(config, minutes.filter((x) => x !== m)))}>
                                <X className="imcrm-h-3 imcrm-w-3" />
                            </button>
                        </span>
                    ))}
                    {minutes.length === 0 && <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sin recordatorios')}</span>}
                </div>
                {minutes.length < 5 && (
                    <Select value="" onChange={(e) => e.target.value && onChange(setReminders(config, [...minutes, Number(e.target.value)]))} data-testid="reminder-add">
                        <option value="">{__('+ Agregar un recordatorio…')}</option>
                        {REMINDER_PRESETS.filter((m) => !minutes.includes(m)).map((m) => (
                            <option key={m} value={m}>
                                {__(reminderLabel(m))}
                            </option>
                        ))}
                    </Select>
                )}
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Cada recordatorio sale una sola vez por cita. Si la cita se mueve, se vuelven a programar.')}</p>
            </Section>
            <SmsRemindersEditor config={config} onChange={onChange} />
            <Check
                label={__('Avisarle al cliente si el equipo mueve o cancela su cita')}
                checked={n.notify_client_on_team_change}
                onChange={(v) => setN({ notify_client_on_team_change: v })}
            />
            <Field label={__('Mensaje al terminar de agendar')}>
                <Textarea rows={2} value={s.success_message} onChange={(e) => setS({ success_message: e.target.value })} />
            </Field>
            <Section title={__('Protección y datos personales')}>
                {consentActive ? (
                    <Check label={__('Pedir la autorización de tratamiento de datos (Ley 1581)')} checked={s.data_consent} onChange={(v) => setS({ data_consent: v })} />
                ) : (
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('La autorización de tratamiento de datos se activa en Ajustes → Datos personales.')}</p>
                )}
                <Check
                    label={__('Pedir la verificación anti-robots (captcha)')}
                    checked={s.captcha}
                    disabled={!captchaAvailable?.provider && !s.captcha}
                    onChange={(v) => setS({ captcha: v })}
                />
                {!captchaAvailable?.provider && (
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Para usarla, carga las llaves en Ajustes → Portal y formularios.')}</p>
                )}
            </Section>
        </div>
    );
}

const SMS_REMINDER_TAGS: Array<{ tag: string; label: string }> = [
    { tag: 'cita.cliente', label: 'Cliente' },
    { tag: 'cita.servicio', label: 'Servicio' },
    { tag: 'cita.inicio', label: 'Fecha y hora' },
    { tag: 'cita.hora', label: 'Hora' },
    { tag: 'cita.persona', label: 'Quién atiende' },
    { tag: 'cita.enlace_reprogramar', label: 'Enlace para cambiarla' },
    { tag: 'cita.enlace_cancelar', label: 'Enlace para cancelar' },
];

/**
 * SMS (ADR-S82) — los recordatorios también por SMS: los MISMOS momentos de
 * arriba, al teléfono que dejó el cliente, con la conexión de SMS de la
 * empresa. El texto lleva `{{cita.*}}` y el contador de SMS.
 */
function SmsRemindersEditor({ config, onChange }: Pick<SectionEditorProps, 'config' | 'onChange'>): JSX.Element {
    const sms = config.notifications.sms_reminders;
    const connections = useSmsConnections(true);
    const set = (patch: Partial<BookingConfig['notifications']['sms_reminders']>): void =>
        onChange({ ...config, notifications: { ...config.notifications, sms_reminders: { ...sms, ...patch } } });
    const insert = (tag: string): void => set({ text: `${sms.text}${sms.text.endsWith(' ') || sms.text === '' ? '' : ' '}{{${tag}}}` });
    return (
        <Section title={__('Recordatorios por SMS')}>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="booking-sms-reminders" data-tour="booking-sms-reminders">
                <Check
                    label={__('Mandar los recordatorios también por SMS')}
                    checked={sms.enabled}
                    onChange={(v) => set({ enabled: v, ...(v && sms.connection_id === null && connections[0] ? { connection_id: connections[0].id } : {}) })}
                    testId="booking-sms-enabled"
                />
                {connections.length === 0 && (
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Para usarlo, conecta un proveedor de SMS (Twilio, BulkGate, Infobip, LabsMobile u Onurix) en Ajustes → Integraciones.')}
                    </p>
                )}
                {sms.enabled && (
                    <>
                        <Field label={__('Enviar con')}>
                            <Select
                                value={sms.connection_id ?? ''}
                                onChange={(e) => set({ connection_id: e.target.value === '' ? null : Number(e.target.value) })}
                                data-testid="booking-sms-connection"
                            >
                                <option value="">{__('(elige una conexión)')}</option>
                                {connections.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={__('Texto del SMS')}>
                            <Textarea rows={3} value={sms.text} onChange={(e) => set({ text: e.target.value })} data-testid="booking-sms-text" />
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                                {SMS_REMINDER_TAGS.map((t) => (
                                    <button
                                        key={t.tag}
                                        type="button"
                                        className="imcrm-rounded imcrm-border imcrm-border-border imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-bg-accent"
                                        onClick={() => insert(t.tag)}
                                    >
                                        {__(t.label)}
                                    </button>
                                ))}
                            </div>
                            <SmsCounter text={sms.text} stripAccents={sms.strip_accents} onStripAccents={(v) => set({ strip_accents: v })} hasVariables />
                        </Field>
                        {config.mapping.phone_field_id === null && (
                            <p className="imcrm-text-[11px] imcrm-text-warning">{__('Falta elegir el campo del teléfono del cliente en «Campos de la lista».')}</p>
                        )}
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Sale en los mismos momentos que los recordatorios de arriba. Es un aviso de servicio: no espera el horario de mensajes comerciales.')}
                        </p>
                    </>
                )}
            </div>
        </Section>
    );
}

function PublishEditor({ config, onChange, page, problems, onPublish, onRegenerate, busy }: SectionEditorProps): JSX.Element {
    const s = config.settings;
    const setS = (patch: Partial<BookingConfig['settings']>): void => onChange({ ...config, settings: { ...s, ...patch } });
    const all = Object.values(problems).flat();
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3 imcrm-text-center" data-testid="booking-counts">
                <div>
                    <p className="imcrm-text-xl imcrm-font-semibold">{page.upcoming_count}</p>
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('citas próximas')}</p>
                </div>
                <div>
                    <p className="imcrm-text-xl imcrm-font-semibold">{page.bookings_count}</p>
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('reservas en total')}</p>
                </div>
            </div>
            {all.length > 0 ? (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive" data-testid="booking-publish-problems">
                    <li className="imcrm-font-medium">{__('Para publicarla falta:')}</li>
                    {all.map((m) => (
                        <li key={m}>• {__(m)}</li>
                    ))}
                </ul>
            ) : (
                <Button size="sm" variant={page.enabled ? 'outline' : 'default'} className="imcrm-self-start" disabled={busy} onClick={onPublish} data-testid="booking-publish-button">
                    {page.enabled ? __('Dejar de recibir reservas') : __('Publicar la agenda')}
                </Button>
            )}
            <CopyRow label={__('Enlace')} value={bookingPublicUrl(page)} testId="booking-link-inline" />
            <CopyRow label={__('Insertar en tu sitio')} value={bookingEmbedCode(page)} testId="booking-embed-inline" />
            <Button variant="ghost" size="sm" className="imcrm-gap-1.5 imcrm-self-start" onClick={onRegenerate} disabled={busy} data-testid="booking-regenerate">
                <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Cambiar la dirección')}
            </Button>
            <Section title={__('Cómo se ve')}>
                <Field label={__('Título')}>
                    <Input value={s.title} onChange={(e) => setS({ title: e.target.value })} placeholder={page.name} data-testid="booking-title" />
                </Field>
                <Field label={__('Descripción')}>
                    <Textarea rows={3} value={s.description} onChange={(e) => setS({ description: e.target.value })} />
                </Field>
                <Field label={__('Dónde es la cita')} hint={__('Una dirección, «Videollamada»… Va en la página, el correo y el archivo del calendario.')}>
                    <Input value={s.location} onChange={(e) => setS({ location: e.target.value })} data-testid="booking-location" />
                </Field>
                <ColorField label={__('Color')} value={s.accent_color} onChange={(v) => setS({ accent_color: v })} placeholder={__('El de la marca')} />
                <Check label={__('Mostrar el logo de la empresa')} checked={s.show_logo} onChange={(v) => setS({ show_logo: v })} />
                <Field label={__('Mensaje cuando no recibe reservas')}>
                    <Textarea rows={2} value={s.closed_message} onChange={(e) => setS({ closed_message: e.target.value })} />
                </Field>
            </Section>
            <Section title={__('Dónde se puede insertar')}>
                <Field label={__('Sitios permitidos (uno por línea)')} hint={__('Vacío = cualquier sitio. Ej.: miempresa.com o *.miempresa.com')}>
                    <DomainsField value={s.allowed_domains} onChange={(v) => setS({ allowed_domains: v })} />
                </Field>
            </Section>
        </div>
    );
}

function parseDomains(text: string): string[] {
    return text
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 50);
}

/**
 * Un sitio por línea. El texto se guarda aparte del valor: si se derivara del
 * valor ya limpio, el Enter para escribir el segundo sitio se borraría al
 * instante (la línea vacía no es un sitio).
 */
function DomainsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }): JSX.Element {
    const joined = value.join('\n');
    const [text, setText] = useState(joined);
    const [seen, setSeen] = useState(joined);
    if (joined !== seen) {
        // Cambió desde afuera (deshacer, guardar): se adopta salvo que sea lo mismo que ya se escribe.
        setSeen(joined);
        if (parseDomains(text).join('\n') !== joined) setText(joined);
    }
    return (
        <Textarea
            rows={3}
            value={text}
            onChange={(e) => {
                setText(e.target.value);
                const next = parseDomains(e.target.value);
                setSeen(next.join('\n'));
                onChange(next);
            }}
            placeholder={'miempresa.com\n*.miempresa.com'}
            data-testid="booking-domains"
        />
    );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            className="imcrm-shrink-0 imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-opacity-30"
        >
            {children}
        </button>
    );
}

function clampInt(raw: string, min: number, max: number): number {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

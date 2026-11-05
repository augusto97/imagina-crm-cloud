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
    Moon,
    Palette,
    Plus,
    Redo2,
    RefreshCw,
    Send,
    ShieldCheck,
    Smartphone,
    Sun,
    Tag,
    Trash2,
    Undo2,
    Users,
    X,
    type LucideIcon,
} from 'lucide-react';
import {
    BOOKING_APPROVAL_MODES,
    BOOKING_APPROVAL_MODE_LABELS,
    BOOKING_ASSIGN_MODES,
    BOOKING_ASSIGN_MODE_LABELS,
    BOOKING_MAPPING_KEYS,
    BOOKING_SLOT_INTERVALS,
    BOOKING_STATUS_LABELS,
    BOOKING_CLASSIC_THEME,
    bookingTheme,
    buildPublicThemeCss,
    publicThemeFileIds,
    resolvePublicPalettes,
    type BookingConfig,
    type BookingMappingKey,
    type BookingPageDto,
    type BookingStaff,
    type BookingStatus,
} from '@imagina-base/shared';

import { ThemeToggle } from '@/components/ThemeToggle';
import { useSession } from '@/cloud/session';
import { getThemeState } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useAttachments } from '@/hooks/useAttachments';
import { useBrandingData } from '@/hooks/useBranding';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __, sprintf } from '@/lib/i18n';
import { getTenantFormat } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section, Segmented } from '../automations/email/EmailBlockInspector';
import { useCaptchaAvailability, useDataConsentAvailability } from '../forms/useForms';
import { useAttachmentUrls } from '../forms/design/useFormThemes';
import { effectiveTheme, fallbackAccent, patchThemeSection, resolvedAccent } from '../forms/design/themeOps';
import { BookingDesignEditor } from './BookingDesignEditor';
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
    mappingCandidates,
    moveQuestion,
    reminderLabel,
    removeException,
    removeQuestion,
    removeStaff,
    bookingSaveErrorText,
    sectionProblems,
    staffCalendarsFrom,
    setDayIntervals,
    setException,
    setMapping,
    setReminders,
    toggleStaffService,
    updateQuestion,
    updateStaff,
    type BookingSection,
} from './bookingDesignOps';
import { CalendarSyncEditor, StaffCalendarPanel } from './BookingCalendarParts';
import { HolidayPanel, IconBtn, intervalLabel, NOTICE_OPTIONS, ServiceCard, StaffProfile, TimeOffEditor, WeekHoursEditor } from './BookingRulesParts';
import { EmbedCodePicker } from '../forms/EmbedCodePicker';
import { PublicQrCard } from '../forms/PublicQrCard';
import {
    bookingPublicOrigin,
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
    { id: 'aprobacion', label: 'Aprobación y seguridad', icon: ShieldCheck },
    { id: 'campos', label: 'Campos de la lista', icon: ListChecks },
    { id: 'correos', label: 'Correos y recordatorios', icon: Mail },
    { id: 'diseno', label: 'Diseño', icon: Palette },
    { id: 'publicar', label: 'Publicar', icon: Send },
];

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
    // v0.1.354 — con el modo «según el dispositivo», qué ver en la vista previa (arranca como la app).
    const [previewScheme, setPreviewScheme] = useState<'light' | 'dark'>(() => getThemeState().resolved);
    // El CSS propio del diseño lo escribe sólo un administrador (el rol, no la capacidad).
    const isAdmin = useSession((st) => st.memberships.find((m) => m.tenant_id === st.activeTenantId)?.role === 'admin');

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
    // Cuántas veces avisó la vista previa que está lista: en el celular la
    // pestaña «Vista previa» se desmonta y el iframe vuelve a cargar, así que
    // cada aviso tiene que volver a mandarle lo que se está editando.
    const [ready, setReady] = useState(0);
    const members = useMemo(() => options.data?.members ?? [], [options.data]);
    const timeZone = options.data?.time_zone ?? 'America/Bogota';
    const photoIds = useMemo(() => config.staff.flatMap((s) => (s.photo_file_id !== null ? [s.photo_file_id] : [])), [config.staff]);
    const photos = useAttachments(photoIds);
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
                photoUrl: (id) => photos.data?.get(id)?.url ?? null,
            }),
        [config, draft.name, fields, members, branding.data, timeZone, captcha.data?.provider, dataConsent.data, photos.data],
    );

    useEffect(() => {
        const onMessage = (e: MessageEvent): void => {
            if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow) return;
            const data = e.data as { type?: string; id?: number; service?: string; staff?: string; from?: string; to?: string; duration?: number } | null;
            if (data?.type === 'imb-booking-ready') setReady((n) => n + 1);
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
                    ...(typeof data.duration === 'number' && data.duration > 0 ? { duration: data.duration } : {}),
                })
                    .then((res) => reply(res.slots))
                    .catch(() => reply([]));
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [listId, page.id]);
    // ── v0.1.354 — El diseño (ADR-S94): el CSS del tema que recibe la vista previa ──
    const brandColor = branding.data?.primary_color ?? '#0e7490';
    const theme = useMemo(() => bookingTheme(config.settings), [config.settings]);
    const themeImageIds = useMemo(() => publicThemeFileIds(theme), [theme]);
    const themeImageUrls = useAttachmentUrls(themeImageIds);
    const themeCss = useMemo(() => {
        const img = (id: number | null): string | null => (id === null ? null : (themeImageUrls.get(id) ?? null));
        return buildPublicThemeCss(theme, {
            accent: fallbackAccent(config.settings, brandColor),
            images: {
                cover: img(theme.cover.file_id),
                split: img(theme.split.file_id),
                background: theme.background.kind === 'image' ? img(theme.background.file_id) : null,
            },
        });
    }, [theme, config.settings, brandColor, themeImageUrls]);
    const scheme = theme.mode === 'auto' ? previewScheme : null;
    const previewBg = useMemo(() => {
        const pals = resolvePublicPalettes(theme, fallbackAccent(config.settings, brandColor));
        return (scheme === 'dark' && pals.dark ? pals.dark : pals.main).background;
    }, [theme, config.settings, brandColor, scheme]);

    useEffect(() => {
        if (!ready) return;
        iframeRef.current?.contentWindow?.postMessage({ type: 'imb-booking-preview', meta, css: themeCss, scheme }, window.location.origin);
    }, [ready, meta, themeCss, scheme]);

    const problems = useMemo(
        () =>
            sectionProblems(config, fields, {
                // v0.1.350 — la videollamada depende del calendario de cada persona.
                ...(options.data ? { staffCalendars: staffCalendarsFrom(config, options.data.members, options.data.calendars) } : {}),
                memberNames: new Map(members.map((m) => [m.id, m.name])),
            }),
        [config, fields, options.data, members],
    );
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
            toast.error(__('No se pudo guardar'), bookingSaveErrorText(err, draft.config, new Map(members.map((m) => [m.id, m.name]))));
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
            listId={listId}
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
            brand={brandColor}
            isAdmin={isAdmin}
            narrow={narrow}
            pageName={draft.name}
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
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                {theme.mode === 'auto' && (
                    <div
                        role="group"
                        aria-label={__('Modo de la vista previa')}
                        className="imcrm-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-0.5"
                        data-testid="booking-preview-scheme"
                    >
                        {(
                            [
                                ['light', Sun, __('Claro')],
                                ['dark', Moon, __('Oscuro')],
                            ] as const
                        ).map(([key, Icon, label]) => (
                            <button
                                key={key}
                                type="button"
                                title={`${__('Ver como en un dispositivo en modo')} ${label.toLowerCase()}`}
                                aria-pressed={previewScheme === key}
                                onClick={() => setPreviewScheme(key)}
                                className={cn(
                                    'imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-[11px]',
                                    previewScheme === key ? 'imcrm-bg-background imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground',
                                )}
                            >
                                <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                                <span className="imcrm-hidden sm:imcrm-inline">{label}</span>
                            </button>
                        ))}
                    </div>
                )}
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
            </div>
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-justify-center imcrm-overflow-hidden imcrm-p-3">
                <iframe
                    ref={iframeRef}
                    src="/api/v1/public/b/preview"
                    title={__('Vista previa de la agenda')}
                    style={{ background: previewBg }}
                    className={cn(
                        'imcrm-h-full imcrm-rounded-lg imcrm-border imcrm-border-border',
                        device === 'mobile' ? 'imcrm-w-[375px]' : 'imcrm-w-full',
                        device === 'desktop' && (theme.split.enabled ? 'imcrm-max-w-[1100px]' : 'imcrm-max-w-[860px]'),
                    )}
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
            {shareOpen && (
                <SharePanel
                    page={current}
                    accent={resolvedAccent(current.config.settings, brandColor, BOOKING_CLASSIC_THEME)}
                    onClose={() => setShareOpen(false)}
                    onPublish={() => void togglePublish()}
                />
            )}

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

function SharePanel({ page, accent, onClose, onPublish }: { page: BookingPageDto; accent: string; onClose: () => void; onPublish: () => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-max-h-[65dvh] imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto imcrm-border-b imcrm-border-border imcrm-bg-muted/40 imcrm-px-4 imcrm-py-3" data-testid="booking-share-panel">
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
            <CopyRow label={__('Enlace')} value={bookingPublicUrl(page)} testId="booking-link" />
            <EmbedCodePicker
                target={{ url: bookingPublicUrl(page), origin: bookingPublicOrigin(page), title: page.config.settings.title.trim() || page.name, kind: 'booking' }}
                accent={accent}
                testId="booking-embed"
                dataTour="booking-embed-mode"
            />
            <PublicQrCard url={bookingPublicUrl(page)} name={page.config.settings.title.trim() || page.name} kind="booking" />
            <a href={bookingPublicUrl(page)} target="_blank" rel="noreferrer" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-text-xs imcrm-text-primary hover:imcrm-underline">
                <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                {__('Abrir en otra pestaña')}
            </a>
        </div>
    );
}

// ─────────────────────────── Secciones ───────────────────────────

interface SectionEditorProps {
    listId: number;
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
    /** v0.1.354 — para «Diseño». */
    brand: string;
    isAdmin: boolean;
    narrow: boolean;
    pageName: string;
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
            {p.section === 'aprobacion' && <ApprovalEditor {...p} />}
            {p.section === 'campos' && <FieldsEditor {...p} />}
            {p.section === 'correos' && <EmailsEditor {...p} />}
            {p.section === 'diseno' && (
                <BookingDesignEditor
                    config={p.config}
                    onChange={p.onChange}
                    brand={p.brand}
                    isAdmin={p.isAdmin}
                    narrow={p.narrow}
                    suggestedName={p.config.settings.title || p.pageName}
                />
            )}
            {p.section === 'publicar' && <PublishEditor {...p} />}
        </div>
    );
}

const SECTION_HINTS: Record<BookingSection, string> = {
    servicios: __('Lo que se puede agendar y cuánto dura cada cosa. El precio es sólo informativo: no se cobra.'),
    atienden: __('Las personas del equipo (las que pueden editar esta lista) o los recursos —una sala, un consultorio— que atienden las citas.'),
    disponibilidad: __('El horario de cada uno, en la zona horaria de la empresa. Los días con otro horario o cerrados van en «Días especiales».'),
    reglas: __('Cuánto margen dejar entre citas, con cuánta anticipación se puede agendar y hasta cuándo.'),
    aprobacion: __('Si alguien del equipo aprueba cada cita antes de confirmarla, y cómo se protege la página de reservas falsas.'),
    campos: __('En qué campo de la lista se guarda cada dato de la cita, y qué más se le pregunta al cliente.'),
    correos: __('El correo de confirmación (con el archivo para agregarla al calendario), los recordatorios y lo que ve al terminar.'),
    diseno: __('Una plantilla o tu propio diseño: colores, tipografía, tamaños, portada, fondo, qué se muestra y cómo se distribuye.'),
    publicar: __('Los textos de la página, dónde se puede insertar y su enlace.'),
};

function ServicesEditor({ config, onChange }: SectionEditorProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {config.services.map((s, i) => (
                <ServiceCard key={s.id} svc={s} index={i} config={config} onChange={onChange} />
            ))}
            <Button variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-self-start" onClick={() => onChange(addService(config).config)} data-testid="service-add">
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Agregar servicio')}
            </Button>
        </div>
    );
}

const ASSIGN_HINTS: Record<BookingConfig['rules']['assign_mode'], string> = {
    rotate: __('Cada cita nueva va al siguiente que esté libre, en orden.'),
    balance: __('La cita va a quien tiene menos citas en los próximos 30 días: nadie queda sobrecargado.'),
    priority: __('Va a quien tenga la prioridad más alta y esté libre; entre iguales, por turno. Útil para un asesor principal y otros de respaldo.'),
};

function StaffEditor({ config, onChange, options, listId }: SectionEditorProps): JSX.Element {
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
                    ? __('El cliente ve quién atiende (con su foto y su cargo) y también «El primero disponible», que reparte las citas entre quienes están libres.')
                    : __('El cliente no elige: la cita va a quien esté libre.')}
            </p>
            {config.staff.length > 1 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="assign-mode">
                    <Segmented
                        label={__('Cómo se reparten las citas')}
                        value={config.rules.assign_mode}
                        options={BOOKING_ASSIGN_MODES.map((m) => ({ value: m, label: __(BOOKING_ASSIGN_MODE_LABELS[m]) }))}
                        onChange={(v) => onChange({ ...config, rules: { ...config.rules, assign_mode: v } })}
                    />
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{ASSIGN_HINTS[config.rules.assign_mode]}</p>
                </div>
            )}
            {config.staff.map((s) => (
                <StaffCard key={s.id} staff={s} config={config} onChange={onChange} options={options} used={used} listId={listId} showPriority={config.staff.length > 1 && config.rules.assign_mode === 'priority'} />
            ))}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="imcrm-gap-1.5"
                    disabled={free.length === 0}
                    title={free.length === 0 ? __('Ya están todas las personas que pueden editar la lista') : undefined}
                    onClick={() => onChange(addStaff(config, 'user', free[0]?.id ?? null, options.time_zone).config)}
                    data-testid="staff-add-user"
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar persona')}
                </Button>
                <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => onChange(addStaff(config, 'resource', null, options.time_zone).config)} data-testid="staff-add-resource">
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar recurso')}
                </Button>
            </div>
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {__('Una persona aparece si puede editar esta lista (si no, no vería sus propias citas). Si atiende en otras agendas de la empresa, sus citas de allá también ocupan su horario aquí.')}
            </p>
            {config.staff.some((s) => s.kind === 'user') && <CalendarSyncEditor config={config} onChange={onChange} />}
        </div>
    );
}

function StaffCard({
    staff,
    config,
    onChange,
    options,
    used,
    listId,
    showPriority,
}: {
    staff: BookingStaff;
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
    options: BookingEditorOptions;
    used: Set<number>;
    listId: number;
    showPriority: boolean;
}): JSX.Element {
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
                        onChange={(e) => onChange(updateStaff(config, staff.id, { staff_user_id: e.target.value === '' ? null : Number(e.target.value), connection_id: null, busy_calendars: [], write_calendar: null }))}
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
            <StaffProfile staff={staff} config={config} onChange={onChange} showPriority={showPriority} />
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
            {staff.kind === 'user' && <StaffCalendarPanel staff={staff} config={config} onChange={onChange} options={options} listId={listId} />}
            {staff.kind === 'resource' && config.services.some((x) => x.active && x.location.kind === 'video' && (staff.services.length === 0 || staff.services.includes(x.id))) && (
                <Field label={__('Enlace de videollamada fijo')} hint={__('Un recurso no tiene calendario: sus videollamadas usan este enlace.')}>
                    <Input
                        type="url"
                        value={staff.meeting_url}
                        onChange={(e) => onChange(updateStaff(config, staff.id, { meeting_url: e.target.value.trim() }))}
                        placeholder="https://zoom.us/j/123456789"
                        className="imcrm-h-8"
                        data-testid="staff-meeting-url"
                    />
                </Field>
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

function AvailabilityEditor({ config, onChange, options, listId }: SectionEditorProps): JSX.Element {
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
            <WeekHoursEditor
                week={a.week}
                onDay={(dow, intervals) => onChange(setDayIntervals(config, staff.id, dow, intervals))}
                onCopyWeekdays={(dow) => onChange(copyDayToWeekdays(config, staff.id, dow))}
                testId="availability-week"
            />
            <HolidayPanel listId={listId} staff={staff} config={config} onChange={onChange} />
            <Section title={__('Vacaciones y ausencias')}>
                <TimeOffEditor staff={staff} config={config} onChange={onChange} />
            </Section>
            <Section title={__('Días especiales')}>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Un día cerrado o un sábado con otro horario. Pisan al horario de la semana, a las vacaciones y a los festivos.')}
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

function CapInput({ label, hint, value, max, onChange, testId }: { label: string; hint?: string; value: number | null; max: number; onChange: (v: number | null) => void; testId: string }): JSX.Element {
    return (
        <Field label={label} hint={hint}>
            <Input type="number" min={1} max={max} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : clampInt(e.target.value, 1, max))} placeholder={__('Sin tope')} data-testid={testId} />
        </Field>
    );
}

function RulesEditor({ config, onChange }: SectionEditorProps): JSX.Element {
    const r = config.rules;
    const set = (patch: Partial<BookingConfig['rules']>): void => onChange({ ...config, rules: { ...r, ...patch } });
    const minutes = (n: number): string => (n === 0 ? __('Sin aviso mínimo') : n < 60 ? `${n} min` : n % 1440 === 0 ? `${n / 1440} ${n === 1440 ? __('día') : __('días')}` : `${n / 60} h`);
    const today = new Date().toISOString().slice(0, 10);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Section title={__('Tiempo entre citas')}>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    <Field label={__('Margen antes (min)')} hint={__('Para prepararse.')}>
                        <Input type="number" min={0} max={240} value={r.buffer_before_min} onChange={(e) => set({ buffer_before_min: clampInt(e.target.value, 0, 240) })} data-testid="rule-buffer-before" />
                    </Field>
                    <Field label={__('Margen después (min)')} hint={__('Limpieza, traslado o notas.')}>
                        <Input type="number" min={0} max={240} value={r.buffer_after_min} onChange={(e) => set({ buffer_after_min: clampInt(e.target.value, 0, 240) })} data-testid="rule-buffer-after" />
                    </Field>
                </div>
                <Field label={__('Un horario cada')} hint={__('Cada cuánto empieza un horario. «Lo que dura la cita» los pone uno detrás de otro (8:00, 8:45, 9:30 para citas de 45 min).')}>
                    <Select value={String(r.slot_interval_min)} onChange={(e) => set({ slot_interval_min: Number(e.target.value) })} data-testid="rule-interval">
                        {BOOKING_SLOT_INTERVALS.map((n) => (
                            <option key={n} value={n}>
                                {intervalLabel(n)}
                            </option>
                        ))}
                    </Select>
                </Field>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Cada servicio puede tener sus propios márgenes, aviso mínimo e intervalo (en «Servicios» → «Reglas propias del servicio»).')}</p>
            </Section>
            <Section title={__('Con cuánta anticipación')}>
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
                <Segmented
                    label={__('Hasta cuándo se puede agendar')}
                    value={r.window_mode}
                    options={[
                        { value: 'rolling', label: __('Los próximos días') },
                        { value: 'range', label: __('Entre dos fechas') },
                    ]}
                    onChange={(v) => set({ window_mode: v })}
                />
                {r.window_mode === 'rolling' ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="rule-window-rolling">
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Input type="number" min={1} max={365} value={r.max_days_ahead} onChange={(e) => set({ max_days_ahead: clampInt(e.target.value, 1, 365) })} className="imcrm-w-24" aria-label={__('Cuántos días')} data-testid="rule-days" />
                            <span className="imcrm-text-sm">{r.business_days ? __('días hábiles hacia adelante') : __('días hacia adelante')}</span>
                        </div>
                        <Check label={__('Contar sólo días hábiles (lunes a viernes)')} checked={r.business_days} onChange={(v) => set({ business_days: v })} testId="rule-business-days" />
                    </div>
                ) : (
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2" data-testid="rule-window-range">
                        <Field label={__('Desde')}>
                            <Input type="date" value={r.range_start ?? ''} min={today} onChange={(e) => set({ range_start: e.target.value || null, range_end: r.range_end && e.target.value && r.range_end < e.target.value ? e.target.value : r.range_end })} data-testid="rule-range-start" />
                        </Field>
                        <Field label={__('Hasta')}>
                            <Input type="date" value={r.range_end ?? ''} min={r.range_start ?? today} onChange={(e) => set({ range_end: e.target.value || null })} data-testid="rule-range-end" />
                        </Field>
                        <p className="imcrm-col-span-2 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Para una temporada, un evento o una feria: fuera de esas fechas la página no ofrece horarios.')}</p>
                    </div>
                )}
            </Section>
            <Section title={__('Cupos y topes')}>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Por persona o recurso. Un horario grupal (un taller con varios cupos) cuenta como una sola cita. Vacío = sin tope.')}</p>
                <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                    <CapInput label={__('Por día')} value={r.max_per_day} max={200} onChange={(v) => set({ max_per_day: v })} testId="rule-max-day" />
                    <CapInput label={__('Por semana')} value={r.max_per_week} max={1000} onChange={(v) => set({ max_per_week: v })} testId="rule-max-week" />
                    <CapInput label={__('Por mes')} value={r.max_per_month} max={5000} onChange={(v) => set({ max_per_month: v })} testId="rule-max-month" />
                </div>
                <CapInput
                    label={__('Citas pendientes por cliente')}
                    hint={__('Cuántas citas futuras puede tener a la vez un mismo correo. Evita que una persona acapare la agenda.')}
                    value={r.max_active_per_client}
                    max={50}
                    onChange={(v) => set({ max_active_per_client: v })}
                    testId="rule-max-client"
                />
            </Section>
            <Section title={__('Cambios del cliente')}>
                <Check label={__('El cliente puede cambiar el horario desde su correo')} checked={r.allow_reschedule} onChange={(v) => set({ allow_reschedule: v })} />
                <Check label={__('El cliente puede cancelar desde su correo')} checked={r.allow_cancel} onChange={(v) => set({ allow_cancel: v })} />
            </Section>
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
    meeting_url_field_id: { label: 'Enlace de la reunión', hint: 'Un campo Enlace o Texto: guarda el enlace de la videollamada de cada cita (Meet, Teams o el fijo).' },
};

const APPROVAL_HOURS = [2, 4, 8, 12, 24, 48, 72, 168];

function approvalHoursLabel(h: number): string {
    if (h < 24) return sprintf(__('%d horas'), h);
    const d = h / 24;
    return d === 1 ? __('1 día') : d === 7 ? __('1 semana') : sprintf(__('%d días'), d);
}

/**
 * v0.1.353 — Aprobación de citas y seguridad de la página: si alguien del
 * equipo aprueba cada cita (o sólo la primera de cada cliente), quién, en
 * cuánto tiempo y qué pasa si nadie decide; y el código por correo y los
 * correos temporales.
 */
function ApprovalEditor({ config, onChange, options }: SectionEditorProps): JSX.Element {
    const a = config.approval;
    const s = config.settings;
    const setA = (patch: Partial<BookingConfig['approval']>): void => onChange({ ...config, approval: { ...a, ...patch } });
    const setS = (patch: Partial<BookingConfig['settings']>): void => onChange({ ...config, settings: { ...s, ...patch } });
    const perService = config.services.filter((x) => x.active && x.approval !== 'inherit');
    const on = a.mode !== 'none' || perService.some((x) => x.approval !== 'none');
    const chosen = new Set(a.approver_user_ids);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-tour="booking-approval">
            <Section title={__('Aprobación de las citas')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" role="radiogroup" aria-label={__('Aprobación de las citas')} data-testid="booking-approval-mode">
                    {BOOKING_APPROVAL_MODES.map((m) => (
                        <label
                            key={m}
                            className={cn(
                                'imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-px-3 imcrm-py-2',
                                a.mode === m ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent/50',
                            )}
                        >
                            <input type="radio" name="booking-approval-mode" className="imcrm-mt-0.5" checked={a.mode === m} onChange={() => setA({ mode: m })} value={m} />
                            <span className="imcrm-flex imcrm-flex-col">
                                <span className="imcrm-text-sm imcrm-font-medium">{__(BOOKING_APPROVAL_MODE_LABELS[m])}</span>
                                <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                                    {m === 'none'
                                        ? __('Cada reserva queda confirmada al instante.')
                                        : m === 'all'
                                          ? __('Cada reserva queda «Por confirmar» hasta que alguien la apruebe. Mientras tanto, el horario queda apartado.')
                                          : __('La primera cita de cada correo espera la aprobación; las siguientes se confirman solas.')}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
                {perService.length > 0 && (
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="booking-approval-per-service">
                        {sprintf(__('Con su propia regla: %s.'), perService.map((x) => `${x.name} (${__(BOOKING_APPROVAL_MODE_LABELS[x.approval as 'none'])})`).join(', '))}
                    </p>
                )}
            </Section>
            {on && (
                <Section title={__('Quién aprueba')}>
                    <Check label={__('Quien atiende la cita puede aprobarla')} checked={a.staff_approves} onChange={(v) => setA({ staff_approves: v })} testId="booking-approval-staff" />
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="booking-approvers">
                        <span className="imcrm-text-xs imcrm-font-medium">{__('Y también estas personas')}</span>
                        {options.members.length === 0 && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('No hay personas del equipo que puedan trabajar esta lista.')}</span>}
                        <div className="imcrm-flex imcrm-max-h-48 imcrm-flex-col imcrm-gap-0.5 imcrm-overflow-y-auto">
                            {options.members.map((m) => (
                                <Check
                                    key={m.id}
                                    label={m.name.trim() || m.email}
                                    checked={chosen.has(m.id)}
                                    onChange={(v) => setA({ approver_user_ids: v ? [...a.approver_user_ids, m.id] : a.approver_user_ids.filter((x) => x !== m.id) })}
                                    testId={`booking-approver-${m.id}`}
                                />
                            ))}
                        </div>
                    </div>
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Quien administra la lista siempre puede aprobar. Les llega un aviso con cada cita por confirmar, y la aprueban o rechazan desde la ficha del registro.')}
                    </p>
                </Section>
            )}
            {on && (
                <Section title={__('Plazo para decidir')}>
                    <Field label={__('Hay que decidir antes de')} hint={__('Nunca pasa del inicio de la cita.')}>
                        <Select value={a.hours} onChange={(e) => setA({ hours: Number(e.target.value) })} data-testid="booking-approval-hours">
                            {(APPROVAL_HOURS.includes(a.hours) ? APPROVAL_HOURS : [...APPROVAL_HOURS, a.hours].sort((x, y) => x - y)).map((h) => (
                                <option key={h} value={h}>
                                    {approvalHoursLabel(h)}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <Segmented
                        label={__('Si nadie decide a tiempo')}
                        value={a.on_timeout}
                        options={[
                            { value: 'decline', label: __('Se rechaza') },
                            { value: 'approve', label: __('Se confirma') },
                        ]}
                        onChange={(v) => setA({ on_timeout: v as 'decline' | 'approve' })}
                    />
                    <Field label={__('Lo que ve el cliente al pedirla')}>
                        <Textarea rows={2} value={s.pending_message} onChange={(e) => setS({ pending_message: e.target.value })} data-testid="booking-pending-message" />
                    </Field>
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Le llega un correo «Recibimos tu solicitud», y otro cuando se confirma o se rechaza (con el motivo, si lo escriben). La cita llega al calendario de quien atiende sólo cuando se aprueba.')}
                    </p>
                </Section>
            )}
            <Section title={__('Seguridad de la página')}>
                <Check
                    label={__('Pedir que confirme su correo con un código')}
                    checked={s.verify_email}
                    onChange={(v) => setS({ verify_email: v })}
                    testId="booking-verify-email"
                />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Antes de agendar le llega un código de 6 números a su correo. Así nadie reserva con el correo de otra persona. Recomendado si las citas se aprueban «sólo la primera vez».')}
                </p>
                <Check
                    label={__('No aceptar correos temporales')}
                    checked={s.block_disposable_email}
                    onChange={(v) => setS({ block_disposable_email: v })}
                    testId="booking-block-disposable"
                />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Rechaza los correos que duran unos minutos (mailinator, yopmail y otros), que suelen usarse para reservas falsas.')}
                </p>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Siempre activo: un mismo correo no puede pedir más de 5 citas por hora, y el enlace de cada cita deja de servir para hacer cambios cuando llega uno nuevo.')}
                </p>
            </Section>
        </div>
    );
}

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
                    {(['confirmed', 'rescheduled', 'cancelled', ...(config.approval.mode !== 'none' || config.services.some((x) => x.approval === 'all' || x.approval === 'new_clients') ? (['pending', 'declined'] as const) : [])] as BookingStatus[]).map((st) => {
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
            <EmbedCodePicker
                target={{ url: bookingPublicUrl(page), origin: bookingPublicOrigin(page), title: s.title.trim() || page.name, kind: 'booking' }}
                accent={resolvedAccent(s, '#0e7490', BOOKING_CLASSIC_THEME)}
                testId="booking-embed-inline"
                bare={{
                    value: effectiveTheme(s, BOOKING_CLASSIC_THEME).layout.embed_style === 'bare',
                    onChange: (v) => onChange(patchThemeSection(config, 'layout', { embed_style: v ? 'bare' : 'card' }, BOOKING_CLASSIC_THEME)),
                    unsaved:
                        effectiveTheme(s, BOOKING_CLASSIC_THEME).layout.embed_style !==
                        effectiveTheme(page.config.settings, BOOKING_CLASSIC_THEME).layout.embed_style,
                }}
            />
            <PublicQrCard url={bookingPublicUrl(page)} name={s.title.trim() || page.name} kind="booking" />
            <Button variant="ghost" size="sm" className="imcrm-gap-1.5 imcrm-self-start" onClick={onRegenerate} disabled={busy} data-testid="booking-regenerate">
                <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Cambiar la dirección')}
            </Button>
            <Section title={__('Textos de la página')}>
                <Field label={__('Título')}>
                    <Input value={s.title} onChange={(e) => setS({ title: e.target.value })} placeholder={page.name} data-testid="booking-title" />
                </Field>
                <Field label={__('Descripción')}>
                    <Textarea rows={3} value={s.description} onChange={(e) => setS({ description: e.target.value })} />
                </Field>
                <Field label={__('Dónde es la cita')} hint={__('Una dirección, «Videollamada»… Va en la página, el correo y el archivo del calendario.')}>
                    <Input value={s.location} onChange={(e) => setS({ location: e.target.value })} data-testid="booking-location" />
                </Field>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Los colores, el logo, la tipografía y qué se muestra están en «Diseño».')}
                </p>
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

function clampInt(raw: string, min: number, max: number): number {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

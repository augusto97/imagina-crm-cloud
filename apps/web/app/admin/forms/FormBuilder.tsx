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
    Grid3x3,
    Heading2,
    Image as ImageIcon,
    Link2,
    Loader2,
    MailCheck,
    Monitor,
    Moon,
    Palette,
    Plus,
    BarChart3,
    Redo2,
    Scale,
    SeparatorHorizontal,
    ShieldCheck,
    Smartphone,
    Sun,
    Trash2,
    Type,
    Undo2,
    X,
} from 'lucide-react';
import {
    buildPublicFormItems,
    buildPublicThemeCss,
    CAPTCHA_PROVIDER_INFO,
    formEstimateMinutes,
    formRecallMap,
    FORM_FILE_ACCEPT_INFO,
    FORM_FILE_ACCEPTS,
    type CaptchaAvailability,
    type FormDataConsentAvailability,
    type FormFileAccept,
    type FormConfig,
    type FormShowIf,
    type FormDto,
    type FormItem,
    type PublicChoiceStyle,
    type PublicFormMeta,
    type PublicThemePreset,
    type SavedPublicTheme,
    publicThemeView,
    resolvePublicPalettes,
} from '@imagina-base/shared';

import { ThemeToggle } from '@/components/ThemeToggle';
import { FormStatsSheet } from './FormStatsSheet';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/cloud/session';
import { useBrandingData } from '@/hooks/useBranding';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useRecordTemplates } from '@/hooks/useRecordTemplates';
import { useTeams } from '@/hooks/useTeams';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __ } from '@/lib/i18n';
import { getTenantFormat } from '@/lib/tenantFormat';
import { getThemeState } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section } from '../automations/email/EmailBlockInspector';
import { FieldItemDesign, ImageItemEditor } from './design/ItemDesign';
import { ConditionEditor } from './design/ConditionEditor';
import { LogicMap, LogicPanel, RecallPicker, withToken } from './design/LogicPanel';
import { MatrixEditor } from './design/QuestionKind';
import { MyThemes } from './design/MyThemes';
import { StartSettings } from './design/StartSettings';
import { ThemeGallery } from './design/ThemeGallery';
import { ThemeInspector } from './design/ThemeInspector';
import {
    activePresetId,
    applyTheme,
    effectiveTheme,
    fallbackAccent,
    formImageIds,
    normalizeForSave,
    resolvedAccent,
    startTheme,
} from './design/themeOps';
import { themeErrorMessage, useAttachmentUrls } from './design/useFormThemes';
import {
    addContentItem,
    addMatrixItem,
    defaultMatrixColumns,
    usedFieldIds,
    addFieldItem,
    availableFields,
    conditionCandidates,
    emailQuestions,
    endingName,
    logicCount,
    missingRequired,
    moveItem,
    moveItemTo,
    pageCount,
    pageNumbers,
    questionCount,
    readFormConfig,
    removeItem,
    updateItem,
    updateSettings,
    type FormContentType,
} from './formDesignOps';
import { EmbedCodePicker } from './EmbedCodePicker';
import { PublicQrCard } from './PublicQrCard';
import { formPublicOrigin, formPublicUrl, useCaptchaAvailability,
    useDataConsentAvailability, useUpdateForm } from './useForms';

/**
 * v0.1.275 — Constructor de formularios a pantalla completa (ADR-S39).
 *
 * El centro es la PÁGINA REAL que ve el visitante (la sirve el API en modo
 * vista previa y recibe el diseño por postMessage): lo que se ve al diseñar
 * es lo que se publica, sin una segunda implementación que se desfase.
 */

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
    const captcha = useCaptchaAvailability(listId);
    const dataConsent = useDataConsentAvailability(listId);
    const narrow = useMediaQuery('(max-width: 1023px)');
    // v0.1.351 — el CSS propio lo escribe sólo un administrador (el rol, no la capacidad).
    const isAdmin = useSession((st) => st.memberships.find((m) => m.tenant_id === st.activeTenantId)?.role === 'admin');

    // v0.1.351 — con los valores por defecto de la versión (ancho, imágenes de opciones, tema…).
    const [draft, setDraft] = useState<Draft>(() => ({ name: form.name, config: readFormConfig(form.config) }));
    const [saved, setSaved] = useState<Draft>(() => ({ name: form.name, config: readFormConfig(form.config) }));
    const [enabled, setEnabled] = useState(form.enabled);
    const [history, setHistory] = useState<History>({ past: [], future: [] });
    const [selected, setSelected] = useState<string | null>(null);
    const [leftTab, setLeftTab] = useState<LeftTab>('add');
    const [mobileTab, setMobileTab] = useState<'build' | 'design' | 'preview' | 'settings'>('preview');
    const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
    // Con el modo «según el dispositivo», qué ver en la vista previa (arranca como la app).
    const [previewScheme, setPreviewScheme] = useState<'light' | 'dark'>(() => getThemeState().resolved);
    const [shareOpen, setShareOpen] = useState(false);
    // v0.1.358 — las estadísticas del formulario.
    const [statsOpen, setStatsOpen] = useState(false);
    // v0.1.356 — la pantalla final que se mira en la vista previa (null = el formulario; '' = la de siempre).
    const [previewEnding, setPreviewEnding] = useState<string | null>(null);
    /** v0.1.357 — ver la bienvenida en la vista previa. */
    const [previewWelcome, setPreviewWelcome] = useState(false);

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
    // Cuántas veces avisó la vista previa que está lista: en el celular la
    // pestaña «Vista previa» se desmonta y el iframe vuelve a cargar, así que
    // cada aviso tiene que volver a mandarle lo que se está editando.
    const [ready, setReady] = useState(0);
    // C1 — las preguntas «Equipo» se eligen entre los equipos de la empresa.
    const teams = useTeams(fields.some((f) => f.type === 'team'));
    const teamOptions = useMemo(
        () => [...(teams.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((t) => ({ value: String(t.id), label: t.name })),
        [teams.data],
    );
    // ── Diseño (ADR-S94): el tema, sus imágenes y el CSS que recibe la vista previa ──
    const brandColor = branding.data?.primary_color ?? '#0e7490';
    const theme = useMemo(() => effectiveTheme(config.settings), [config.settings]);
    const imageIds = useMemo(() => formImageIds(config), [config]);
    const imageUrls = useAttachmentUrls(imageIds);
    const imageUrl = useCallback((id: number): string | null => imageUrls.get(id) ?? null, [imageUrls]);
    const themeCss = useMemo(() => {
        const img = (id: number | null): string | null => (id === null ? null : imageUrl(id));
        return buildPublicThemeCss(theme, {
            accent: fallbackAccent(config.settings, brandColor),
            images: {
                cover: img(theme.cover.file_id),
                split: img(theme.split.file_id),
                background: theme.background.kind === 'image' ? img(theme.background.file_id) : null,
            },
        });
    }, [theme, config.settings, brandColor, imageUrl]);
    const scheme = theme.mode === 'auto' ? previewScheme : null;
    const previewBg = useMemo(() => {
        const pals = resolvePublicPalettes(theme, fallbackAccent(config.settings, brandColor));
        return (scheme === 'dark' && pals.dark ? pals.dark : pals.main).background;
    }, [theme, config.settings, brandColor, scheme]);

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
            accent_color: resolvedAccent(s, b?.primary_color),
            logo_url: s.show_logo ? (b?.logo_url ?? null) : null,
            company: b?.app_name ?? '',
            number_format: getTenantFormat().number_format,
            items: buildPublicFormItems(config, fields, teamOptions, { imageUrl }),
            closed: null,
            stamp: '',
            max_upload_bytes: 20 * 1024 * 1024,
            // La vista previa no carga el widget: muestra dónde va.
            captcha: s.captcha && captcha.data?.provider ? { provider: captcha.data.provider, site_key: '' } : null,
            confirm_email: s.confirm_email,
            // Ley 1581 — la casilla de autorización con el texto vigente de la empresa.
            data_consent: s.data_consent && dataConsent.data?.active ? dataConsent.data.consent : null,
            theme: publicThemeView(theme),
            // v0.1.356 — saltos, pantallas finales y las respuestas que se recuerdan.
            jumps: s.jumps.map((j) => ({ from: j.from, when: j.when, to: j.to })),
            endings: s.endings.map((e) => ({ id: e.id, title: e.title, message: e.message, redirect_url: e.redirect_url, when: e.when })),
            recall: formRecallMap(config, fields),
            // v0.1.357 — cómo se responde, la bienvenida y los cálculos (aquí con todo lo que suma cada respuesta).
            layout: s.layout,
            welcome: s.welcome.enabled
                ? {
                      title: s.welcome.title,
                      message: s.welcome.message,
                      button_label: s.welcome.button_label || 'Empezar',
                      image_url: s.welcome.file_id !== null ? imageUrl(s.welcome.file_id) : null,
                      minutes: s.welcome.show_time ? formEstimateMinutes(config) : null,
                  }
                : null,
            calcs: s.calcs.map((c) => ({
                key: c.key,
                name: c.name,
                start: c.start,
                parts: c.parts.map((p) => ({ key: String(p.field_id), points: p.points, multiplier: p.multiplier })),
            })),
            // v0.1.358 — para que la vista previa muestre «Guardar y seguir después».
            save_progress: s.save_progress.device || s.save_progress.email ? { ...s.save_progress } : null,
            edit_links: s.edit_links.enabled ? { message: s.edit_links.message } : null,
        };
    }, [config, draft.name, fields, branding.data, captcha.data?.provider, dataConsent.data, teamOptions, imageUrl, theme]);

    useEffect(() => {
        const onMessage = (e: MessageEvent): void => {
            if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow) return;
            const data = e.data as { type?: string; id?: string } | null;
            if (data?.type === 'imb-form-ready') setReady((n) => n + 1);
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
        iframeRef.current?.contentWindow?.postMessage(
            { type: 'imb-form-preview', meta, selected, css: themeCss, scheme, ending: previewEnding ?? undefined, welcome: previewWelcome && config.settings.welcome.enabled },
            window.location.origin,
        );
    }, [ready, meta, selected, themeCss, scheme, previewEnding, previewWelcome, config.settings.welcome.enabled]);
    // Elegir una pregunta vuelve al formulario (la bienvenida tapa las preguntas).
    useEffect(() => {
        if (selected) setPreviewWelcome(false);
    }, [selected]);
    // Al salir de «Lógica» la vista previa vuelve al formulario.
    useEffect(() => {
        if (leftTab !== 'logic') setPreviewEnding(null);
    }, [leftTab]);

    const save = async (extra: { enabled?: boolean } = {}): Promise<boolean> => {
        // v0.1.356 — una pantalla final con la dirección a medio escribir se perdería al guardar.
        const badEnding = draft.config.settings.endings.findIndex((e) => !!e.redirect_url && !/^https:\/\/\S+$/.test(e.redirect_url));
        if (badEnding >= 0) {
            const e = draft.config.settings.endings[badEnding]!;
            toast.error(
                __('Revisa la pantalla final «%s»').replace('%s', endingName(e, badEnding)),
                __('Su dirección tiene que empezar con https://, o déjala vacía para mostrar el mensaje.'),
            );
            setSelected(null);
            if (narrow) setMobileTab('build');
            setLeftTab('logic');
            return false;
        }
        try {
            const doc = await update.mutateAsync({
                id: form.id,
                body: { name: draft.name.trim() || form.name, config: normalizeForSave(draft.config), ...extra },
            });
            const next = { name: doc.name, config: readFormConfig(doc.config) };
            setDraft(next);
            setSaved(next);
            setEnabled(doc.enabled);
            return true;
        } catch (err) {
            toast.error(__('No se pudo guardar'), themeErrorMessage(err));
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
    const addContent = (type: FormContentType): void => {
        const { config: next, id } = addContentItem(config, type, selected);
        change(next);
        setSelected(id);
    };
    // v0.1.355 — una matriz arranca con las selecciones sin usar que comparten opciones con la primera.
    const addMatrix = (): void => {
        const used = usedFieldIds(config);
        const free = fields.filter((f) => !used.has(f.id) && ['select', 'rating'].includes(f.type));
        const first = free[0];
        const sameOptions = (a: typeof first, b: typeof first): boolean =>
            JSON.stringify(defaultMatrixColumns(a).map((c) => c.value)) === JSON.stringify(defaultMatrixColumns(b).map((c) => c.value));
        const rows = first ? free.filter((f) => f.type === first.type && sameOptions(f, first)).slice(0, 4) : [];
        const { config: next, id } = addMatrixItem(config, rows.map((f) => f.id), defaultMatrixColumns(first), selected);
        change(next);
        setSelected(id);
        // En el celular, directo a sus ajustes: una matriz hay que armarla.
        if (narrow) setMobileTab('settings');
    };

    const applyPreset = (p: PublicThemePreset): void => {
        change(applyTheme(config, p.theme, { keepCustomCss: !isAdmin, carryImages: true }));
    };
    const applySaved = (t: SavedPublicTheme): void => {
        change(applyTheme(config, t.theme, { keepCustomCss: !isAdmin }));
        toast.success(__('Tema aplicado'), __('«%s». Si no te convence, deshazlo.').replace('%s', t.name));
    };
    const openDesign = (): void => {
        setSelected(null);
        if (narrow) setMobileTab('design');
        else setLeftTab('design');
    };
    const designLibrary = (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5">
            <ThemeGallery brand={brandColor} activeId={activePresetId(config.settings)} onApply={applyPreset} columns={narrow ? 3 : 2} />
            <MyThemes
                brand={brandColor}
                current={startTheme(config.settings)}
                suggestedName={(config.settings.title || draft.name).slice(0, 60)}
                onApply={applySaved}
            />
        </div>
    );
    const themeInspector = (
        <ThemeInspector config={config} onChange={change} brand={brandColor} isAdmin={isAdmin} showLogo={config.settings.show_logo} />
    );

    const openSettings = (): void => {
        setSelected(null);
        setPreviewEnding(null);
        if (narrow) setMobileTab('settings');
        else setLeftTab('structure');
    };
    const logicPanel = (
        <LogicPanel
            config={config}
            fields={fields}
            fieldsById={fieldsById}
            onChange={change}
            previewEnding={previewEnding}
            onPreviewEnding={(id) => {
                setPreviewEnding(id);
                // En el celular la vista previa es otra pestaña: ir a mirarla.
                if (narrow && id !== null) setMobileTab('preview');
            }}
            onOpenSettings={openSettings}
        />
    );

    const left = (
        <LeftPanel
            tab={leftTab}
            onTab={(t) => {
                setLeftTab(t);
                // Elegir «Diseño» o «Lógica» muestra sus ajustes a la derecha.
                if (t === 'design' || t === 'logic') setSelected(null);
            }}
            showDesignTab={!narrow}
            designContent={designLibrary}
            // En el celular la lógica se edita ahí mismo; en la computadora, a la derecha.
            logicContent={narrow ? logicPanel : <LogicMap config={config} fieldsById={fieldsById} />}
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
            onAddMatrix={addMatrix}
            onChange={change}
        />
    );
    const right = selectedItem ? (
        <ItemInspector
            key={selectedItem.id}
            item={selectedItem}
            config={config}
            fieldsById={fieldsById}
            fields={fields}
            listId={listId}
            themeChoiceStyle={theme.choices.style}
            onChange={change}
            onClose={() => setSelected(null)}
        />
    ) : leftTab === 'design' && !narrow ? (
        themeInspector
    ) : leftTab === 'logic' && !narrow ? (
        logicPanel
    ) : (
        <SettingsInspector
            draft={draft}
            setName={(name) => setDraft((d) => ({ ...d, name }))}
            config={config}
            onChange={change}
            missing={missing}
            fields={fields}
            captcha={captcha.data ?? null}
            dataConsent={dataConsent.data ?? null}
            listId={listId}
            formId={form.id}
            onOpenDesign={openDesign}
            previewWelcome={previewWelcome}
            onPreviewWelcome={setPreviewWelcome}
        />
    );
    const preview = (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-bg-canvas">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-1.5">
                <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Vista previa — toca una pregunta para editarla')}
                </span>
                <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5">
                    {theme.mode === 'auto' && (
                        <div
                            role="group"
                            aria-label={__('Ver en modo claro u oscuro')}
                            className="imcrm-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-0.5"
                            data-testid="form-preview-scheme"
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
            </div>
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-justify-center imcrm-overflow-hidden imcrm-p-3">
                <iframe
                    ref={iframeRef}
                    src="/api/v1/public/f/preview"
                    title={__('Vista previa del formulario')}
                    className={cn(
                        'imcrm-h-full imcrm-rounded-lg imcrm-border imcrm-border-border',
                        device === 'mobile' ? 'imcrm-w-[375px]' : 'imcrm-w-full imcrm-max-w-[760px]',
                    )}
                    // La miniatura toma el fondo del diseño (no un blanco que parpadea al cargar).
                    style={{ background: previewBg }}
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
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={__('Estadísticas')}
                        title={__('Estadísticas')}
                        onClick={() => setStatsOpen(true)}
                        data-testid="form-stats-open"
                        data-tour="form-stats"
                    >
                        <BarChart3 className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                    <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setShareOpen((o) => !o)} data-testid="form-share">
                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        <span className="imcrm-hidden sm:imcrm-inline">{__('Compartir')}</span>
                    </Button>
                    <Button size="sm" disabled={!dirty || update.isPending} onClick={() => void save().then((ok) => ok && toast.success(__('Formulario guardado')))} data-testid="form-save">
                        {update.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : __('Guardar')}
                    </Button>
                </div>
            </header>
            {statsOpen && <FormStatsSheet open onOpenChange={setStatsOpen} listId={listId} form={form} fields={fields} />}
            {shareOpen && (
                <SharePanel form={form} enabled={enabled} accent={resolvedAccent(config.settings, brandColor)} onClose={() => setShareOpen(false)} onPublish={() => void togglePublish()} />
            )}

            {narrow ? (
                <>
                    <div role="tablist" className="imcrm-flex imcrm-border-b imcrm-border-border">
                        {(
                            [
                                ['build', __('Preguntas')],
                                ['design', __('Diseño')],
                                ['preview', __('Vista previa')],
                                ['settings', selectedItem ? __('Editar') : __('Ajustes')],
                            ] as const
                        ).map(([key, label]) => (
                            <button
                                key={key}
                                role="tab"
                                type="button"
                                aria-selected={mobileTab === key}
                                data-tour={designTabTour(key)}
                                onClick={() => {
                                    setMobileTab(key);
                                    if (key === 'design') setSelected(null);
                                }}
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
                        {mobileTab === 'design' && (
                            <div className="imcrm-flex imcrm-flex-col" data-testid="form-design-mobile">
                                <div className="imcrm-border-b imcrm-border-border imcrm-p-3">{designLibrary}</div>
                                {themeInspector}
                            </div>
                        )}
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

function SharePanel({ form, enabled, accent, onClose, onPublish }: { form: FormDto; enabled: boolean; accent: string; onClose: () => void; onPublish: () => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-max-h-[65dvh] imcrm-shrink-0 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto imcrm-border-b imcrm-border-border imcrm-bg-muted/40 imcrm-px-4 imcrm-py-3" data-testid="form-share-panel">
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
            <CopyRow label={__('Enlace')} value={formPublicUrl(form)} testId="form-link" />
            <EmbedCodePicker
                target={{ url: formPublicUrl(form), origin: formPublicOrigin(form), title: form.config.settings.title.trim() || form.name, kind: 'form' }}
                accent={accent}
                testId="form-embed"
                dataTour="form-embed-mode"
            />
            <PublicQrCard url={formPublicUrl(form)} name={form.config.settings.title.trim() || form.name} kind="form" />
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

type LeftTab = 'add' | 'structure' | 'design' | 'logic';

/** Ancla del recorrido para la pestaña «Diseño» (escritorio y celular). */
const DESIGN_TAB = { dataTour: 'form-design-tab' } as const;
function designTabTour(tab: string): string | undefined {
    return tab === 'design' ? DESIGN_TAB.dataTour : undefined;
}

interface LeftPanelProps {
    tab: LeftTab;
    onTab: (t: LeftTab) => void;
    /** En el celular el diseño tiene su propia pestaña arriba. */
    showDesignTab: boolean;
    /** Plantillas y «Mis temas». */
    designContent: React.ReactNode;
    /** v0.1.356 — el mapa de la lógica (computadora) o su editor (celular). */
    logicContent: React.ReactNode;
    config: FormConfig;
    fields: FieldEntity[];
    fieldsById: Map<number, FieldEntity>;
    selected: string | null;
    onSelect: (id: string) => void;
    onAddField: (fieldId: number) => void;
    onAddContent: (type: FormContentType) => void;
    /** v0.1.355 */
    onAddMatrix: () => void;
    onChange: (next: FormConfig) => void;
}

function itemTitle(item: FormItem, fieldsById: Map<number, FieldEntity>): string {
    if (item.type === 'heading') return item.text || __('Título de sección');
    if (item.type === 'text') return item.text.split('\n')[0] || __('Texto');
    if (item.type === 'page_break') return item.title || __('Salto de página');
    if (item.type === 'image') return item.caption.trim() || item.alt.trim() || __('Imagen');
    if (item.type === 'matrix') return item.label.trim() || __('Matriz');
    return item.label.trim() || fieldsById.get(item.field_id)?.label || __('Campo borrado');
}

function LeftPanel(p: LeftPanelProps): JSX.Element {
    const available = availableFields(p.fields, p.config);
    const [dragId, setDragId] = useState<string | null>(null);
    const [dropAt, setDropAt] = useState<number | null>(null);
    const pageOf = pageNumbers(p.config);
    const multiPage = pageCount(p.config) > 1;
    const rules = logicCount(p.config);
    return (
        <div className="imcrm-flex imcrm-flex-col">
            <div role="tablist" className="imcrm-flex imcrm-gap-0.5 imcrm-border-b imcrm-border-border imcrm-px-1 imcrm-pt-2">
                {(
                    [
                        ['add', __('Agregar')],
                        ['structure', __('Preguntas')],
                        ...(p.showDesignTab ? ([['design', __('Diseño')]] as const) : []),
                        ['logic', __('Lógica')],
                    ] as ReadonlyArray<readonly [LeftTab, string]>
                ).map(([key, label]) => (
                    <button
                        key={key}
                        role="tab"
                        type="button"
                        aria-selected={p.tab === key}
                        data-tour={designTabTour(key)}
                        data-testid={key === 'design' ? 'form-design-tab' : key === 'logic' ? 'form-logic-tab' : undefined}
                        // La cantidad de saltos y pantallas finales va en un punto (no entra en el ancho).
                        aria-label={
                            key === 'structure' ? `${label} (${p.config.items.length})` : key === 'logic' && rules > 0 ? `${label} (${rules})` : undefined
                        }
                        title={key === 'logic' && rules > 0 ? __('%s saltos y pantallas finales').replace('%s', String(rules)) : undefined}
                        data-count={key === 'logic' ? rules : undefined}
                        onClick={() => p.onTab(key)}
                        className={cn(
                            '-imcrm-mb-px imcrm-whitespace-nowrap imcrm-border-b-2 imcrm-px-1.5 imcrm-pb-2 imcrm-text-xs',
                            p.tab === key ? 'imcrm-border-primary imcrm-font-medium imcrm-text-foreground' : 'imcrm-border-transparent imcrm-text-muted-foreground',
                        )}
                    >
                        {label}
                        {key === 'structure' && (
                            <span className="imcrm-ml-1 imcrm-text-[10px] imcrm-tabular-nums imcrm-text-muted-foreground" aria-hidden="true">
                                {p.config.items.length}
                            </span>
                        )}
                        {key === 'logic' && rules > 0 && (
                            <span className="imcrm-ml-1 imcrm-inline-block imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-primary imcrm-align-middle" aria-hidden="true" />
                        )}
                    </button>
                ))}
            </div>

            {p.tab === 'logic' ? (
                p.logicContent
            ) : p.tab === 'design' && p.showDesignTab ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-p-3">
                    <button
                        type="button"
                        className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-left imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground"
                        onClick={() => p.onTab('design')}
                    >
                        <Palette className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                        {__('Los colores, fuentes, tamaños y bordes se ajustan a la derecha.')}
                    </button>
                    {p.designContent}
                </div>
            ) : p.tab === 'add' || (p.tab === 'design' && !p.showDesignTab) ? (
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
                        <button
                            type="button"
                            onClick={() => p.onAddContent('page_break')}
                            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-sm hover:imcrm-bg-accent"
                            data-testid="form-add-page-break"
                        >
                            <SeparatorHorizontal className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                            {__('Salto de página')}
                        </button>
                        <button
                            type="button"
                            onClick={() => p.onAddContent('image')}
                            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-sm hover:imcrm-bg-accent"
                            data-testid="form-add-image"
                        >
                            <ImageIcon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                            {__('Imagen')}
                        </button>
                        <button
                            type="button"
                            onClick={() => p.onAddMatrix()}
                            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                            data-testid="form-add-matrix"
                        >
                            <Grid3x3 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                            <span className="imcrm-min-w-0 imcrm-flex-1">{__('Matriz')}</span>
                            <span className="imcrm-text-[10px] imcrm-text-muted-foreground">{__('varias preguntas en una tabla')}</span>
                        </button>
                        <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Con saltos de página el formulario se responde por pasos, con una barra de progreso.')}
                        </p>
                    </div>
                </div>
            ) : (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-p-2" data-testid="form-structure">
                    {p.config.items.length === 0 && (
                        <li className="imcrm-px-2 imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Todavía no hay preguntas. Agrégalas desde la pestaña «Agregar».')}
                        </li>
                    )}
                    {multiPage && p.config.items[0]?.type !== 'page_break' && (
                        <li className="imcrm-px-1.5 imcrm-pb-0.5 imcrm-pt-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__('Página')} 1
                        </li>
                    )}
                    {p.config.items.map((item, idx) => {
                        const Icon =
                            item.type === 'heading'
                                ? Heading2
                                : item.type === 'text'
                                  ? Type
                                  : item.type === 'page_break'
                                    ? SeparatorHorizontal
                                    : item.type === 'image'
                                      ? ImageIcon
                                      : item.type === 'matrix'
                                        ? Grid3x3
                                        : fieldTypeIcon(p.fieldsById.get(item.field_id)?.type ?? 'text');
                        const isBreak = item.type === 'page_break';
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
                                    isBreak && 'imcrm-mt-2 imcrm-border-dashed imcrm-border-t-border imcrm-bg-muted/40',
                                    p.selected === item.id ? 'imcrm-border-primary/40 imcrm-bg-primary/5' : 'hover:imcrm-bg-accent',
                                    dropAt === idx && 'imcrm-border-t-primary',
                                    dropAt === idx + 1 && idx === p.config.items.length - 1 && 'imcrm-border-b-primary',
                                )}
                                data-structure-item={item.id}
                            >
                                <GripVertical className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-cursor-grab imcrm-text-muted-foreground" />
                                <button type="button" className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-1.5 imcrm-text-left" onClick={() => p.onSelect(item.id)}>
                                    <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                    {isBreak && (
                                        <span className="imcrm-shrink-0 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                            {__('Página')} {pageOf.get(item.id) ?? 1}
                                        </span>
                                    )}
                                    <span className={cn('imcrm-truncate', item.type === 'heading' && 'imcrm-font-medium', isBreak && 'imcrm-text-muted-foreground')}>
                                        {isBreak ? (item.title ? `· ${item.title}` : '') : itemTitle(item, p.fieldsById)}
                                    </span>
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
    fields,
    listId,
    themeChoiceStyle,
    onChange,
    onClose,
}: {
    item: FormItem;
    config: FormConfig;
    fieldsById: Map<number, FieldEntity>;
    /** v0.1.355 — los campos de la lista (matriz y «Otro»). */
    fields: FieldEntity[];
    listId: number;
    /** v0.1.351 — estilo de las opciones del diseño del formulario. */
    themeChoiceStyle: PublicChoiceStyle;
    onChange: (next: FormConfig) => void;
    onClose: () => void;
}): JSX.Element {
    const set = (patch: Partial<FormItem>): void => onChange(updateItem(config, item.id, patch));
    const field = item.type === 'field' ? fieldsById.get(item.field_id) : undefined;
    const title =
        item.type === 'heading'
            ? __('Título de sección')
            : item.type === 'text'
              ? __('Texto')
              : item.type === 'page_break'
                ? __('Salto de página')
                : item.type === 'image'
                  ? __('Imagen')
                  : item.type === 'matrix'
                    ? __('Matriz')
                    : (field?.label ?? __('Pregunta'));

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
                    <RecallPicker config={config} fields={fields} onPick={(t) => set({ text: withToken(item.text, t) })} />
                </Field>
            )}
            {item.type === 'text' && (
                <Field label={__('Texto')} hint={__('Una línea en blanco separa párrafos.')}>
                    <Textarea rows={5} value={item.text} onChange={(e) => set({ text: e.target.value })} />
                    <RecallPicker config={config} fields={fields} onPick={(t) => set({ text: withToken(item.text, t) })} />
                </Field>
            )}
            {item.type === 'page_break' && (
                <>
                    <Field label={__('Título de la página que empieza aquí')} hint={__('Opcional. Ej.: «Datos de la empresa».')}>
                        <Input value={item.title} onChange={(e) => set({ title: e.target.value })} data-testid="form-page-title" />
                        <RecallPicker config={config} fields={fields} onPick={(t) => set({ title: withToken(item.title, t) })} />
                    </Field>
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Quien responde ve un paso por vez con «Anterior» y «Siguiente», y no puede avanzar sin completar las obligatorias de la página. Una página cuyas preguntas están todas escondidas por sus condiciones se salta sola. Para saltar a otra página o terminar antes según lo que responde, usa la pestaña «Lógica».')}
                    </p>
                </>
            )}
            {item.type === 'field' && field && (
                <>
                    <Field label={__('Pregunta')} hint={__('Vacío = el nombre del campo.')}>
                        <Input value={item.label} placeholder={field.label} onChange={(e) => set({ label: e.target.value })} data-testid="form-item-label" />
                        <RecallPicker
                            config={config}
                            fields={fields}
                            exceptFieldId={field.id}
                            onPick={(t) => set({ label: withToken(item.label || field.label, t) })}
                        />
                    </Field>
                    <Field label={__('Ayuda')} hint={__('Aparece debajo de la pregunta.')}>
                        <Textarea rows={2} value={item.help} placeholder={field.description ?? ''} onChange={(e) => set({ help: e.target.value })} />
                        <RecallPicker config={config} fields={fields} exceptFieldId={field.id} onPick={(t) => set({ help: withToken(item.help, t) })} />
                    </Field>
                    {(!['checkbox', 'select', 'multi_select', 'team', 'rating', 'file', 'date', 'datetime'].includes(field.type) || item.display === 'search') &&
                        !['scale', 'slider', 'ranking'].includes(item.display) && (
                        <Field label={__('Texto de ejemplo')}>
                            <Input value={item.placeholder} onChange={(e) => set({ placeholder: e.target.value })} />
                        </Field>
                    )}
                    {field.type === 'file' && item.display !== 'signature' && (
                        <Field
                            label={__('Tipos de archivo')}
                            hint={__('Los programas y las páginas web nunca se aceptan. Cada archivo puede pesar hasta 20 MB.')}
                        >
                            <select
                                className="imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                value={item.accept}
                                onChange={(e) => set({ accept: e.target.value as FormFileAccept })}
                                data-testid="form-item-accept"
                            >
                                {FORM_FILE_ACCEPTS.map((a) => (
                                    <option key={a} value={a}>
                                        {__(FORM_FILE_ACCEPT_INFO[a].label)}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    )}
                    <Section title={__('Respuesta')}>
                        {config.settings.confirm_email && config.settings.respondent_email_field_id === field.id ? (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Obligatoria y siempre visible: es el correo al que se manda la confirmación de cada respuesta.')}
                            </p>
                        ) : field.is_required ? (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Obligatoria: la lista exige este campo.')}</p>
                        ) : (
                            <Check label={__('Obligatoria')} checked={item.required} onChange={(v) => set({ required: v })} />
                        )}
                        {!(config.settings.confirm_email && config.settings.respondent_email_field_id === field.id) && (
                            <Check label={__('Oculta: se completa desde la dirección')} checked={item.hidden} onChange={(v) => set({ hidden: v })} />
                        )}
                        {item.hidden && (
                            <p className="imcrm-break-all imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-[11px]">
                                …/f/xxxx?{field.slug}=valor
                            </p>
                        )}
                    </Section>
                    {!item.hidden && (
                        <FieldItemDesign
                            item={item}
                            field={field}
                            themeChoiceStyle={themeChoiceStyle}
                            config={config}
                            fields={fields}
                            listId={listId}
                            onSet={(patch) => onChange(updateItem(config, item.id, patch))}
                        />
                    )}
                </>
            )}
            {item.type === 'image' && <ImageItemEditor item={item} onSet={(patch) => onChange(updateItem(config, item.id, patch))} />}
            {item.type === 'matrix' && (
                <MatrixEditor
                    item={item}
                    config={config}
                    fields={fields}
                    fieldsById={fieldsById}
                    listId={listId}
                    onSet={(patch) => onChange(updateItem(config, item.id, patch))}
                />
            )}

            {item.type !== 'page_break' &&
                !(item.type === 'field' && config.settings.confirm_email && config.settings.respondent_email_field_id === item.field_id) && (
                <ItemCondition item={item} config={config} fieldsById={fieldsById} onSet={(show_if) => set({ show_if })} />
            )}
        </div>
    );
}

function ItemCondition({
    item,
    config,
    fieldsById,
    onSet,
}: {
    item: FormItem;
    config: FormConfig;
    fieldsById: Map<number, FieldEntity>;
    onSet: (c: FormShowIf | null) => void;
}): JSX.Element {
    return (
        <Section title={__('Mostrar sólo si…')}>
            <ConditionEditor
                value={item.show_if}
                onChange={onSet}
                candidates={conditionCandidates(config, item.id)}
                fieldsById={fieldsById}
                emptyHint="Para depender de otra respuesta, esa pregunta tiene que estar antes."
            />
        </Section>
    );
}

function SettingsInspector({
    draft,
    setName,
    config,
    onChange,
    missing,
    fields,
    captcha,
    dataConsent,
    listId,
    formId,
    onOpenDesign,
    previewWelcome,
    onPreviewWelcome,
}: {
    listId: number;
    /** v0.1.360 — para la variable `{{formulario.<id>.enlace}}`. */
    formId: number;
    /** v0.1.351 — lleva a la pestaña «Diseño» (colores, fuentes, tamaños…). */
    onOpenDesign: () => void;
    /** v0.1.357 — ver la bienvenida en la vista previa. */
    previewWelcome: boolean;
    onPreviewWelcome: (on: boolean) => void;
    draft: Draft;
    setName: (name: string) => void;
    config: FormConfig;
    onChange: (next: FormConfig) => void;
    missing: FieldEntity[];
    fields: FieldEntity[];
    captcha: CaptchaAvailability | null;
    dataConsent: FormDataConsentAvailability | null;
}): JSX.Element {
    const s = config.settings;
    const set = (patch: Partial<FormConfig['settings']>): void => onChange(updateSettings(config, patch));
    // C6 — el registro que crea el formulario puede salir de una plantilla.
    const recordTemplates = useRecordTemplates(listId, 'record');
    const emails = emailQuestions(fields, config);
    const emailId = s.respondent_email_field_id !== null && emails.some((f) => f.id === s.respondent_email_field_id) ? s.respondent_email_field_id : null;
    /** Confirmar el correo: la pregunta queda obligatoria, visible y sin condición. */
    const setConfirm = (on: boolean): void => {
        let next = updateSettings(config, { confirm_email: on });
        if (on && emailId !== null) {
            const it = next.items.find((i) => i.type === 'field' && i.field_id === emailId);
            if (it) next = updateItem(next, it.id, { required: true, hidden: false, show_if: null });
        }
        onChange(next);
    };
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

            <StartSettings config={config} fields={fields} onChange={onChange} previewWelcome={previewWelcome} onPreviewWelcome={onPreviewWelcome} formId={formId} />

            <Section title={__('Después de enviar')}>
                <Field label={__('Título del agradecimiento')} hint={__('Para mostrar otro mensaje según lo que responde, agrega una pantalla final en «Lógica».')}>
                    <Input value={s.success_title} onChange={(e) => set({ success_title: e.target.value })} />
                    <RecallPicker config={config} fields={fields} onPick={(t) => set({ success_title: withToken(s.success_title, t) })} />
                </Field>
                <Field label={__('Mensaje')}>
                    <Textarea rows={2} value={s.success_message} onChange={(e) => set({ success_message: e.target.value })} />
                    <RecallPicker config={config} fields={fields} onPick={(t) => set({ success_message: withToken(s.success_message, t) })} />
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

            {((recordTemplates.data ?? []).length > 0 || s.record_template_id !== null) && (
                <Section title={__('Registro que se crea')}>
                    <Field
                        label={__('Desde una plantilla')}
                        hint={__('El registro nace con los valores, las subtareas y los checklists de la plantilla; lo que responde la persona pisa los valores.')}
                    >
                        <Select
                            value={s.record_template_id === null ? '' : String(s.record_template_id)}
                            onChange={(e) => set({ record_template_id: e.target.value === '' ? null : Number(e.target.value) })}
                            data-testid="form-record-template"
                        >
                            <option value="">{__('Sin plantilla')}</option>
                            {(recordTemplates.data ?? []).map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name}
                                </option>
                            ))}
                            {s.record_template_id !== null &&
                                !(recordTemplates.data ?? []).some((t) => t.id === s.record_template_id) &&
                                !recordTemplates.isLoading && <option value={s.record_template_id}>{__('Plantilla eliminada')}</option>}
                        </Select>
                    </Field>
                </Section>
            )}

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

            <Section title={__('Correo de quien responde')}>
                <Field
                    label={__('Pregunta con el correo')}
                    hint={emails.length === 0 ? __('Agrega una pregunta de tipo email para usar estas opciones.') : undefined}
                >
                    <Select
                        value={emailId === null ? '' : String(emailId)}
                        disabled={emails.length === 0}
                        onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            set(v === null ? { respondent_email_field_id: null, confirm_email: false, send_copy: false } : { respondent_email_field_id: v });
                        }}
                        data-testid="form-respondent-email"
                    >
                        <option value="">{__('Ninguna')}</option>
                        {emails.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Check
                    label={__('Confirmar el correo con un clic')}
                    checked={s.confirm_email && emailId !== null}
                    disabled={emailId === null}
                    onChange={setConfirm}
                    testId="form-confirm-email"
                />
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    <MailCheck className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                    {__('La respuesta queda pendiente y le llega a la persona un correo con tu marca para confirmarla. Recién al confirmar se crea el registro, corren las automatizaciones y cuenta para el cupo. Si no confirma en 48 horas, se descarta sola.')}
                </p>
                <Check
                    label={__('Enviarle una copia de sus respuestas')}
                    checked={s.send_copy && emailId !== null}
                    disabled={emailId === null}
                    onChange={(v) => set({ send_copy: v })}
                    testId="form-send-copy"
                />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Los correos salen por el correo de tu empresa y cuentan en su cuota mensual.')}
                </p>
            </Section>

            <Section title={__('Verificación anti-robots')}>
                {captcha?.provider ? (
                    <>
                        <Check label={__('Pedir verificación anti-robots')} checked={s.captcha} onChange={(v) => set({ captcha: v })} testId="form-captcha" />
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            <ShieldCheck className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                            {__('Se usa')} {CAPTCHA_PROVIDER_INFO[captcha.provider].label}{' '}
                            {captcha.source === 'tenant' ? __('con las llaves de tu empresa.') : __('con las llaves de la plataforma.')}{' '}
                            {__('Aparece al final del formulario, antes del botón de enviar.')}
                        </p>
                    </>
                ) : (
                    <>
                        <Check label={__('Pedir verificación anti-robots')} checked={false} disabled onChange={() => undefined} testId="form-captcha" />
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="form-captcha-unavailable">
                            {__('No hay llaves de captcha configuradas.')}{' '}
                            {captcha?.can_configure ? (
                                <a href="/#/settings?s=portal" target="_blank" rel="noreferrer" className="imcrm-text-primary hover:imcrm-underline">
                                    {__('Cárgalas en Ajustes → Portal y formularios')}
                                </a>
                            ) : (
                                __('Pídele al administrador que las cargue en Ajustes → Portal y formularios.')
                            )}
                        </p>
                    </>
                )}
            </Section>

            <Section title={__('Datos personales')}>
                {dataConsent?.active ? (
                    <>
                        <Check
                            label={__('Pedir la autorización de tratamiento de datos')}
                            checked={s.data_consent}
                            onChange={(v) => set({ data_consent: v })}
                            testId="form-data-consent"
                        />
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            <Scale className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                            {s.data_consent
                                ? __('Al final del formulario aparece una casilla obligatoria con el texto de tu empresa (versión %d). Sin marcarla no se puede enviar, y cada respuesta guarda la prueba de la autorización.').replace(
                                      '%d',
                                      String(dataConsent.consent?.version ?? ''),
                                  )
                                : __('Apagada: este formulario no pide la autorización. Hazlo sólo si no recoge datos personales o si ya la obtienes por otro medio.')}
                        </p>
                    </>
                ) : dataConsent === null ? (
                    // Todavía no se sabe (cargando): ni casilla ni aviso, para no mostrar algo que no es.
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Cargando…')}</p>
                ) : (
                    <>
                        <Check label={__('Pedir la autorización de tratamiento de datos')} checked={false} disabled onChange={() => undefined} testId="form-data-consent" />
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="form-data-consent-unavailable">
                            {__('Tu empresa todavía no tiene el texto de la autorización.')}{' '}
                            {dataConsent.can_configure ? (
                                <a href="/#/settings?s=privacidad" target="_blank" rel="noreferrer" className="imcrm-text-primary hover:imcrm-underline">
                                    {__('Configúralo en Ajustes → Datos personales')}
                                </a>
                            ) : (
                                __('Pídele al administrador que lo configure en Ajustes → Datos personales.')
                            )}
                        </p>
                    </>
                )}
            </Section>

            <Section title={__('Apariencia')}>
                <Check label={__('Mostrar el logo de la empresa')} checked={s.show_logo} onChange={(v) => set({ show_logo: v })} />
                <Button variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-self-start" onClick={onOpenDesign} data-testid="form-open-design">
                    <Palette className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Colores, fuentes y más')}
                </Button>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Plantillas de diseño, colores, tipografía, tamaños, bordes, fondo y portada: en la pestaña «Diseño».')}
                </p>
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

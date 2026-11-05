import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import {
    ArrowLeft,
    MousePointerClick,
    Globe,
    Link2,
    Loader2,
    Monitor,
    Moon,
    Palette,
    BarChart3,
    Redo2,
    Smartphone,
    Sun,
    Trash2,
    Undo2,
    X,
} from 'lucide-react';
import {
    DEFAULT_PUBLIC_THEME,
    buildPublicFormItems,
    buildPublicThemeCss,
    formEstimateMinutes,
    formPaymentActive,
    REDIRECT_URL_RE,
    formSubscriptionActive,
    formRecallMap,
    FORM_FILE_ACCEPT_INFO,
    FORM_FILE_ACCEPTS,
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, useSession } from '@/cloud/session';
import { useBrandingData } from '@/hooks/useBranding';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTeams } from '@/hooks/useTeams';
import { __ } from '@/lib/i18n';
import { getTenantFormat } from '@/lib/tenantFormat';
import { getThemeState } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section } from '../automations/email/EmailBlockInspector';
import { FieldItemDesign, ImageItemEditor } from './design/ItemDesign';
import { ConditionEditor } from './design/ConditionEditor';
import { LogicMap, LogicPanel, RecallPicker, withToken } from './design/LogicPanel';
import { SitePreviewFrame } from './design/SitePreviewFrame';
import { MatrixEditor } from './design/QuestionKind';
import { MyThemes } from './design/MyThemes';
import { ThemeGallery } from './design/ThemeGallery';
import { ThemeInspector } from './design/ThemeInspector';
import { ElementColors } from './design/ElementColors';
import { ContentOutline } from './builder/ContentOutline';
import { InspectorTabs, PageElementInspector, type InspectorTab, type PageElementContext } from './builder/PageElementInspector';
import { SettingsGroupPanel, SettingsIndex, type SettingsContext } from './builder/SettingsGroups';
import { QUESTION_STYLE, isPageElement, type SettingsGroupId } from './builder/pageElements';
import { Choice, NumberField } from '@/components/design/DesignStyleControls';
import {
    activePresetId,
    applyTheme,
    effectiveTheme,
    fallbackAccent,
    formImageIds,
    normalizeForSave,
    patchThemeSection,
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
    conditionCandidates,
    endingName,
    logicCount,
    missingRequired,
    questionCount,
    readFormConfig,
    removeItem,
    updateItem,
    updateSettings,
    type FormContentType,
} from './formDesignOps';
import { demoVersion } from './EmbedDemo';
import { ShareDialog, type ShareTab } from './ShareDialog';
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
    const [leftTab, setLeftTab] = useState<LeftTab>('content');
    // v0.1.377 — `edit` = el panel de lo elegido (en el celular, a pantalla completa con «Volver»).
    const [mobileTab, setMobileTab] = useState<'content' | 'logic' | 'preview' | 'design' | 'settings' | 'edit'>('preview');
    const [mobileBack, setMobileBack] = useState<'content' | 'logic' | 'preview' | 'design' | 'settings'>('preview');
    // v0.1.377 — el grupo de Ajustes abierto (en el celular, null = el índice).
    const [settingsGroup, setSettingsGroup] = useState<SettingsGroupId | null>(null);
    // v0.1.377 — Contenido / Estilo del panel de lo elegido (se recuerda al cambiar de elemento).
    const [inspectorTab, setInspectorTab] = useState<InspectorTab>('content');
    // v0.1.369 — `site`: el formulario dentro de una página de ejemplo, como queda insertado.
    const [device, setDevice] = useState<'desktop' | 'mobile' | 'site'>('desktop');
    // Con el modo «según el dispositivo», qué ver en la vista previa (arranca como la app).
    const [previewScheme, setPreviewScheme] = useState<'light' | 'dark'>(() => getThemeState().resolved);
    const [shareOpen, setShareOpen] = useState(false);
    // v0.1.381 — «Compartir» es una ventana con pestañas.
    const [shareTab, setShareTab] = useState<ShareTab>('link');
    // v0.1.358 — las estadísticas del formulario.
    const [statsOpen, setStatsOpen] = useState(false);
    // v0.1.356 — la pantalla final que se mira en la vista previa (null = el formulario; '' = la de siempre).
    const [previewEnding, setPreviewEnding] = useState<string | null>(null);
    /** v0.1.357 — ver la bienvenida en la vista previa. */
    const [previewWelcome, setPreviewWelcome] = useState(false);

    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    const config = draft.config;
    // v0.1.368 — la vista previa muestra los planes de «Suscribir al enviar».
    const subOn = config.settings.subscription.enabled;
    const subPlans = useQuery({ queryKey: ['subscription-plans', 'all'], queryFn: () => api.subscriptionPlans(), retry: false, staleTime: 30_000, enabled: subOn });
    const fieldsById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    /**
     * v0.1.377 — Elegir algo (una pregunta o una parte como el título): se
     * edita a la derecha, y en el celular se abre su panel con «Volver».
     */
    const pick = useCallback(
        (id: string): void => {
            setSelected(id);
            // La pantalla de agradecimiento se mira en la vista previa al elegirla.
            setPreviewEnding(id === '@thanks' ? '' : null);
            if (narrow) {
                setMobileTab((cur) => {
                    if (cur !== 'edit') setMobileBack(cur);
                    return 'edit';
                });
            }
        },
        [narrow],
    );

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
            // v0.1.369 — el logo propio del formulario, si tiene; si no, el de la empresa.
            logo_url: s.show_logo ? (s.logo_file_id !== null ? imageUrl(s.logo_file_id) : (b?.logo_url ?? null)) : null,
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
            // v0.1.361 — cobrar al enviar: la vista previa muestra el total y el botón.
            payment: formPaymentActive(config)
                ? {
                      source: s.payment.source,
                      amount: s.payment.source === 'fixed' ? s.payment.amount : null,
                      calc_key: s.payment.source === 'calc' ? s.payment.calc_key : null,
                      field_id: s.payment.source === 'field' ? s.payment.field_id : null,
                      min: s.payment.source === 'field' ? s.payment.min : null,
                      max: s.payment.source === 'field' ? s.payment.max : null,
                      currency: s.payment.currency,
                      after: s.payment.after,
                      button_label: s.payment.button_label || 'Ir a pagar',
                  }
                : null,
            // v0.1.368 — suscribir al enviar: los planes elegidos, en su orden.
            subscription: (() => {
                if (!formSubscriptionActive(config)) return null;
                const byId = new Map((subPlans.data ?? []).filter((p) => p.active).map((p) => [p.id, p]));
                const plans = s.subscription.plan_ids.flatMap((id) => {
                    const p = byId.get(id);
                    return p
                        ? [{ id: p.id, name: p.name, description: p.description, amount: p.amount, currency: p.currency, frequency: p.frequency, frequency_type: p.frequency_type, trial_days: p.trial_days, cycles: p.cycles }]
                        : [];
                });
                if (plans.length === 0) return null;
                return {
                    plans,
                    plan_label: s.subscription.plan_label || (plans.length > 1 ? 'Elige tu plan' : 'Tu plan'),
                    after: s.subscription.after,
                    button_label: s.subscription.button_label || 'Autorizar el débito automático',
                };
            })(),
        };
    }, [config, draft.name, fields, branding.data, captcha.data?.provider, dataConsent.data, teamOptions, imageUrl, theme, subPlans.data]);

    useEffect(() => {
        const onMessage = (e: MessageEvent): void => {
            if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow) return;
            const data = e.data as { type?: string; id?: string } | null;
            if (data?.type === 'imb-form-ready') setReady((n) => n + 1);
            if (data?.type === 'imb-form-select' && typeof data.id === 'string') {
                pick(data.id);
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [pick]);
    useEffect(() => {
        if (!ready) return;
        iframeRef.current?.contentWindow?.postMessage(
            {
                type: 'imb-form-preview',
                meta,
                selected,
                css: themeCss,
                scheme,
                ending: previewEnding ?? undefined,
                welcome: previewWelcome && config.settings.welcome.enabled,
                embed: device === 'site',
            },
            window.location.origin,
        );
    }, [ready, meta, selected, themeCss, scheme, previewEnding, previewWelcome, config.settings.welcome.enabled, device]);
    // Elegir una pregunta vuelve al formulario (la bienvenida tapa las preguntas);
    // elegir la bienvenida la muestra.
    useEffect(() => {
        if (selected) setPreviewWelcome(selected === '@welcome');
    }, [selected]);
    // Al salir de «Lógica» la vista previa vuelve al formulario (salvo mirando el agradecimiento).
    useEffect(() => {
        if (leftTab !== 'logic' && selected !== '@thanks') setPreviewEnding(null);
    }, [leftTab, selected]);

    const save = async (extra: { enabled?: boolean } = {}): Promise<boolean> => {
        // v0.1.356 — una pantalla final con la dirección a medio escribir se perdería al guardar.
        const badEnding = draft.config.settings.endings.findIndex((e) => !!e.redirect_url && !REDIRECT_URL_RE.test(e.redirect_url));
        if (badEnding >= 0) {
            const e = draft.config.settings.endings[badEnding]!;
            toast.error(
                __('Revisa la pantalla final «%s»').replace('%s', endingName(e, badEnding)),
                __('Su dirección tiene que empezar con https://, o déjala vacía para mostrar el mensaje.'),
            );
            setSelected(null);
            if (narrow) setMobileTab('logic');
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
            if (next) {
                setShareTab('link');
                setShareOpen(true);
            }
        }
    };
    const openShare = (tab: ShareTab): void => {
        setShareTab(tab);
        setShareOpen(true);
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
        pick(id);
    };
    const addContent = (type: FormContentType): void => {
        const { config: next, id } = addContentItem(config, type, selected);
        change(next);
        pick(id);
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
        // En el celular, directo a sus ajustes: una matriz hay que armarla.
        pick(id);
    };

    const applyPreset = (p: PublicThemePreset): void => {
        change(applyTheme(config, p.theme, { keepCustomCss: !isAdmin, carryImages: true }));
    };
    const applySaved = (t: SavedPublicTheme): void => {
        change(applyTheme(config, t.theme, { keepCustomCss: !isAdmin }));
        toast.success(__('Tema aplicado'), __('«%s». Si no te convence, deshazlo.').replace('%s', t.name));
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

    // La pantalla de agradecimiento «de siempre» se edita tocándola.
    const openSettings = (): void => pick('@thanks');
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

    const closeSelection = (): void => {
        setSelected(null);
        if (narrow) setMobileTab(mobileBack);
    };
    const selectedElement = isPageElement(selected) ? selected : null;
    const settingsCtx: SettingsContext = {
        config,
        onChange: change,
        fields,
        listId,
        formId: form.id,
        name: draft.name,
        setName: (name) => setDraft((d) => ({ ...d, name })),
        captcha: captcha.data ?? null,
        dataConsent: dataConsent.data ?? null,
        missing,
        previewWelcome,
        onPreviewWelcome: setPreviewWelcome,
        onSelectElement: pick,
        onOpenShare: openShare,
    };
    const openSettingsGroup = (g: SettingsGroupId): void => {
        setSelected(null);
        setSettingsGroup(g);
        setLeftTab('settings');
        if (narrow) setMobileTab('settings');
    };
    const elementCtx: PageElementContext = {
        config,
        onChange: change,
        fields,
        brand: brandColor,
        isAdmin,
        captcha: captcha.data ?? null,
        dataConsent: dataConsent.data ?? null,
        previewWelcome,
        onPreviewWelcome: setPreviewWelcome,
        onOpenSettings: openSettingsGroup,
        onOpenLogic: () => {
            setSelected(null);
            setLeftTab('logic');
            if (narrow) setMobileTab('logic');
        },
    };

    const outline = (
        <ContentOutline
            config={config}
            fields={fields}
            fieldsById={fieldsById}
            selected={selected}
            onSelect={pick}
            onChange={change}
            onAddField={addField}
            onAddContent={addContent}
            onAddMatrix={addMatrix}
            titleText={config.settings.title || draft.name}
            hasLogo={!!branding.data?.logo_url}
        />
    );
    const settingsIndex = (
        <SettingsIndex
            active={narrow ? null : (settingsGroup ?? 'general')}
            onPick={(g) => {
                setSettingsGroup(g);
                setSelected(null);
            }}
            config={config}
            captcha={captcha.data ?? null}
            missing={missing}
        />
    );
    const designLeft = (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-p-3">
            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                <Palette className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                {__('Elige una plantilla o un tema guardado. Los colores, fuentes y tamaños de todo el formulario se ajustan a la derecha; los de una parte, tocándola.')}
            </p>
            {designLibrary}
        </div>
    );
    const left = (
        <div className="imcrm-flex imcrm-flex-col">
            <BuilderTabs
                tab={leftTab}
                onTab={(t) => {
                    setLeftTab(t as LeftTab);
                    // Elegir una pestaña muestra sus ajustes a la derecha.
                    setSelected(null);
                }}
                tabs={[
                    ['content', __('Contenido')],
                    ['design', __('Diseño')],
                    ['logic', __('Lógica')],
                    ['settings', __('Ajustes')],
                ]}
                logicCount={logicCount(config)}
                itemsCount={config.items.length}
            />
            {leftTab === 'content' && outline}
            {leftTab === 'design' && designLeft}
            {leftTab === 'logic' && <LogicMap config={config} fieldsById={fieldsById} />}
            {leftTab === 'settings' && settingsIndex}
        </div>
    );
    const itemInspector = selectedItem ? (
        <ItemInspector
            key={selectedItem.id}
            item={selectedItem}
            config={config}
            fieldsById={fieldsById}
            fields={fields}
            listId={listId}
            themeChoiceStyle={theme.choices.style}
            onChange={change}
            onClose={closeSelection}
            tab={inspectorTab}
            onTab={setInspectorTab}
            brand={brandColor}
            isAdmin={isAdmin}
        />
    ) : null;
    const elementInspector = selectedElement ? (
        <PageElementInspector key={selectedElement} id={selectedElement} ctx={elementCtx} tab={inspectorTab} onTab={setInspectorTab} onClose={closeSelection} />
    ) : null;
    const right =
        itemInspector ??
        elementInspector ??
        (leftTab === 'design' ? (
            themeInspector
        ) : leftTab === 'logic' ? (
            logicPanel
        ) : leftTab === 'settings' ? (
            <SettingsGroupPanel group={settingsGroup ?? 'general'} ctx={settingsCtx} />
        ) : (
            <EmptyInspector onPick={pick} />
        ));
    const preview = (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-bg-canvas">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-1.5">
                <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Vista previa — toca cualquier parte para editarla')}
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
                                ['site', Globe, __('Insertado en tu sitio')],
                            ] as const
                        ).map(([key, Icon, label]) => (
                            <button
                                key={key}
                                type="button"
                                title={label}
                                aria-pressed={device === key}
                                onClick={() => setDevice(key)}
                                data-testid={`form-preview-device-${key}`}
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
                {device === 'site' ? (
                    <SitePreviewFrame bare={theme.layout.embed_style === 'bare'}>
                        <iframe
                            ref={iframeRef}
                            src="/api/v1/public/f/preview"
                            title={__('Vista previa del formulario')}
                            className="imcrm-block imcrm-h-full imcrm-w-full imcrm-border-0"
                            style={{ background: 'transparent' }}
                            data-testid="form-preview"
                        />
                    </SitePreviewFrame>
                ) : (
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
                )}
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
                    <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => openShare(shareTab)} data-testid="form-share">
                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        <span className="imcrm-hidden sm:imcrm-inline">{__('Compartir')}</span>
                    </Button>
                    <Button size="sm" disabled={!dirty || update.isPending} onClick={() => void save().then((ok) => ok && toast.success(__('Formulario guardado')))} data-testid="form-save">
                        {update.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : __('Guardar')}
                    </Button>
                </div>
            </header>
            {statsOpen && <FormStatsSheet open onOpenChange={setStatsOpen} listId={listId} form={form} fields={fields} />}
            <ShareDialog
                open={shareOpen}
                onOpenChange={setShareOpen}
                kind="form"
                name={config.settings.title.trim() || draft.name || form.name}
                url={formPublicUrl(form)}
                origin={formPublicOrigin(form)}
                path={form.public_path}
                version={demoVersion([saved, enabled])}
                published={enabled}
                onPublish={() => void togglePublish()}
                publishBusy={update.isPending}
                accent={resolvedAccent(config.settings, brandColor)}
                bare={{
                    value: theme.layout.embed_style === 'bare',
                    onChange: (v) => change(patchThemeSection(config, 'layout', { embed_style: v ? 'bare' : 'card' })),
                    unsaved: dirty,
                }}
                domains={{
                    value: config.settings.allowed_domains,
                    onChange: (v) => change(updateSettings(config, { allowed_domains: v })),
                    unsaved: config.settings.allowed_domains.join('\n') !== saved.config.settings.allowed_domains.join('\n'),
                }}
                dirty={dirty}
                onSave={() => void save().then((ok) => ok && toast.success(__('Formulario guardado')))}
                tab={shareTab}
                onTab={setShareTab}
            />

            {narrow ? (
                <>
                    {mobileTab === 'edit' ? (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-2 imcrm-py-1.5">
                            <Button variant="ghost" size="sm" className="imcrm-gap-1" onClick={closeSelection} data-testid="form-edit-back">
                                <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                                {__('Volver')}
                            </Button>
                            <span className="imcrm-ml-auto imcrm-text-[11px] imcrm-text-muted-foreground">{__('Editando')}</span>
                        </div>
                    ) : (
                        <BuilderTabs
                            full
                            tab={mobileTab}
                            onTab={(t) => {
                                setMobileTab(t as typeof mobileTab);
                                setSelected(null);
                                if (t === 'settings') setSettingsGroup(null);
                            }}
                            tabs={[
                                ['content', __('Contenido')],
                                ['logic', __('Lógica')],
                                ['preview', __('Vista previa')],
                                ['design', __('Diseño')],
                                ['settings', __('Ajustes')],
                            ]}
                            logicCount={logicCount(config)}
                        />
                    )}
                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto">
                        {mobileTab === 'content' && outline}
                        {mobileTab === 'logic' && logicPanel}
                        {mobileTab === 'design' && (
                            <div className="imcrm-flex imcrm-flex-col" data-testid="form-design-mobile">
                                <div className="imcrm-border-b imcrm-border-border imcrm-p-3">{designLibrary}</div>
                                {themeInspector}
                            </div>
                        )}
                        {mobileTab === 'preview' && <div className="imcrm-h-full">{preview}</div>}
                        {mobileTab === 'settings' &&
                            (settingsGroup === null ? (
                                settingsIndex
                            ) : (
                                <div className="imcrm-flex imcrm-flex-col">
                                    <button
                                        type="button"
                                        onClick={() => setSettingsGroup(null)}
                                        className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-px-4 imcrm-pt-3 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                                        data-testid="form-settings-back"
                                    >
                                        <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Ajustes')}
                                    </button>
                                    <SettingsGroupPanel group={settingsGroup} ctx={settingsCtx} />
                                </div>
                            ))}
                        {mobileTab === 'edit' && (itemInspector ?? elementInspector ?? <EmptyInspector onPick={pick} />)}
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

// ─────────────────────────── Panel izquierdo ───────────────────────────

type LeftTab = 'content' | 'design' | 'logic' | 'settings';

/** Ancla del recorrido para la pestaña «Diseño» (escritorio y celular). */
function designTabTour(tab: string): string | undefined {
    return tab === 'design' ? 'form-design-tab' : tab === 'settings' ? 'form-settings-tab' : tab === 'content' ? 'form-content-tab' : undefined;
}

/**
 * v0.1.377 — Las pestañas del constructor: Contenido (todo lo que tiene el
 * formulario, en orden), Diseño (plantillas y temas), Lógica y Ajustes (en
 * grupos). Cada pestaña dice para qué sirve, así nunca hay que adivinar.
 */
function BuilderTabs({
    tab,
    onTab,
    tabs,
    logicCount: rules,
    itemsCount,
    full,
}: {
    tab: string;
    onTab: (t: string) => void;
    tabs: ReadonlyArray<readonly [string, string]>;
    logicCount: number;
    itemsCount?: number;
    /** En el celular, la tira de pestañas de arriba (a todo el ancho). */
    full?: boolean;
}): JSX.Element {
    return (
        <div role="tablist" className={cn('imcrm-flex imcrm-border-b imcrm-border-border', full ? '' : 'imcrm-gap-0.5 imcrm-px-1 imcrm-pt-2')}>
            {tabs.map(([key, label]) => (
                <button
                    key={key}
                    role="tab"
                    type="button"
                    aria-selected={tab === key}
                    data-tour={designTabTour(key)}
                    data-testid={`form-tab-${key}`}
                    aria-label={key === 'content' && itemsCount !== undefined ? `${label} (${itemsCount})` : key === 'logic' && rules > 0 ? `${label} (${rules})` : undefined}
                    title={key === 'logic' && rules > 0 ? __('%s saltos y pantallas finales').replace('%s', String(rules)) : undefined}
                    onClick={() => onTab(key)}
                    className={cn(
                        '-imcrm-mb-px imcrm-whitespace-nowrap imcrm-border-b-2',
                        full ? 'imcrm-flex-1 imcrm-py-2 imcrm-text-[13px]' : 'imcrm-flex-1 imcrm-px-1.5 imcrm-pb-2 imcrm-text-xs',
                        tab === key ? 'imcrm-border-primary imcrm-font-medium imcrm-text-foreground' : 'imcrm-border-transparent imcrm-text-muted-foreground',
                    )}
                >
                    {label}
                    {key === 'logic' && rules > 0 && (
                        <span className="imcrm-ml-1 imcrm-inline-block imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-primary imcrm-align-middle" aria-hidden="true" />
                    )}
                </button>
            ))}
        </div>
    );
}

/** v0.1.377 — Lo que se ve a la derecha cuando no hay nada elegido. */
function EmptyInspector({ onPick }: { onPick: (id: string) => void }): JSX.Element {
    const quick: Array<[string, string]> = [
        ['@title', 'El título'],
        ['@logo', 'El logo'],
        ['@submit', 'El botón'],
        ['@thanks', 'El agradecimiento'],
        ['@page', 'El fondo'],
    ];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-px-6 imcrm-py-12 imcrm-text-center" data-testid="form-inspector-empty">
            <span className="imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary">
                <MousePointerClick className="imcrm-h-5 imcrm-w-5" />
            </span>
            <div>
                <p className="imcrm-text-sm imcrm-font-semibold">{__('Toca cualquier parte del formulario')}</p>
                <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('En la vista previa o en la lista de la izquierda: una pregunta, el título, el logo, el botón… Aquí aparece lo que dice, si se muestra y su estilo.')}
                </p>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-center imcrm-gap-1.5">
                {quick.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onPick(id)}
                        className="imcrm-rounded-full imcrm-border imcrm-border-border imcrm-px-2.5 imcrm-py-1 imcrm-text-[11px] hover:imcrm-bg-accent"
                    >
                        {__(label)}
                    </button>
                ))}
            </div>
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
    tab,
    onTab,
    brand,
    isAdmin,
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
    /** v0.1.377 — Contenido / Estilo. */
    tab: InspectorTab;
    onTab: (t: InspectorTab) => void;
    brand: string;
    isAdmin: boolean;
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

    const hasStyle = item.type === 'field' ? !item.hidden : item.type === 'heading' || item.type === 'text' || item.type === 'matrix';
    const shown: InspectorTab = hasStyle ? tab : 'content';
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
                    <Button variant="ghost" size="icon" aria-label={__('Cerrar')} onClick={onClose}>
                        <X className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                </div>
            </div>
            <InspectorTabs tab={shown} onTab={onTab} hasStyle={hasStyle} />
            {shown === 'style' ? (
                <ItemStyle item={item} field={field} config={config} fields={fields} listId={listId} themeChoiceStyle={themeChoiceStyle} onChange={onChange} brand={brand} isAdmin={isAdmin} />
            ) : (
            <>
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
                            part="answer"
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
            </>
            )}
        </div>
    );
}

/**
 * v0.1.377 — «Estilo» de una pregunta: lo suyo (ancho, etiqueta, columnas,
 * imágenes de las opciones) y lo que vale para TODAS las preguntas (colores,
 * tamaño de la etiqueta, campos y opciones), dicho así para que nadie crea que
 * cambia sólo ésta.
 */
function ItemStyle({
    item,
    field,
    config,
    fields,
    listId,
    themeChoiceStyle,
    onChange,
    brand,
    isAdmin,
}: {
    item: FormItem;
    field: FieldEntity | undefined;
    config: FormConfig;
    fields: FieldEntity[];
    listId: number;
    themeChoiceStyle: PublicChoiceStyle;
    onChange: (next: FormConfig) => void;
    brand: string;
    isAdmin: boolean;
}): JSX.Element {
    const t = effectiveTheme(config.settings);
    const D = DEFAULT_PUBLIC_THEME;
    const isChoice = item.type === 'matrix' || (item.type === 'field' && !!field && ['select', 'multi_select', 'team', 'checkbox', 'rating'].includes(field.type));
    if (item.type === 'heading' || item.type === 'text') {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="form-item-style">
                <Section title={__('Colores')}>
                    <ElementColors config={config} onChange={onChange} keys={item.type === 'heading' ? ['heading'] : ['text', 'link']} brand={brand} />
                    <p className="imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {item.type === 'heading' ? __('Vale para todos los títulos de sección del formulario.') : __('Vale para todos los textos del formulario.')}
                    </p>
                </Section>
            </div>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="form-item-style">
            {item.type === 'field' && field && (
                <FieldItemDesign
                    part="look"
                    item={item}
                    field={field}
                    themeChoiceStyle={themeChoiceStyle}
                    config={config}
                    fields={fields}
                    listId={listId}
                    onSet={(patch) => onChange(updateItem(config, item.id, patch))}
                />
            )}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas/60 imcrm-p-2.5">
                <p className="imcrm-text-xs imcrm-font-semibold">{__('Para todas las preguntas')}</p>
                <p className="imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Lo de aquí cambia todas las preguntas del formulario a la vez, así se ven parejas.')}
                </p>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    <NumberField
                        label={__('Tamaño de la pregunta')}
                        unit="px"
                        min={12}
                        max={30}
                        value={t.typography.question_size}
                        placeholder={String(D.typography.question_size)}
                        onChange={(v) => onChange(patchThemeSection(config, 'typography', { question_size: v == null ? D.typography.question_size : Math.round(v) }))}
                    />
                    <Choice
                        label={__('Grosor')}
                        value={String(t.typography.question_weight)}
                        options={[
                            { value: '400', label: __('Normal') },
                            { value: '600', label: __('Semi') },
                            { value: '700', label: __('Negrita') },
                        ]}
                        onChange={(v) => onChange(patchThemeSection(config, 'typography', { question_weight: Number(v) as typeof t.typography.question_weight }))}
                    />
                </div>
                <ElementColors config={config} onChange={onChange} keys={QUESTION_STYLE.colors} brand={brand} />
                {isChoice && <ElementColors config={config} onChange={onChange} keys={QUESTION_STYLE.choiceColors} brand={brand} />}
                <ThemeInspector
                    config={config}
                    onChange={onChange}
                    brand={brand}
                    isAdmin={isAdmin}
                    showLogo={config.settings.show_logo}
                    only={isChoice ? ['inputs', 'choices'] : ['inputs']}
                />
            </div>
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

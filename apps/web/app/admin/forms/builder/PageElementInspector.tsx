import { Eye, EyeOff, X } from 'lucide-react';
import {
    DEFAULT_PUBLIC_THEME,
    type CaptchaAvailability,
    type FormConfig,
    type FormDataConsentAvailability,
    type PublicTheme,
} from '@imagina-base/shared';

import { Choice, FontSelect, NumberField } from '@/components/design/DesignStyleControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useBrandingData } from '@/hooks/useBranding';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { Field, Section } from '../../automations/email/EmailBlockInspector';
import { ElementColors } from '../design/ElementColors';
import { RecallPicker, withToken } from '../design/LogicPanel';
import { LogoSetting } from '../design/LogoSetting';
import { ChargeSettings, WelcomeSettings } from '../design/StartSettings';
import { ThemeInspector } from '../design/ThemeInspector';
import { effectiveTheme, patchThemeSection } from '../design/themeOps';
import { updateSettings } from '../formDesignOps';
import { AfterSubmitSettings, CaptchaSettings, DataConsentSettings } from './SettingsGroups';
import { PAGE_ELEMENTS, elementVisible, setElementVisible, visibilityLabel, type PageElementId, type SettingsGroupId } from './pageElements';

/**
 * v0.1.377 — El panel de una parte del formulario que no es una pregunta (el
 * título, el logo, el botón, la portada…). Dos pestañas: «Contenido» (qué
 * dice y si se muestra) y «Estilo» (sólo lo que la cambia a ella: sus
 * colores, su tamaño, su fuente). Así nunca hay que adivinar dónde se oculta
 * el título o se cambia el color del botón.
 */

export type InspectorTab = 'content' | 'style';

const WEIGHTS = [
    { value: '400', label: 'Normal' },
    { value: '500', label: 'Media' },
    { value: '600', label: 'Semi' },
    { value: '700', label: 'Negrita' },
    { value: '800', label: 'Extra' },
] as const;
type Weight = PublicTheme['typography']['title_weight'];

/** Las pestañas Contenido / Estilo (también las usa el panel de una pregunta). */
export function InspectorTabs({ tab, onTab, hasContent = true, hasStyle = true }: { tab: InspectorTab; onTab: (t: InspectorTab) => void; hasContent?: boolean; hasStyle?: boolean }): JSX.Element | null {
    if (!hasContent || !hasStyle) return null;
    return (
        <div role="tablist" aria-label={__('Qué editar')} className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5" data-testid="inspector-tabs">
            {(
                [
                    ['content', __('Contenido')],
                    ['style', __('Estilo')],
                ] as const
            ).map(([key, label]) => (
                <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => onTab(key)}
                    data-inspector-tab={key}
                    className={cn(
                        'imcrm-h-7 imcrm-rounded imcrm-text-xs imcrm-font-medium',
                        tab === key ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

/** El interruptor «Mostrar …» de un elemento (con el ojo, como en la lista de la izquierda). */
export function VisibilitySwitch({ on, label, onChange, testId }: { on: boolean; label: string; onChange: (v: boolean) => void; testId?: string }): JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => onChange(!on)}
            data-testid={testId}
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-xs',
                on ? 'imcrm-border-border' : 'imcrm-border-dashed imcrm-border-muted-foreground/40 imcrm-bg-muted/40',
            )}
        >
            {on ? <Eye className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" /> : <EyeOff className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />}
            <span className="imcrm-flex-1 imcrm-font-medium">{__(label)}</span>
            <span
                aria-hidden="true"
                className={cn('imcrm-relative imcrm-h-4 imcrm-w-7 imcrm-shrink-0 imcrm-rounded-full imcrm-transition-colors', on ? 'imcrm-bg-primary' : 'imcrm-bg-muted-foreground/40')}
            >
                <span className={cn('imcrm-absolute imcrm-top-0.5 imcrm-h-3 imcrm-w-3 imcrm-rounded-full imcrm-bg-white imcrm-shadow imcrm-transition-all', on ? 'imcrm-left-3.5' : 'imcrm-left-0.5')} />
            </span>
        </button>
    );
}

export interface PageElementContext {
    config: FormConfig;
    onChange: (next: FormConfig) => void;
    fields: FieldEntity[];
    brand: string;
    isAdmin: boolean;
    captcha: CaptchaAvailability | null;
    dataConsent: FormDataConsentAvailability | null;
    previewWelcome: boolean;
    onPreviewWelcome: (on: boolean) => void;
    /** Abre un grupo de Ajustes (lo demás de la pantalla de agradecimiento, la bienvenida…). */
    onOpenSettings: (g: SettingsGroupId) => void;
    /** Abre la pestaña «Lógica» (pantallas finales según la respuesta). */
    onOpenLogic: () => void;
    base?: PublicTheme;
}

export function PageElementInspector({
    id,
    ctx,
    tab,
    onTab,
    onClose,
}: {
    id: PageElementId;
    ctx: PageElementContext;
    tab: InspectorTab;
    onTab: (t: InspectorTab) => void;
    onClose: () => void;
}): JSX.Element {
    const info = PAGE_ELEMENTS[id];
    const base = ctx.base ?? DEFAULT_PUBLIC_THEME;
    const visible = elementVisible(ctx.config, id, base);
    const content = hasContent(id, visible);
    const style = info.colors.length > 0 || info.sections.length > 0 || hasCustomStyle(id);
    const shown: InspectorTab = !content ? 'style' : !style ? 'content' : tab;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-p-4" data-testid="form-element-inspector" data-element={id}>
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    <p className="imcrm-truncate imcrm-text-sm imcrm-font-semibold">{__(info.label)}</p>
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__(info.hint)}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label={__('Cerrar')} onClick={onClose}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
            {visible !== null && (
                <VisibilitySwitch
                    on={visible}
                    label={visibilityLabel(id)}
                    onChange={(v) => ctx.onChange(setElementVisible(ctx.config, id, v, base))}
                    testId="form-element-visible"
                />
            )}
            <InspectorTabs tab={shown} onTab={onTab} hasContent={content} hasStyle={style} />
            {shown === 'content' ? <ElementContent id={id} ctx={ctx} /> : <ElementStyle id={id} ctx={ctx} base={base} />}
        </div>
    );
}

function hasContent(id: PageElementId, visible: boolean | null): boolean {
    if (id === '@page' || id === '@band' || id === '@cover' || id === '@card') return false;
    if (id === '@progress') return visible === true;
    return true;
}

function hasCustomStyle(id: PageElementId): boolean {
    return id === '@logo' || id === '@title' || id === '@description';
}

// ───────────────────────────── Contenido ─────────────────────────────

function ElementContent({ id, ctx }: { id: PageElementId; ctx: PageElementContext }): JSX.Element | null {
    const { config, fields } = ctx;
    const s = config.settings;
    const set = (patch: Partial<FormConfig['settings']>): void => ctx.onChange(updateSettings(config, patch));
    const branding = useBrandingData();
    switch (id) {
        case '@logo':
            return <LogoSetting settings={s} hasBrandLogo={!!branding.data?.logo_url} onChange={set} />;
        case '@title':
            return (
                <Field label={__('Título')} hint={__('Vacío = el nombre del formulario.')}>
                    <Input value={s.title} onChange={(e) => set({ title: e.target.value })} data-testid="form-title" />
                    <RecallPicker config={config} fields={fields} onPick={(t) => set({ title: withToken(s.title, t) })} />
                </Field>
            );
        case '@description':
            return (
                <Field label={__('Descripción')} hint={__('Una línea en blanco separa párrafos.')}>
                    <Textarea rows={4} value={s.description} onChange={(e) => set({ description: e.target.value })} data-testid="form-description" />
                    <RecallPicker config={config} fields={fields} onPick={(t) => set({ description: withToken(s.description, t) })} />
                </Field>
            );
        case '@welcome':
            return (
                <WelcomeSettings config={config} fields={fields} onChange={ctx.onChange} previewWelcome={ctx.previewWelcome} onPreviewWelcome={ctx.onPreviewWelcome} bare />
            );
        case '@submit':
            return (
                <>
                    <Field label={__('Texto del botón')} hint={__('En un formulario de varias páginas, el de la última. Las demás dicen «Siguiente».')}>
                        <Input value={s.submit_label} placeholder={__('Enviar')} onChange={(e) => set({ submit_label: e.target.value })} data-testid="form-submit-label" />
                    </Field>
                </>
            );
        case '@thanks':
            return (
                <>
                    <AfterSubmitSettings ctx={ctx} bare />
                    <button type="button" className="imcrm-self-start imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline" onClick={ctx.onOpenLogic}>
                        {__('Mostrar otra pantalla según lo que respondió (Lógica) →')}
                    </button>
                </>
            );
        case '@progress':
            return (
                <Choice<'bar' | 'steps'>
                    label={__('Cómo se ve')}
                    value={effectiveTheme(s, ctx.base).layout.progress === 'steps' ? 'steps' : 'bar'}
                    options={[
                        { value: 'bar', label: __('Barra') },
                        { value: 'steps', label: __('Pasos') },
                    ]}
                    onChange={(v) => ctx.onChange(patchThemeSection(config, 'layout', { progress: v }, ctx.base))}
                />
            );
        case '@captcha':
            return <CaptchaSettings ctx={ctx} />;
        case '@consent':
            return <DataConsentSettings ctx={ctx} />;
        case '@payment':
        case '@subscription':
            return <ChargeSettings config={config} fields={fields} onChange={ctx.onChange} />;
        default:
            return null;
    }
}

// ───────────────────────────── Estilo ─────────────────────────────

function ElementStyle({ id, ctx, base }: { id: PageElementId; ctx: PageElementContext; base: PublicTheme }): JSX.Element {
    const info = PAGE_ELEMENTS[id];
    const t = effectiveTheme(ctx.config.settings, base);
    const D = base;
    const setTheme = <K extends 'typography' | 'layout'>(key: K, patch: Partial<PublicTheme[K]>): void => ctx.onChange(patchThemeSection(ctx.config, key, patch, base));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="form-element-style">
            {id === '@title' && (
                <Section title={__('Texto del título')}>
                    <FontSelect
                        label={__('Fuente de los títulos')}
                        value={t.typography.heading_font}
                        onChange={(f) => setTheme('typography', { heading_font: f })}
                        medium="web"
                        inheritLabel={__('La misma del texto')}
                    />
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                        <NumberField
                            label={__('Tamaño')}
                            unit="px"
                            min={16}
                            max={64}
                            value={t.typography.title_size}
                            placeholder={String(D.typography.title_size)}
                            onChange={(v) => setTheme('typography', { title_size: v == null ? D.typography.title_size : Math.round(v) })}
                        />
                        <NumberField
                            label={__('Espacio entre letras')}
                            unit="px"
                            min={-2}
                            max={8}
                            step={0.1}
                            value={t.typography.title_letter_spacing}
                            placeholder="-0,24"
                            onChange={(v) => setTheme('typography', { title_letter_spacing: v ?? D.typography.title_letter_spacing })}
                        />
                    </div>
                    <Choice
                        label={__('Grosor')}
                        value={String(t.typography.title_weight)}
                        options={WEIGHTS.map((w) => ({ value: w.value, label: __(w.label) }))}
                        onChange={(v) => setTheme('typography', { title_weight: Number(v) as Weight })}
                    />
                </Section>
            )}
            {(id === '@title' || id === '@description' || id === '@logo') && (
                <Choice<'left' | 'center'>
                    label={__('Alineación del encabezado')}
                    value={t.layout.header_align}
                    options={[
                        { value: 'left', label: __('Izquierda') },
                        { value: 'center', label: __('Centro') },
                    ]}
                    onChange={(v) => setTheme('layout', { header_align: v })}
                />
            )}
            {id === '@logo' && (
                <NumberField
                    label={__('Alto del logo')}
                    unit="px"
                    min={16}
                    max={160}
                    value={t.layout.logo_size}
                    placeholder={String(D.layout.logo_size)}
                    onChange={(v) => setTheme('layout', { logo_size: v == null ? D.layout.logo_size : Math.round(v) })}
                />
            )}
            {info.colors.length > 0 && (
                <Section title={__('Colores')}>
                    <ElementColors config={ctx.config} onChange={ctx.onChange} keys={info.colors} brand={ctx.brand} base={base} />
                    <p className="imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Vacío = el de los colores generales (se ve punteado).')}</p>
                </Section>
            )}
            {info.sections.length > 0 && (
                <ThemeInspector
                    config={ctx.config}
                    onChange={ctx.onChange}
                    brand={ctx.brand}
                    isAdmin={ctx.isAdmin}
                    showLogo={ctx.config.settings.show_logo}
                    only={info.sections.filter((k) => k !== 'typography' || id !== '@title')}
                />
            )}
        </div>
    );
}

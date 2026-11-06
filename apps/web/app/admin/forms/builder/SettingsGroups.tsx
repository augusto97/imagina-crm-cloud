import {
    AlertTriangle,
    BadgeDollarSign,
    ChevronRight,
    Clock,
    Code2,
    FileText,
    Globe,
    Hand,
    Mail,
    MailCheck,
    Save,
    Scale,
    Settings2,
    ShieldCheck,
    Sparkles,
    type LucideIcon,
} from 'lucide-react';
import {
    CAPTCHA_PROVIDER_INFO,
    formPaymentActive,
    formSubscriptionActive,
    type CaptchaAvailability,
    type FormConfig,
    type FormDataConsentAvailability,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useRecordTemplates } from '@/hooks/useRecordTemplates';
import { __ } from '@/lib/i18n';
import { formatDateStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section } from '../../automations/email/EmailBlockInspector';
import { ConversionSettings, ThankYouUrlField } from '../design/ConversionSettings';
import { FormOriginSettings } from '../design/RecordOriginSettings';
import { RecallPicker, withToken } from '../design/LogicPanel';
import { ChargeSettings, EditLinksSettings, LayoutSettings, SaveProgressSettings, WelcomeSettings } from '../design/StartSettings';
import { emailQuestions, updateItem, updateSettings } from '../formDesignOps';
import { SETTINGS_GROUPS, SETTINGS_GROUP_INFO, type PageElementId, type SettingsGroupId } from './pageElements';

/**
 * v0.1.377 — «Ajustes» del constructor de formularios, en grupos con nombre
 * (General, Al enviar, Cupos y cierre…) en vez de una sola columna con todo
 * mezclado. Lo que se ve en el formulario (título, logo, botón…) NO está acá:
 * se toca en la vista previa o en «Contenido».
 */

const GROUP_ICON: Record<SettingsGroupId, LucideIcon> = {
    general: Settings2,
    welcome: Hand,
    after: Sparkles,
    email: Mail,
    limits: Clock,
    save: Save,
    charge: BadgeDollarSign,
    record: FileText,
    security: ShieldCheck,
    embed: Code2,
    origin: Globe,
};

export interface SettingsContext {
    config: FormConfig;
    onChange: (next: FormConfig) => void;
    fields: FieldEntity[];
    listId: number;
    formId: number;
    name: string;
    setName: (name: string) => void;
    captcha: CaptchaAvailability | null;
    dataConsent: FormDataConsentAvailability | null;
    missing: FieldEntity[];
    previewWelcome: boolean;
    onPreviewWelcome: (on: boolean) => void;
    /** Ir a una parte del formulario (el título, el botón…). */
    onSelectElement: (id: PageElementId) => void;
    /** v0.1.381 — abrir «Compartir» en una pestaña (insertar en tu sitio vive ahí). */
    onOpenShare?: (tab: 'link' | 'embed' | 'qr') => void;
}

/** Una línea con cómo está cada grupo, para el índice. */
export function groupSummary(g: SettingsGroupId, config: FormConfig, captcha: CaptchaAvailability | null): string {
    const s = config.settings;
    const on = (b: boolean): string => (b ? __('Encendido') : __('Apagado'));
    switch (g) {
        case 'general':
            return s.layout === 'conversational' ? __('Una pregunta por pantalla') : __('Todo a la vista');
        case 'welcome':
            return s.welcome.enabled ? __('Encendida') : __('Apagada');
        case 'after':
            return s.redirect_url ? __('Lleva a tu página de gracias') : __('Mensaje de agradecimiento');
        case 'email':
            if (s.respondent_email_field_id === null) return __('Sin pregunta de correo');
            return [s.confirm_email ? __('Confirma el correo') : null, s.send_copy ? __('Manda una copia') : null].filter(Boolean).join(' · ') || __('Pregunta elegida');
        case 'limits': {
            const parts = [
                s.closes_at ? __('Hasta el %s').replace('%s', formatDateStr(s.closes_at)) : null,
                s.max_submissions ? __('%d respuestas').replace('%d', String(s.max_submissions)) : null,
            ].filter(Boolean);
            return parts.length ? parts.join(' · ') : __('Sin límite');
        }
        case 'save':
            return [s.save_progress.device ? __('En el dispositivo') : null, s.save_progress.email ? __('Por correo') : null].filter(Boolean).join(' · ') || __('Apagado');
        case 'charge':
            return formPaymentActive(config) ? __('Cobra al enviar') : formSubscriptionActive(config) ? __('Suscribe al enviar') : __('Apagado');
        case 'record':
            return s.edit_links.enabled ? __('Con enlaces para actualizar') : s.record_template_id !== null ? __('Desde una plantilla') : __('Crea un registro');
        case 'origin': {
            const rv = s.record_values;
            const parts = [
                s.attribution.enabled && s.attribution.page_url_field_id !== null ? __('Página') : null,
                rv.form_name_field_id !== null ? __('Nombre del formulario') : null,
                rv.fixed.length > 0 ? (rv.fixed.length === 1 ? __('1 valor fijo') : __('%d valores fijos').replace('%d', String(rv.fixed.length))) : null,
            ].filter(Boolean);
            return parts.length ? parts.join(' · ') : __('Sin guardar');
        }
        case 'security':
            return [s.captcha && captcha?.provider ? __('Anti-robots') : null, s.data_consent ? __('Autorización de datos') : null].filter(Boolean).join(' · ') || on(false);
        case 'embed':
            return [
                s.conversion.google_ads || s.conversion.meta_event ? __('Mide conversiones') : null,
                s.allow_prefill ? __('Respuestas desde la dirección') : null,
            ]
                .filter(Boolean)
                .join(' · ') || __('Apagado');
    }
}

export function MissingRequiredNotice({ missing }: { missing: FieldEntity[] }): JSX.Element | null {
    if (missing.length === 0) return null;
    return (
        <div className="imcrm-flex imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs" data-testid="form-missing-required">
            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
            <span>
                {__('La lista exige')} {missing.map((f) => `«${f.label}»`).join(', ')}{' '}
                {__('y el formulario puede no traerlo: esas respuestas no se van a poder guardar. Agrégalo como pregunta visible y sin condición, o quítale el «obligatorio» en la lista.')}
            </span>
        </div>
    );
}

/** El índice de grupos (izquierda en la computadora; la pantalla de «Ajustes» en el celular). */
export function SettingsIndex({
    active,
    onPick,
    config,
    captcha,
    missing,
}: {
    active: SettingsGroupId | null;
    onPick: (g: SettingsGroupId) => void;
    config: FormConfig;
    captcha: CaptchaAvailability | null;
    missing: FieldEntity[];
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-p-2" data-testid="form-settings-index">
            <MissingRequiredNotice missing={missing} />
            <nav aria-label={__('Ajustes del formulario')} className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                {SETTINGS_GROUPS.map((g) => {
                    const Icon = GROUP_ICON[g];
                    const on = active === g;
                    return (
                        <button
                            key={g}
                            type="button"
                            onClick={() => onPick(g)}
                            aria-current={on ? 'page' : undefined}
                            data-settings-group={g}
                            className={cn(
                                'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2 imcrm-py-2 imcrm-text-left',
                                on ? 'imcrm-bg-primary/10 imcrm-text-foreground' : 'hover:imcrm-bg-accent',
                            )}
                        >
                            <span className={cn('imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md', on ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-bg-muted imcrm-text-muted-foreground')}>
                                <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                            </span>
                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                <span className="imcrm-truncate imcrm-text-[13px] imcrm-font-medium">{__(SETTINGS_GROUP_INFO[g].title)}</span>
                                <span className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{groupSummary(g, config, captcha)}</span>
                            </span>
                            <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}

/** El encabezado de un grupo (título, para qué sirve). */
function GroupHeader({ group }: { group: SettingsGroupId }): JSX.Element {
    const Icon = GROUP_ICON[group];
    return (
        <div className="imcrm-flex imcrm-items-start imcrm-gap-2.5">
            <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                <Icon className="imcrm-h-4 imcrm-w-4" />
            </span>
            <div className="imcrm-min-w-0">
                <p className="imcrm-text-sm imcrm-font-semibold">{__(SETTINGS_GROUP_INFO[group].title)}</p>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__(SETTINGS_GROUP_INFO[group].hint)}</p>
            </div>
        </div>
    );
}

/** Lo de un grupo (derecha en la computadora). */
export function SettingsGroupPanel({ group, ctx, showHeader = true }: { group: SettingsGroupId; ctx: SettingsContext; showHeader?: boolean }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-4" data-testid="form-settings" data-settings-panel={group}>
            {showHeader && <GroupHeader group={group} />}
            {group === 'general' && <GeneralGroup ctx={ctx} />}
            {group === 'welcome' && (
                <WelcomeSettings config={ctx.config} fields={ctx.fields} onChange={ctx.onChange} previewWelcome={ctx.previewWelcome} onPreviewWelcome={ctx.onPreviewWelcome} bare />
            )}
            {group === 'after' && <AfterSubmitSettings ctx={ctx} bare />}
            {group === 'email' && <RespondentEmailSettings ctx={ctx} />}
            {group === 'limits' && <LimitsSettings ctx={ctx} />}
            {group === 'save' && <SaveProgressSettings config={ctx.config} onChange={ctx.onChange} />}
            {group === 'charge' && <ChargeSettings config={ctx.config} fields={ctx.fields} onChange={ctx.onChange} />}
            {group === 'record' && <RecordSettings ctx={ctx} />}
            {group === 'origin' && (
                <FormOriginSettings config={ctx.config} onChange={ctx.onChange} fields={ctx.fields} listId={ctx.listId} formName={ctx.name} takenFieldIds={takenByForm(ctx.config)} />
            )}
            {group === 'security' && (
                <>
                    <CaptchaSettings ctx={ctx} />
                    <DataConsentSettings ctx={ctx} />
                </>
            )}
            {group === 'embed' && <EmbedSettings ctx={ctx} />}
        </div>
    );
}

const PARTS: Array<[PageElementId, string]> = [
    ['@logo', 'Logo'],
    ['@title', 'Título'],
    ['@description', 'Descripción'],
    ['@submit', 'Botón de enviar'],
    ['@thanks', 'Agradecimiento'],
    ['@page', 'Fondo y página'],
];

function GeneralGroup({ ctx }: { ctx: SettingsContext }): JSX.Element {
    return (
        <>
            <MissingRequiredNotice missing={ctx.missing} />
            <Field label={__('Nombre interno')} hint={__('Sólo lo ve tu equipo.')}>
                <Input value={ctx.name} onChange={(e) => ctx.setName(e.target.value)} data-testid="form-internal-name" />
            </Field>
            <LayoutSettings config={ctx.config} onChange={ctx.onChange} />
            <Section title={__('Lo que se ve en el formulario')}>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('El título, el logo, el botón y todo lo que se ve se cambia tocándolo en la vista previa, o desde aquí:')}
                </p>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                    {PARTS.map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => ctx.onSelectElement(id)}
                            className="imcrm-rounded-full imcrm-border imcrm-border-border imcrm-px-2.5 imcrm-py-1 imcrm-text-[11px] hover:imcrm-bg-accent"
                            data-go-element={id}
                        >
                            {__(label)}
                        </button>
                    ))}
                </div>
            </Section>
            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                <Code2 className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                {__('Para avisarle a alguien de cada respuesta, arma una automatización con «Cuando se envía un formulario».')}
            </p>
        </>
    );
}

/** Lo que pasa al enviar (también en el panel de la pantalla de agradecimiento). */
export function AfterSubmitSettings({ ctx, bare }: { ctx: Pick<SettingsContext, 'config' | 'onChange' | 'fields'>; bare?: boolean }): JSX.Element {
    const { config, fields } = ctx;
    const s = config.settings;
    const set = (patch: Partial<FormConfig['settings']>): void => ctx.onChange(updateSettings(config, patch));
    const body = (
        <>
            <Field label={__('Título del agradecimiento')} hint={__('Para mostrar otro mensaje según lo que responde, agrega una pantalla final en «Lógica».')}>
                <Input value={s.success_title} onChange={(e) => set({ success_title: e.target.value })} data-testid="form-success-title" />
                <RecallPicker config={config} fields={fields} onPick={(t) => set({ success_title: withToken(s.success_title, t) })} />
            </Field>
            <Field label={__('Mensaje')}>
                <Textarea rows={2} value={s.success_message} onChange={(e) => set({ success_message: e.target.value })} />
                <RecallPicker config={config} fields={fields} onPick={(t) => set({ success_message: withToken(s.success_message, t) })} />
            </Field>
            <ThankYouUrlField
                value={s.redirect_url}
                delay={s.redirect_delay}
                onChange={(url) => set({ redirect_url: url })}
                onDelay={(n) => set({ redirect_delay: n })}
                variables={thankYouVariables(config, fields)}
                placeholder="https://tusitio.com/gracias"
                testId="form-redirect-url"
            />
            <Check label={__('Ofrecer «Enviar otra respuesta»')} checked={s.allow_another} onChange={(v) => set({ allow_another: v })} />
        </>
    );
    return bare ? <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">{body}</div> : <Section title={__('Después de enviar')}>{body}</Section>;
}

function RespondentEmailSettings({ ctx }: { ctx: SettingsContext }): JSX.Element {
    const { config, fields } = ctx;
    const s = config.settings;
    const set = (patch: Partial<FormConfig['settings']>): void => ctx.onChange(updateSettings(config, patch));
    const emails = emailQuestions(fields, config);
    const emailId = s.respondent_email_field_id !== null && emails.some((f) => f.id === s.respondent_email_field_id) ? s.respondent_email_field_id : null;
    /** Confirmar el correo: la pregunta queda obligatoria, visible y sin condición. */
    const setConfirm = (on: boolean): void => {
        let next = updateSettings(config, { confirm_email: on });
        if (on && emailId !== null) {
            const it = next.items.find((i) => i.type === 'field' && i.field_id === emailId);
            if (it) next = updateItem(next, it.id, { required: true, hidden: false, show_if: null });
        }
        ctx.onChange(next);
    };
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Pregunta con el correo')} hint={emails.length === 0 ? __('Agrega una pregunta de tipo email para usar estas opciones.') : undefined}>
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
            <Check label={__('Confirmar el correo con un clic')} checked={s.confirm_email && emailId !== null} disabled={emailId === null} onChange={setConfirm} testId="form-confirm-email" />
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
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Los correos salen por el correo de tu empresa y cuentan en su cuota mensual.')}</p>
        </div>
    );
}

function LimitsSettings({ ctx }: { ctx: SettingsContext }): JSX.Element {
    const s = ctx.config.settings;
    const set = (patch: Partial<FormConfig['settings']>): void => ctx.onChange(updateSettings(ctx.config, patch));
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <Field label={__('Hasta el día')} hint={__('Vacío = sin fecha de cierre.')}>
                <Input type="date" value={s.closes_at ?? ''} onChange={(e) => set({ closes_at: e.target.value || null })} data-testid="form-closes-at" />
            </Field>
            <Field label={__('Hasta un máximo de respuestas')} hint={__('Vacío = sin límite (cupos de un evento, por ejemplo).')}>
                <Input
                    type="number"
                    min={1}
                    value={s.max_submissions ?? ''}
                    onChange={(e) => set({ max_submissions: e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value))) })}
                    data-testid="form-max-submissions"
                />
            </Field>
            <Field label={__('Mensaje cuando está cerrado')}>
                <Textarea rows={2} value={s.closed_message} onChange={(e) => set({ closed_message: e.target.value })} />
            </Field>
        </div>
    );
}

function RecordSettings({ ctx }: { ctx: SettingsContext }): JSX.Element {
    const s = ctx.config.settings;
    const set = (patch: Partial<FormConfig['settings']>): void => ctx.onChange(updateSettings(ctx.config, patch));
    // C6 — el registro que crea el formulario puede salir de una plantilla.
    const recordTemplates = useRecordTemplates(ctx.listId, 'record');
    const templates = recordTemplates.data ?? [];
    return (
        <>
            <MissingRequiredNotice missing={ctx.missing} />
            <Section title={__('Registro que se crea')}>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Cada respuesta crea un registro en esta lista, con lo que la persona respondió en cada campo.')}
                </p>
                {templates.length > 0 || s.record_template_id !== null ? (
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
                            {templates.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name}
                                </option>
                            ))}
                            {s.record_template_id !== null && !templates.some((t) => t.id === s.record_template_id) && !recordTemplates.isLoading && (
                                <option value={s.record_template_id}>{__('Plantilla eliminada')}</option>
                            )}
                        </Select>
                    </Field>
                ) : (
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Si la lista tiene plantillas de registro, aquí puedes elegir una para que cada respuesta nazca con sus valores y checklists.')}
                    </p>
                )}
            </Section>
            <EditLinksSettings config={ctx.config} onChange={ctx.onChange} formId={ctx.formId} />
        </>
    );
}

export function CaptchaSettings({ ctx }: { ctx: Pick<SettingsContext, 'config' | 'onChange' | 'captcha'> }): JSX.Element {
    const s = ctx.config.settings;
    const captcha = ctx.captcha;
    const set = (patch: Partial<FormConfig['settings']>): void => ctx.onChange(updateSettings(ctx.config, patch));
    return (
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
    );
}

export function DataConsentSettings({ ctx }: { ctx: Pick<SettingsContext, 'config' | 'onChange' | 'dataConsent'> }): JSX.Element {
    const s = ctx.config.settings;
    const dataConsent = ctx.dataConsent;
    const set = (patch: Partial<FormConfig['settings']>): void => ctx.onChange(updateSettings(ctx.config, patch));
    return (
        <Section title={__('Datos personales')}>
            {dataConsent?.active ? (
                <>
                    <Check label={__('Pedir la autorización de tratamiento de datos')} checked={s.data_consent} onChange={(v) => set({ data_consent: v })} testId="form-data-consent" />
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
    );
}

function EmbedSettings({ ctx }: { ctx: SettingsContext }): JSX.Element {
    const { config } = ctx;
    const s = config.settings;
    const set = (patch: Partial<FormConfig['settings']>): void => ctx.onChange(updateSettings(config, patch));
    return (
        <>
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3" data-testid="form-settings-embed-card">
                <Code2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('¿Quieres ponerlo en tu sitio web?')}</p>
                    <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Metido en una página, en una ventana al hacer clic o en un botón flotante: elige la forma, mírala funcionando y copia el código en «Compartir».')}
                    </p>
                    {ctx.onOpenShare && (
                        <button
                            type="button"
                            className="imcrm-self-start imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                            onClick={() => ctx.onOpenShare?.('embed')}
                            data-testid="form-settings-open-embed"
                        >
                            {__('Abrir «Insertar en tu sitio»')}
                        </button>
                    )}
                </div>
            </div>
            <Section title={__('Respuestas desde la dirección')}>
                <Check label={__('Completar respuestas desde la dirección')} checked={s.allow_prefill} onChange={(v) => set({ allow_prefill: v })} />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Ej.: …?nombre=Ana&origen=instagram. Sirve para las preguntas ocultas que marcan de dónde vino cada respuesta.')}
                </p>
            </Section>
            <ConversionSettings
                kind="form"
                conversion={s.conversion}
                onChange={(patch) => set(patch)}
                calcs={s.calcs.map((c) => ({ key: c.key, name: c.name }))}
                canCharge={formPaymentActive(config)}
            />
        </>
    );
}

/** v0.1.374 — Los campos que el formulario ya escribe (preguntas y resultados de cálculos): no sirven para el origen. */
export function takenByForm(config: FormConfig): Set<number> {
    const out = new Set<number>();
    for (const i of config.items) {
        if (i.type === 'field') {
            out.add(i.field_id);
            if (i.other_field_id !== null) out.add(i.other_field_id);
        } else if (i.type === 'matrix') for (const r of i.rows) out.add(r.field_id);
    }
    for (const c of config.settings.calcs) if (c.save_field_id !== null) out.add(c.save_field_id);
    return out;
}

/** v0.1.374 — Las variables que se le pueden pasar a la página de gracias (nunca correo ni teléfono). */
export function thankYouVariables(config: FormConfig, fields: FieldEntity[]): Array<{ token: string; label: string }> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const answers = config.items.flatMap((i) => {
        if (i.type !== 'field') return [];
        const f = byId.get(i.field_id);
        if (!f || f.type === 'email' || f.type === 'phone') return [];
        return [{ token: f.slug, label: f.label }];
    });
    return [
        { token: 'envio.id', label: __('Id único del envío (para no contar dos veces)') },
        { token: 'valor', label: __('Valor de la conversión') },
        { token: 'moneda', label: __('Moneda del valor') },
        { token: 'utm_campaign', label: __('La campaña con la que llegó') },
        ...answers.slice(0, 8),
    ];
}

import { Copy, Eye, LayoutList, MessageSquare, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { formEstimateMinutes, type FormConfig, type FormLayout } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';
import { IMAGE_MAX_SIDE } from '@/lib/imageResize';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section } from '../../automations/email/EmailBlockInspector';
import { updateSettings } from '../formDesignOps';
import { ImageUpload } from './ImageUpload';
import { PaymentSettings } from './PaymentSettings';
import { SubscriptionSettings } from './SubscriptionSettings';
import { RecallPicker, withToken } from './LogicPanel';

const LAYOUTS: Array<{ value: FormLayout; title: string; hint: string; icon: typeof LayoutList }> = [
    { value: 'classic', title: 'Todo a la vista', hint: 'Las preguntas una debajo de otra (por páginas si las divides).', icon: LayoutList },
    { value: 'conversational', title: 'Una pregunta por pantalla', hint: 'Como una conversación: cada respuesta lleva a la siguiente.', icon: MessageSquare },
];

/**
 * v0.1.357 — Cómo empieza y cómo se responde el formulario: todo a la vista
 * o una pregunta por pantalla, y la pantalla de bienvenida.
 */
export function StartSettings({
    config,
    fields,
    onChange,
    previewWelcome,
    onPreviewWelcome,
    formId,
}: {
    config: FormConfig;
    fields: FieldEntity[];
    onChange: (next: FormConfig) => void;
    previewWelcome: boolean;
    onPreviewWelcome: (on: boolean) => void;
    /** v0.1.360 — el id del formulario (para la variable del enlace). */
    formId?: number;
}): JSX.Element {
    const s = config.settings;
    const w = s.welcome;
    const setWelcome = (patch: Partial<FormConfig['settings']['welcome']>): void => onChange(updateSettings(config, { welcome: { ...w, ...patch } }));
    const minutes = formEstimateMinutes(config);
    const sp = s.save_progress;
    const setSave = (patch: Partial<FormConfig['settings']['save_progress']>): void => onChange(updateSettings(config, { save_progress: { ...sp, ...patch } }));
    return (
        <>
            <Section title={__('Cómo se responde')}>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2" role="radiogroup" aria-label={__('Cómo se responde')} data-testid="form-layout" data-tour="form-layout">
                    {LAYOUTS.map((l) => {
                        const on = s.layout === l.value;
                        const Icon = l.icon;
                        return (
                            <button
                                key={l.value}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => onChange(updateSettings(config, { layout: l.value }))}
                                className={cn(
                                    'imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-p-2 imcrm-text-left imcrm-transition-colors',
                                    on ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent',
                                )}
                                data-testid={`form-layout-${l.value}`}
                            >
                                <Icon className={cn('imcrm-h-4 imcrm-w-4', on ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')} />
                                <span className="imcrm-text-xs imcrm-font-medium">{__(l.title)}</span>
                                <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__(l.hint)}</span>
                            </button>
                        );
                    })}
                </div>
                {s.layout === 'conversational' && (
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Al elegir una opción, una escala o Sí/No pasa sola a la siguiente; en lo demás, con «Siguiente» o Enter. Los títulos y textos aparecen junto a la pregunta que sigue, y los saltos de página siguen funcionando.')}
                    </p>
                )}
            </Section>

            <Section title={__('Bienvenida')}>
                <Check label={__('Mostrar una pantalla de bienvenida')} checked={w.enabled} onChange={(v) => setWelcome({ enabled: v })} />
                {w.enabled && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="form-welcome-settings">
                        <Button
                            variant={previewWelcome ? 'secondary' : 'outline'}
                            size="sm"
                            className="imcrm-self-start"
                            onClick={() => onPreviewWelcome(!previewWelcome)}
                            aria-pressed={previewWelcome}
                            data-testid="form-welcome-preview"
                        >
                            <Eye className="imcrm-h-3.5 imcrm-w-3.5" />
                            {previewWelcome ? __('Viendo la bienvenida') : __('Ver la bienvenida')}
                        </Button>
                        <Field label={__('Título')} hint={__('Vacío = el título del formulario.')}>
                            <Input value={w.title} maxLength={200} onChange={(e) => setWelcome({ title: e.target.value })} data-testid="form-welcome-title" />
                            <RecallPicker config={config} fields={fields} onPick={(t) => setWelcome({ title: withToken(w.title, t) })} />
                        </Field>
                        <Field label={__('Mensaje')}>
                            <Textarea rows={3} value={w.message} maxLength={2000} onChange={(e) => setWelcome({ message: e.target.value })} data-testid="form-welcome-message" />
                        </Field>
                        <Field label={__('Texto del botón')}>
                            <Input value={w.button_label} maxLength={60} placeholder={__('Empezar')} onChange={(e) => setWelcome({ button_label: e.target.value })} />
                        </Field>
                        <ImageUpload
                            label={__('Imagen (opcional)')}
                            fileId={w.file_id}
                            maxSide={IMAGE_MAX_SIDE.item}
                            onChange={(id) => setWelcome({ file_id: id })}
                            hint={__('Una foto o ilustración arriba del título.')}
                            testId="form-welcome-image"
                        />
                        <Check
                            label={__('Decir cuánto toma: «Toma unos %s minutos»').replace('%s', String(minutes))}
                            checked={w.show_time}
                            onChange={(v) => setWelcome({ show_time: v })}
                        />
                    </div>
                )}
            </Section>

            <Section title={__('Guardar el avance')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-save-progress" data-tour="form-save-progress">
                    <Check
                        label={__('Recordar lo que van respondiendo en ese dispositivo')}
                        checked={sp.device}
                        onChange={(v) => setSave({ device: v })}
                    />
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Si cierran la página sin enviar, al volver les ofrece «Continuar» donde quedaron. Queda sólo en ese navegador. Apágalo si el formulario se llena en un computador compartido (una recepción, un evento).')}
                    </p>
                    <Check label={__('Botón «Guardar y seguir después»')} checked={sp.email} onChange={(v) => setSave({ email: v })} />
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Les manda un enlace al correo para terminarlo en otro momento o en otro dispositivo (dura 30 días). Sale por el correo de la empresa. Los archivos y la firma no se guardan.')}
                    </p>
                </div>
            </Section>

            <PaymentSettings config={config} fields={fields} onChange={onChange} />
            <SubscriptionSettings config={config} fields={fields} onChange={onChange} />

            <EditLinksSettings config={config} onChange={onChange} formId={formId} />
        </>
    );
}

/**
 * v0.1.360 — Enlaces para que alguien actualice SU registro con este
 * formulario: se encienden aquí, se mandan desde la ficha («Enlace para
 * actualizar») o desde una automatización con la variable.
 */
function EditLinksSettings({ config, onChange, formId }: { config: FormConfig; onChange: (next: FormConfig) => void; formId?: number }): JSX.Element {
    const el = config.settings.edit_links;
    const set = (patch: Partial<FormConfig['settings']['edit_links']>): void => onChange(updateSettings(config, { edit_links: { ...el, ...patch } }));
    const [copied, setCopied] = useState(false);
    const [revoked, setRevoked] = useState(false);
    const token = formId ? `{{formulario.${formId}.enlace}}` : '';
    return (
        <Section title={__('Actualizar un registro')}>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-edit-links" data-tour="form-edit-links">
                <Check label={__('Permitir enlaces para actualizar un registro')} checked={el.enabled} onChange={(v) => set({ enabled: v })} />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Mándale a un cliente un enlace que abre este formulario con sus datos ya puestos; al enviarlo, se actualiza su registro en vez de crear otro. Sirve para «actualiza tus datos», completar lo que falta o confirmar una inscripción.')}
                </p>
                {el.enabled && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                        <Field label={__('Cada enlace dura (días)')} hint={__('Pasado ese tiempo deja de servir y hay que mandar otro.')}>
                            <Input
                                type="number"
                                min={1}
                                max={365}
                                value={el.days}
                                onChange={(e) => {
                                    const n = Math.round(Number(e.target.value));
                                    if (Number.isFinite(n)) set({ days: Math.min(365, Math.max(1, n)) });
                                }}
                                data-testid="form-edit-days"
                            />
                        </Field>
                        <Field label={__('Mensaje al guardar')} hint={__('Vacío: «¡Listo! Guardamos tus cambios.»')}>
                            <Textarea rows={2} value={el.message} onChange={(e) => set({ message: e.target.value })} data-testid="form-edit-message" />
                        </Field>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            <span>
                                {__('Cómo se manda: en la ficha del registro, «Enlace para actualizar»; o en un correo, WhatsApp o SMS de una automatización con esta variable:')}
                            </span>
                            {token && (
                                <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                    <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11px] imcrm-text-foreground" data-testid="form-edit-token">
                                        {token}
                                    </code>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="imcrm-h-6 imcrm-gap-1 imcrm-px-1.5 imcrm-text-[11px]"
                                        onClick={() => {
                                            void navigator.clipboard?.writeText(token).then(() => {
                                                setCopied(true);
                                                window.setTimeout(() => setCopied(false), 1500);
                                            });
                                        }}
                                    >
                                        <Copy className="imcrm-h-3 imcrm-w-3" />
                                        {copied ? __('Copiada') : __('Copiar')}
                                    </Button>
                                </span>
                            )}
                            <span>{__('Lo que el formulario no pregunta no se toca. Una pregunta que la persona deja vacía borra ese dato; un archivo o una firma se quedan si no sube otros.')}</span>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="imcrm-gap-1.5 imcrm-self-start imcrm-text-xs"
                            data-testid="form-edit-revoke"
                            onClick={() => {
                                set({ version: Math.min(1_000_000, el.version + 1) });
                                setRevoked(true);
                            }}
                        >
                            <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Invalidar los enlaces ya enviados')}
                        </Button>
                        {revoked && (
                            <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-400">
                                {__('Al guardar, los enlaces que ya mandaste dejan de servir. Los nuevos funcionan normal.')}
                            </p>
                        )}
                    </div>
                )}
            </div>
        </Section>
    );
}

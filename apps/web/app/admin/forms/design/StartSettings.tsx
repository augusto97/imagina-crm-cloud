import { Eye, LayoutList, MessageSquare } from 'lucide-react';

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
}: {
    config: FormConfig;
    fields: FieldEntity[];
    onChange: (next: FormConfig) => void;
    previewWelcome: boolean;
    onPreviewWelcome: (on: boolean) => void;
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
        </>
    );
}

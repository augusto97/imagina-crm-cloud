import { useRef } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, X } from 'lucide-react';
import {
    WIDGET_ICONS,
    WIDGET_MAX_ADVISORS,
    WIDGET_TYPE_INFO,
    widgetButtonIcon,
    widgetButtonLabel,
    type ContactWidgetOptions,
    type WidgetAdvisor,
    type WidgetButton,
    type WidgetIcon,
    type WidgetProblem,
    type WidgetWhen,
} from '@imagina-base/shared';

import { Row, Toggle } from '@/admin/records/layout/editor/inspectorUi';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { WIDGET_ICON_LABEL, WidgetIconView } from './WidgetIconView';
import { addAdvisor, startAdvisors, stopAdvisors, updateAdvisor, whatsappVars } from './widgetEditor';

const WHEN_LABEL: Record<WidgetWhen, string> = {
    always: 'Siempre',
    open: 'Sólo en horario',
    closed: 'Sólo fuera de horario',
};

/**
 * v0.1.394 (ADR-S99) — Un botón del widget: lo que hace y cómo se ve. Plegado
 * muestra su nombre y lo que falta; abierto, los datos de su tipo.
 */
export function WidgetButtonEditor({
    button,
    options,
    problems,
    open,
    first,
    last,
    onToggle,
    onChange,
    onMove,
    onRemove,
    hoursEnabled = false,
}: {
    button: WidgetButton;
    options: ContactWidgetOptions;
    problems: WidgetProblem[];
    /** v0.1.395 — con el horario de atención activo, cada botón elige cuándo se ve. */
    hoursEnabled?: boolean;
    open: boolean;
    first: boolean;
    last: boolean;
    onToggle: () => void;
    onChange: (patch: Partial<WidgetButton>) => void;
    onMove: (delta: -1 | 1) => void;
    onRemove: () => void;
}): JSX.Element {
    const info = WIDGET_TYPE_INFO[button.type];
    const color = button.color ?? info.color ?? null;
    return (
        <div
            className={cn('imcrm-rounded-xl imcrm-border imcrm-bg-card', open ? 'imcrm-border-primary/40 imcrm-shadow-imcrm-sm' : 'imcrm-border-border')}
            data-testid="widget-button"
            data-button-type={button.type}
        >
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-2.5">
                <button type="button" onClick={onToggle} className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2.5 imcrm-text-left" aria-expanded={open}>
                    <span
                        className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-foreground/70"
                        style={color ? { background: color, color: '#fff' } : undefined}
                    >
                        <WidgetIconView icon={widgetButtonIcon(button)} />
                    </span>
                    <span className="imcrm-min-w-0 imcrm-flex-1">
                        <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium">{widgetButtonLabel(button)}</span>
                        <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                            {[
                                button.type === 'whatsapp' && button.capture_form_id !== null ? __('WhatsApp con datos primero') : __(info.label),
                                button.type === 'whatsapp' && button.advisors.length > 1 ? sprintfPeople(button.advisors.length) : null,
                                hoursEnabled && button.when !== 'always' ? __(WHEN_LABEL[button.when]) : null,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                    </span>
                    {problems.length > 0 && <AlertTriangle className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" aria-label={__('Le falta algo')} />}
                    <ChevronDown className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-transform', open && 'imcrm-rotate-180')} />
                </button>
                <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center">
                    <IconAction label={__('Subir')} disabled={first} onClick={() => onMove(-1)}>
                        <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                    </IconAction>
                    <IconAction label={__('Bajar')} disabled={last} onClick={() => onMove(1)}>
                        <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                    </IconAction>
                    <IconAction label={__('Quitar el botón')} onClick={onRemove} danger>
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </IconAction>
                </div>
            </div>
            {open && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-p-3">
                    {problems.length > 0 && (
                        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-lg imcrm-bg-warning/10 imcrm-p-2 imcrm-text-xs imcrm-text-foreground" data-testid="widget-button-problems">
                            {problems.map((p, i) => (
                                <li key={i} className="imcrm-flex imcrm-gap-1.5">
                                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                    {p.message.replace(/^«[^»]*»: /, '')}
                                </li>
                            ))}
                        </ul>
                    )}
                    <TypeFields button={button} options={options} onChange={onChange} />
                    {hoursEnabled && (
                        <Row label={__('Cuándo se ve')} hint={__('Según el horario de atención del widget (pestaña Horario).')}>
                            <Select value={button.when} onChange={(e) => onChange({ when: e.target.value as WidgetWhen })} data-testid="widget-button-when">
                                {(Object.keys(WHEN_LABEL) as WidgetWhen[]).map((w) => (
                                    <option key={w} value={w}>
                                        {__(WHEN_LABEL[w])}
                                    </option>
                                ))}
                            </Select>
                        </Row>
                    )}
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <Row label={__('Nombre del botón')}>
                            <Input value={button.label} maxLength={60} placeholder={info.label} onChange={(e) => onChange({ label: e.target.value })} data-testid="widget-button-label" />
                        </Row>
                        <Row label={__('Una línea debajo (opcional)')}>
                            <Input
                                value={button.description}
                                maxLength={140}
                                placeholder={button.type === 'whatsapp' ? __('Respondemos en minutos') : ''}
                                onChange={(e) => onChange({ description: e.target.value })}
                            />
                        </Row>
                    </div>
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <Row label={__('Ícono')}>
                            <IconSelect value={button.icon} fallback={info.icon} onChange={(icon) => onChange({ icon })} />
                        </Row>
                        <Row label={__('Color')}>
                            <ColorChoice value={button.color} fallbackLabel={info.color ? __('El de WhatsApp') : __('El del widget')} onChange={(c) => onChange({ color: c })} />
                        </Row>
                    </div>
                </div>
            )}
        </div>
    );
}

function TypeFields({
    button,
    options,
    onChange,
}: {
    button: WidgetButton;
    options: ContactWidgetOptions;
    onChange: (patch: Partial<WidgetButton>) => void;
}): JSX.Element | null {
    const message = useRef<HTMLTextAreaElement | null>(null);
    switch (button.type) {
        case 'whatsapp': {
            const capture = options.forms.find((f) => f.id === button.capture_form_id) ?? null;
            const insertVar = (key: string): void => {
                const el = message.current;
                const token = `{{${key}}}`;
                const at = el ? el.selectionStart ?? button.message.length : button.message.length;
                const next = button.message.slice(0, at) + token + button.message.slice(at);
                onChange({ message: next.slice(0, 1000) });
                window.requestAnimationFrame(() => {
                    el?.focus();
                    el?.setSelectionRange(at + token.length, at + token.length);
                });
            };
            const many = button.advisors.length > 0;
            return (
                <>
                    {!many && (
                        <Row label={__('Tu número de WhatsApp')} hint={__('Con el indicativo del país. No se muestra en tu sitio: el botón pasa por la app y abre WhatsApp.')}>
                            <Input value={button.phone} placeholder="+57 300 123 4567" inputMode="tel" onChange={(e) => onChange({ phone: e.target.value })} data-testid="widget-button-phone" />
                        </Row>
                    )}
                    <AdvisorsBlock button={button} options={options} onChange={onChange} />
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-2.5" data-tour="widget-capture">
                        <Toggle
                            label={__('Pedir sus datos antes de abrir WhatsApp')}
                            hint={__('La persona llena un formulario corto (por ejemplo, nombre y celular), queda como registro en tu lista y después se abre WhatsApp con el mensaje armado con sus respuestas.')}
                            checked={button.capture_form_id !== null}
                            onChange={(on) =>
                                onChange({ capture_form_id: on ? options.forms.find((f) => f.enabled)?.id ?? options.forms[0]?.id ?? null : null })
                            }
                        />
                        {button.capture_form_id !== null && (
                            <Row label={__('Formulario')}>
                                <FormSelect options={options} value={button.capture_form_id} onChange={(id) => onChange({ capture_form_id: id, assign_field_id: null })} testId="widget-capture-form" />
                            </Row>
                        )}
                        {button.capture_form_id !== null && (
                            <Toggle
                                label={__('Abrirlo como un chat')}
                                hint={__('Una pregunta por burbuja, como una conversación. Apágalo para verlo como lo armaste.')}
                                checked={button.as_chat}
                                onChange={(v) => onChange({ as_chat: v })}
                            />
                        )}
                        {button.capture_form_id !== null && many && capture && (
                            <Row
                                label={__('Asignar el registro a quien atiende')}
                                hint={
                                    (capture.person_fields ?? []).length === 0
                                        ? __('La lista del formulario no tiene un campo «Persona». Agrégale uno para que cada registro quede a nombre de quien lo atiende.')
                                        : __('Sólo para las personas vinculadas a alguien del equipo.')
                                }
                            >
                                <Select
                                    value={button.assign_field_id ?? ''}
                                    onChange={(e) => onChange({ assign_field_id: e.target.value ? Number(e.target.value) : null })}
                                    disabled={(capture.person_fields ?? []).length === 0}
                                    data-testid="widget-assign-field"
                                >
                                    <option value="">{__('No asignar')}</option>
                                    {(capture.person_fields ?? []).map((pf) => (
                                        <option key={pf.id} value={pf.id}>
                                            {pf.label}
                                        </option>
                                    ))}
                                </Select>
                            </Row>
                        )}
                        {capture && !capture.asks_phone && (
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Este formulario no pregunta un celular. Si quieres escribirle después por WhatsApp desde la app, agrégale esa pregunta.')}
                            </p>
                        )}
                        {options.forms.length === 0 && (
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Todavía no tienes formularios. Se arman en los Ajustes de cada lista → Formularios.')}
                            </p>
                        )}
                    </div>
                    <Row label={__('Mensaje que ya va escrito')} hint={__('La persona lo puede cambiar antes de enviarlo.')}>
                        <Textarea
                            ref={message}
                            rows={3}
                            value={button.message}
                            maxLength={1000}
                            onChange={(e) => onChange({ message: e.target.value })}
                            data-testid="widget-button-message"
                        />
                        <div className="imcrm-mt-1.5 imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                            {whatsappVars(button, options).map((v) => (
                                <button
                                    key={v.key}
                                    type="button"
                                    onClick={() => insertVar(v.key)}
                                    title={`{{${v.key}}}`}
                                    className="imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-border-primary/40 hover:imcrm-text-foreground"
                                    data-testid="widget-message-var"
                                >
                                    + {v.label}
                                </button>
                            ))}
                        </div>
                    </Row>
                </>
            );
        }
        case 'form':
            return (
                <>
                    <Row label={__('Formulario que se abre')} hint={__('Se abre dentro del panel. Lo que llenen queda como registro en su lista.')}>
                        <FormSelect options={options} value={button.form_id} onChange={(id) => onChange({ form_id: id })} testId="widget-form" />
                    </Row>
                    <Toggle
                        label={__('Abrirlo como un chat')}
                        hint={__('Una pregunta por burbuja, como una conversación. Apágalo para verlo como lo armaste.')}
                        checked={button.as_chat}
                        onChange={(v) => onChange({ as_chat: v })}
                    />
                </>
            );
        case 'booking':
            return (
                <Row label={__('Agenda que se abre')} hint={__('La persona elige el día y la hora sin salir de tu sitio.')}>
                    <Select
                        value={button.booking_page_id ?? ''}
                        onChange={(e) => onChange({ booking_page_id: e.target.value ? Number(e.target.value) : null })}
                        data-testid="widget-booking"
                    >
                        <option value="">{__('Elige una agenda')}</option>
                        {options.bookings.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name} · {b.list_name}
                                {b.enabled ? '' : ` (${__('sin publicar')})`}
                            </option>
                        ))}
                    </Select>
                    {options.bookings.length === 0 && (
                        <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-text-muted-foreground">{__('Todavía no tienes agendas. Se arman en los Ajustes de cada lista → Agenda.')}</p>
                    )}
                </Row>
            );
        case 'call':
            return (
                <Row label={__('Número')} hint={__('Con el indicativo del país. En el celular llama directo.')}>
                    <Input value={button.phone} placeholder="+57 601 234 5678" inputMode="tel" onChange={(e) => onChange({ phone: e.target.value })} />
                </Row>
            );
        case 'email':
            return (
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    <Row label={__('Correo')}>
                        <Input value={button.email} type="email" placeholder="hola@tuempresa.com" onChange={(e) => onChange({ email: e.target.value })} />
                    </Row>
                    <Row label={__('Asunto (opcional)')}>
                        <Input value={button.subject} maxLength={200} onChange={(e) => onChange({ subject: e.target.value })} />
                    </Row>
                </div>
            );
        case 'link':
            return (
                <>
                    <Row label={__('Enlace')} hint={__('Tu catálogo, tienda, preguntas frecuentes… Tiene que empezar con https://.')}>
                        <Input value={button.url} placeholder="https://" onChange={(e) => onChange({ url: e.target.value })} />
                    </Row>
                    <Toggle label={__('Abrir en otra pestaña')} checked={button.new_tab} onChange={(v) => onChange({ new_tab: v })} />
                </>
            );
    }
}

function sprintfPeople(n: number): string {
    return __('%d personas').replace('%d', String(n));
}

/**
 * v0.1.395 — Varias personas atienden el WhatsApp del botón: cada una con su
 * número (y, si es del equipo, su usuario para asignarle el registro). El
 * servidor reparte por turnos o al azar; nadie ve la lista en el sitio.
 */
function AdvisorsBlock({ button, options, onChange }: { button: WidgetButton; options: ContactWidgetOptions; onChange: (patch: Partial<WidgetButton>) => void }): JSX.Element {
    const many = button.advisors.length > 0;
    const set = (advisors: WidgetAdvisor[]): void => onChange({ advisors });
    const members = options.members ?? [];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-2.5" data-tour="widget-advisors">
            <Toggle
                label={__('Varias personas atienden')}
                hint={__('Cada conversación le llega a una persona distinta (por turnos o al azar). Sus números no se ven en tu sitio.')}
                checked={many}
                onChange={(on) => onChange(on ? { advisors: startAdvisors(button), phone: '' } : stopAdvisors(button))}
            />
            {many && (
                <>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="widget-advisors">
                        {button.advisors.map((a, i) => (
                            <li key={a.id} className="imcrm-grid imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2 sm:imcrm-grid-cols-[1fr_1fr_auto]" data-testid="widget-advisor">
                                <Input
                                    value={a.name}
                                    maxLength={60}
                                    placeholder={__('Nombre (ej. Ana)')}
                                    aria-label={__('Nombre de la persona %d').replace('%d', String(i + 1))}
                                    onChange={(e) => set(updateAdvisor(button.advisors, a.id, { name: e.target.value }))}
                                    data-testid="widget-advisor-name"
                                />
                                <Input
                                    value={a.phone}
                                    inputMode="tel"
                                    placeholder="+57 300 123 4567"
                                    aria-label={__('WhatsApp de la persona %d').replace('%d', String(i + 1))}
                                    onChange={(e) => set(updateAdvisor(button.advisors, a.id, { phone: e.target.value }))}
                                    data-testid="widget-advisor-phone"
                                />
                                <button
                                    type="button"
                                    onClick={() => (button.advisors.length === 1 ? onChange(stopAdvisors(button)) : set(button.advisors.filter((x) => x.id !== a.id)))}
                                    className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-self-center imcrm-justify-self-end imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-destructive"
                                    aria-label={__('Quitar a esta persona')}
                                    title={__('Quitar a esta persona')}
                                >
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </button>
                                {members.length > 0 && (
                                    <Select
                                        value={a.user_id ?? ''}
                                        onChange={(e) => {
                                            const id = e.target.value ? Number(e.target.value) : null;
                                            const m = members.find((x) => x.id === id);
                                            set(updateAdvisor(button.advisors, a.id, { user_id: id, name: a.name || m?.name || '' }));
                                        }}
                                        className="sm:imcrm-col-span-3"
                                        aria-label={__('Persona del equipo')}
                                        data-testid="widget-advisor-user"
                                    >
                                        <option value="">{__('No es del equipo (sólo su número)')}</option>
                                        {members.map((m) => (
                                            <option key={m.id} value={m.id}>
                                                {m.name}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                            </li>
                        ))}
                    </ul>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <button
                            type="button"
                            onClick={() => set(addAdvisor(button.advisors))}
                            disabled={button.advisors.length >= WIDGET_MAX_ADVISORS}
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline disabled:imcrm-opacity-40"
                            data-testid="widget-advisor-add"
                        >
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Agregar otra persona')}
                        </button>
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Reparto')}
                            <Select
                                value={button.rotation}
                                onChange={(e) => onChange({ rotation: e.target.value as WidgetButton['rotation'] })}
                                className="imcrm-h-8 imcrm-w-auto imcrm-text-xs"
                                data-testid="widget-advisor-rotation"
                            >
                                <option value="round_robin">{__('Por turnos')}</option>
                                <option value="random">{__('Al azar')}</option>
                            </Select>
                        </label>
                    </div>
                </>
            )}
        </div>
    );
}

function FormSelect({
    options,
    value,
    onChange,
    testId,
}: {
    options: ContactWidgetOptions;
    value: number | null;
    onChange: (id: number | null) => void;
    testId: string;
}): JSX.Element {
    return (
        <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} data-testid={testId}>
            <option value="">{__('Elige un formulario')}</option>
            {options.forms.map((f) => (
                <option key={f.id} value={f.id}>
                    {f.name} · {f.list_name}
                    {f.enabled ? '' : ` (${__('sin publicar')})`}
                </option>
            ))}
        </Select>
    );
}

export function IconSelect({ value, fallback, onChange }: { value: WidgetIcon | null; fallback?: WidgetIcon; onChange: (v: WidgetIcon | null) => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1" role="radiogroup" aria-label={__('Ícono')}>
            {fallback && (
                <button
                    type="button"
                    role="radio"
                    aria-checked={value === null}
                    onClick={() => onChange(null)}
                    className={cn(
                        'imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1 imcrm-text-[11px]',
                        value === null ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium' : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-text-foreground',
                    )}
                >
                    {__('El del tipo')}
                </button>
            )}
            {WIDGET_ICONS.map((icon) => (
                <button
                    key={icon}
                    type="button"
                    role="radio"
                    aria-checked={value === icon}
                    aria-label={WIDGET_ICON_LABEL[icon]}
                    title={WIDGET_ICON_LABEL[icon]}
                    onClick={() => onChange(icon)}
                    className={cn(
                        'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border',
                        value === icon ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-foreground' : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-text-foreground',
                    )}
                >
                    <WidgetIconView icon={icon} className="imcrm-h-3.5 imcrm-w-3.5" />
                </button>
            ))}
        </div>
    );
}

export function ColorChoice({ value, fallbackLabel, onChange }: { value: string | null; fallbackLabel: string; onChange: (v: string | null) => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
            <button
                type="button"
                onClick={() => onChange(null)}
                aria-pressed={value === null}
                className={cn(
                    'imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-1 imcrm-text-[11px]',
                    value === null ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium' : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-text-foreground',
                )}
            >
                {fallbackLabel}
            </button>
            <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                <input
                    type="color"
                    value={value ?? '#2563eb'}
                    onChange={(e) => onChange(e.target.value.toLowerCase())}
                    className="imcrm-h-7 imcrm-w-9 imcrm-cursor-pointer imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-transparent"
                    aria-label={__('Otro color')}
                />
                {value ? value : __('Otro color')}
            </label>
        </div>
    );
}

function IconAction({
    label,
    onClick,
    disabled,
    danger,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30 disabled:hover:imcrm-bg-transparent',
                danger ? 'hover:imcrm-text-destructive' : 'hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}

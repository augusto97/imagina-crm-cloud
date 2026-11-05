import {
    AlignLeft,
    Building2,
    CalendarDays,
    Eye,
    EyeOff,
    Heading1,
    LayoutTemplate,
    ListChecks,
    MapPin,
    Minus,
    MousePointerClick,
    Paintbrush,
    PartyPopper,
    Scale,
    ShieldCheck,
    SquareDashed,
    Tag,
    TrendingUp,
    Users,
    type LucideIcon,
} from 'lucide-react';
import { bookingLabel, type BookingConfig } from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { BOOKING_ELEMENTS, bookingElementVisible, setBookingElementVisible, type BookingElementId } from './bookingElements';

/**
 * v0.1.378 — «Contenido» del constructor de la agenda: la página en el orden
 * en que la recorre el cliente — el encabezado, los pasos (servicio, quién
 * atiende, fecha y hora, sus datos, la confirmación), lo que va en «Tus
 * datos» y la página. Cada fila se toca para editarla (y la vista previa va
 * a ese paso); si se puede ocultar, tiene su ojo.
 */

const ICON: Record<BookingElementId, LucideIcon> = {
    '@page': Paintbrush,
    '@card': SquareDashed,
    '@cover': LayoutTemplate,
    '@band': Minus,
    '@logo': Building2,
    '@title': Heading1,
    '@description': AlignLeft,
    '@location': MapPin,
    '@progress': TrendingUp,
    '@services': Tag,
    '@staff': Users,
    '@calendar': CalendarDays,
    '@details': ListChecks,
    '@consent': Scale,
    '@captcha': ShieldCheck,
    '@submit': MousePointerClick,
    '@done': PartyPopper,
};

/** Lo que dice una fila apagada (en «Quién atiende» no es «oculto»: se asigna solo). */
const OFF_TEXT: Partial<Record<BookingElementId, string>> = {
    '@staff': 'se asigna solo',
    '@consent': 'no se pide',
    '@captcha': 'no se pide',
};

/** Para las capturas del centro de aprendizaje (el nombre de la sección de antes). */
const LEGACY_SECTION: Partial<Record<BookingElementId, string>> = {
    '@services': 'servicios',
    '@staff': 'atienden',
};

export function BookingOutline({
    config,
    pageName,
    selected,
    onSelect,
    onChange,
    withProblems,
    hasLogo,
    captchaReady,
    consentActive,
}: {
    config: BookingConfig;
    pageName: string;
    selected: BookingElementId | null;
    onSelect: (id: BookingElementId) => void;
    onChange: (next: BookingConfig) => void;
    /** Las partes donde falta algo para publicar (punto rojo). */
    withProblems: ReadonlySet<BookingElementId>;
    hasLogo: boolean;
    captchaReady: boolean;
    consentActive: boolean;
}): JSX.Element {
    const s = config.settings;
    const activeServices = config.services.filter((x) => x.active).length;
    const activeStaff = config.staff.filter((x) => x.active).length;
    const questions = config.questions.filter((q) => q.type === 'field').length;
    // Sin llaves del captcha o sin autorización en la empresa, el ojo no la enciende.
    const locked = (id: BookingElementId): boolean => (id === '@captcha' && !captchaReady && !s.captcha) || (id === '@consent' && !consentActive && !s.data_consent);
    const row = (id: BookingElementId, detail?: string, step?: number): JSX.Element => (
        <Row
            key={id}
            id={id}
            detail={detail}
            step={step}
            config={config}
            selected={selected === id}
            problem={withProblems.has(id)}
            locked={locked(id)}
            onSelect={onSelect}
            onChange={onChange}
        />
    );
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-p-2" data-testid="booking-outline" data-tour="booking-outline">
            <p className="imcrm-px-1.5 imcrm-pt-1 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {__('Toca una parte aquí o en la vista previa para editarla. El ojo la oculta.')}
            </p>
            <GroupLabel>{__('Encabezado')}</GroupLabel>
            {row('@logo', hasLogo ? __('El de la empresa') : __('Sin logo cargado'))}
            {row('@title', s.title || pageName)}
            {row('@description', s.description.split('\n')[0] || __('Sin descripción'))}
            {row('@location', s.location || __('Sin lugar'))}
            {row('@band')}
            {row('@cover')}

            <GroupLabel>{__('Pasos del cliente')}</GroupLabel>
            {row('@services', activeServices === 1 ? __('1 servicio') : `${activeServices} ${__('servicios')}`, 1)}
            {row('@staff', activeStaff === 1 ? __('1 persona o recurso') : `${activeStaff} ${__('personas o recursos')}`, 2)}
            {row('@calendar', bookingLabel(s.labels, 'date'), 3)}
            {row('@details', questions === 0 ? __('Nombre, correo y teléfono') : `${__('Nombre, correo y')} ${questions} ${questions === 1 ? __('pregunta más') : __('preguntas más')}`, 4)}
            {row('@done', bookingLabel(s.labels, 'done'), 5)}

            <GroupLabel>{__('En «Tus datos»')}</GroupLabel>
            {row('@consent', consentActive ? undefined : __('sin activar en la empresa'))}
            {row('@captcha', captchaReady ? undefined : __('sin llaves cargadas'))}
            {row('@submit', `«${bookingLabel(s.labels, 'submit')}»`)}

            <GroupLabel>{__('Página')}</GroupLabel>
            {row('@progress')}
            {row('@card')}
            {row('@page')}
        </div>
    );
}

function GroupLabel({ children }: { children: React.ReactNode }): JSX.Element {
    return <p className="imcrm-px-1.5 imcrm-pb-0.5 imcrm-pt-3 imcrm-text-[10.5px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{children}</p>;
}

function Row({
    id,
    detail,
    step,
    config,
    selected,
    problem,
    locked,
    onSelect,
    onChange,
}: {
    id: BookingElementId;
    detail?: string;
    step?: number;
    config: BookingConfig;
    selected: boolean;
    problem: boolean;
    locked: boolean;
    onSelect: (id: BookingElementId) => void;
    onChange: (next: BookingConfig) => void;
}): JSX.Element {
    const Icon = ICON[id];
    const visible = bookingElementVisible(config, id);
    const off = visible === false;
    const label = __(BOOKING_ELEMENTS[id].label);
    return (
        <div
            className={cn(
                'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-transparent imcrm-pr-1',
                selected ? 'imcrm-border-primary/40 imcrm-bg-primary/5' : 'hover:imcrm-bg-accent',
            )}
            data-outline-element={id}
            data-booking-section={LEGACY_SECTION[id]}
        >
            <button type="button" onClick={() => onSelect(id)} className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-px-1.5 imcrm-py-1.5 imcrm-text-left">
                {step !== undefined ? (
                    <span className="imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-[10px] imcrm-font-semibold imcrm-text-primary">{step}</span>
                ) : (
                    <Icon className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0', off ? 'imcrm-text-muted-foreground/50' : 'imcrm-text-muted-foreground')} />
                )}
                <span className={cn('imcrm-shrink-0 imcrm-text-sm', off && !OFF_TEXT[id] && 'imcrm-text-muted-foreground imcrm-line-through imcrm-decoration-muted-foreground/40')}>{label}</span>
                {detail && !off && <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{detail}</span>}
                {off && <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{locked && detail ? detail : __(OFF_TEXT[id] ?? 'oculto')}</span>}
                {problem && <span className="imcrm-ml-auto imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-destructive" aria-label={__('Falta algo')} />}
            </button>
            {visible !== null && !locked && (
                <button
                    type="button"
                    aria-label={visible ? `${__('Ocultar')} ${label.toLowerCase()}` : `${__('Mostrar')} ${label.toLowerCase()}`}
                    title={visible ? __('Ocultar') : __('Mostrar')}
                    aria-pressed={!visible}
                    onClick={() => onChange(setBookingElementVisible(config, id, !visible))}
                    className={cn(
                        'imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-background hover:imcrm-text-foreground',
                        visible && 'imcrm-opacity-60 group-hover:imcrm-opacity-100',
                    )}
                    data-toggle-element={id}
                >
                    {visible ? <Eye className="imcrm-h-3.5 imcrm-w-3.5" /> : <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" />}
                </button>
            )}
        </div>
    );
}

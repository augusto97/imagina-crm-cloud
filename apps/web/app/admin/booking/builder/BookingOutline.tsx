import {
    AlignLeft,
    Building2,
    CalendarDays,
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

import { OutlineAddChips, OutlineRow, OutlineSection, type OutlineAddItem } from '../../builder/Outline';

import { BOOKING_ELEMENTS, bookingElementVisible, setBookingElementVisible, type BookingElementId } from './bookingElements';

/**
 * v0.1.378 — «Contenido» del constructor de la agenda: la página en el orden
 * en que la recorre el cliente — el encabezado, los pasos (servicio, quién
 * atiende, fecha y hora, sus datos, la confirmación), lo que va en «Tus
 * datos» y la página. Cada fila se toca para editarla (y la vista previa va
 * a ese paso). v0.1.407: en bloques con su zona; lo apagado, en «Ocultos».
 */

export const BOOKING_ELEMENT_ICON: Record<BookingElementId, LucideIcon> = {
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
    // Sin llaves del captcha o sin autorización en la empresa, no se enciende desde aquí.
    const lockedReason = (id: BookingElementId): string | undefined =>
        id === '@captcha' && !captchaReady && !s.captcha
            ? __('Primero carga las llaves del anti-robots (Ajustes de la empresa → Portal y formularios).')
            : id === '@consent' && !consentActive && !s.data_consent
              ? __('Primero actívala en Ajustes de la empresa → Datos personales.')
              : undefined;
    const details: Partial<Record<BookingElementId, string>> = {
        '@logo': hasLogo ? __('El de la empresa') : __('Sin logo cargado'),
        '@title': s.title || pageName,
        '@description': s.description.split('\n')[0] || __('Sin descripción'),
        '@location': s.location || __('Sin lugar'),
        '@services': activeServices === 1 ? __('1 servicio') : `${activeServices} ${__('servicios')}`,
        '@staff': activeStaff === 1 ? __('1 persona o recurso') : `${activeStaff} ${__('personas o recursos')}`,
        '@calendar': bookingLabel(s.labels, 'date'),
        '@details': questions === 0 ? __('Nombre, correo y teléfono') : `${__('Nombre, correo y')} ${questions} ${questions === 1 ? __('pregunta más') : __('preguntas más')}`,
        '@done': bookingLabel(s.labels, 'done'),
        '@submit': `«${bookingLabel(s.labels, 'submit')}»`,
        '@page': __('Fondo, ancho y separación'),
    };
    const rowOf = (id: BookingElementId, visible: boolean | null, step?: number): JSX.Element => {
        const off = visible === false;
        const label = __(BOOKING_ELEMENTS[id].label);
        return (
            <OutlineRow
                key={id}
                icon={BOOKING_ELEMENT_ICON[id]}
                step={step}
                label={label}
                detail={off ? __(OFF_TEXT[id] ?? 'oculto') : details[id]}
                muted={off}
                selected={selected === id}
                problem={withProblems.has(id)}
                onSelect={() => onSelect(id)}
                onHide={visible === true && id !== '@staff' ? () => onChange(setBookingElementVisible(config, id, false)) : undefined}
                attrs={{ 'data-outline-element': id, 'data-booking-section': LEGACY_SECTION[id] }}
            />
        );
    };
    // v0.1.407 — lo que se ve va en filas; lo apagado, en «Ocultos» al pie de su bloque.
    const split = (ids: BookingElementId[]): { rows: JSX.Element[]; chips: OutlineAddItem[] } => {
        const rows: JSX.Element[] = [];
        const chips: OutlineAddItem[] = [];
        for (const id of ids) {
            const visible = bookingElementVisible(config, id);
            if (visible === false) {
                chips.push({
                    key: id,
                    icon: BOOKING_ELEMENT_ICON[id],
                    label: __(BOOKING_ELEMENTS[id].label),
                    disabledReason: lockedReason(id),
                    onAdd: () => {
                        onChange(setBookingElementVisible(config, id, true));
                        onSelect(id);
                    },
                    attrs: { 'data-show-element': id },
                });
            } else rows.push(rowOf(id, visible));
        }
        return { rows, chips };
    };
    const header = split(['@logo', '@title', '@description', '@location', '@band', '@cover']);
    const extras = split(['@consent', '@captcha', '@submit']);
    const frame = split(['@progress', '@card', '@page']);
    // Los pasos siempre están (apagar «Quién atiende» = se asigna solo): con su número.
    const stepIds: BookingElementId[] = ['@services', '@staff', '@calendar', '@details', '@done'];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-bg-muted/20 imcrm-p-2.5" data-testid="booking-outline" data-tour="booking-outline">
            <OutlineSection
                zone="top"
                title={__('Encabezado')}
                hint={__('Lo primero que se ve: logo, título, descripción y dónde es la cita.')}
                footer={header.chips.length ? <OutlineAddChips items={header.chips} separated={header.rows.length > 0} /> : undefined}
                testId="outline-header"
            >
                {header.rows.length ? header.rows : null}
            </OutlineSection>

            <OutlineSection zone="middle" title={__('Pasos del cliente')} hint={__('El camino para agendar, en orden. Toca un paso para verlo y editarlo.')} count={stepIds.length} testId="outline-steps">
                {stepIds.map((id, k) => rowOf(id, bookingElementVisible(config, id), k + 1))}
            </OutlineSection>

            <OutlineSection
                zone="bottom"
                title={__('En «Tus datos»')}
                hint={__('Lo que va con los datos del cliente, antes de confirmar.')}
                footer={extras.chips.length ? <OutlineAddChips items={extras.chips} separated={extras.rows.length > 0} /> : undefined}
                testId="outline-end"
            >
                {extras.rows.length ? extras.rows : null}
            </OutlineSection>

            <OutlineSection
                zone="frame"
                title={__('Marco y fondo')}
                hint={__('El avance, la tarjeta y el fondo alrededor.')}
                footer={frame.chips.length ? <OutlineAddChips items={frame.chips} separated={frame.rows.length > 0} /> : undefined}
                testId="outline-frame"
            >
                {frame.rows.length ? frame.rows : null}
            </OutlineSection>
        </div>
    );
}

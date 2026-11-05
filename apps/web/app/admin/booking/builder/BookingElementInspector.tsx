import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { BOOKING_CLASSIC_THEME, type BookingConfig } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';

import { Section } from '../../automations/email/EmailBlockInspector';
import { InspectorTabs, VisibilitySwitch, type InspectorTab } from '../../forms/builder/PageElementInspector';
import { ElementColors } from '../../forms/design/ElementColors';
import { ThemeInspector } from '../../forms/design/ThemeInspector';
import { BOOKING_ELEMENTS, bookingElementVisible, bookingVisibilityLabel, setBookingElementVisible, type BookingElementId } from './bookingElements';

/**
 * v0.1.378 — El panel de una parte de la agenda (el título, los servicios, el
 * calendario, el botón…): «Mostrar» arriba si se puede ocultar, y dos
 * pestañas — «Contenido» (qué dice y qué ofrece) y «Estilo» (sólo lo que la
 * cambia a ella: sus colores y su sección del diseño).
 */
export function BookingElementInspector({
    id,
    config,
    onChange,
    brand,
    isAdmin,
    tab,
    onTab,
    onClose,
    content,
    problems,
    lockedReason,
}: {
    id: BookingElementId;
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
    brand: string;
    isAdmin: boolean;
    tab: InspectorTab;
    onTab: (t: InspectorTab) => void;
    onClose: () => void;
    /** Lo de la pestaña «Contenido» (null = esta parte sólo tiene estilo). */
    content: ReactNode;
    /** Lo que falta para publicar que se arregla aquí. */
    problems?: string[];
    /** Por qué no se puede encender (sin llaves del captcha, sin autorización en la empresa). */
    lockedReason?: string | null;
}): JSX.Element {
    const info = BOOKING_ELEMENTS[id];
    const visible = bookingElementVisible(config, id);
    const hasContent = content !== null && content !== undefined && content !== false;
    const hasStyle = info.colors.length > 0 || info.sections.length > 0;
    const shown: InspectorTab = !hasContent ? 'style' : !hasStyle ? 'content' : tab;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-p-4" data-testid="booking-element-inspector" data-element={id}>
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    <p className="imcrm-truncate imcrm-text-sm imcrm-font-semibold">{__(info.label)}</p>
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__(info.hint)}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label={__('Cerrar')} onClick={onClose}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
            {problems && problems.length > 0 && (
                <ul
                    className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive"
                    data-testid="booking-element-problems"
                >
                    {problems.map((m) => (
                        <li key={m}>{__(m)}</li>
                    ))}
                </ul>
            )}
            {visible !== null &&
                (lockedReason && !visible ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-muted-foreground/40 imcrm-bg-muted/40 imcrm-px-2.5 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground" data-testid="booking-element-locked">
                        {__(lockedReason)}
                    </p>
                ) : (
                    <VisibilitySwitch on={visible} label={bookingVisibilityLabel(id)} onChange={(v) => onChange(setBookingElementVisible(config, id, v))} testId="booking-element-visible" />
                ))}
            <InspectorTabs tab={shown} onTab={onTab} hasContent={hasContent} hasStyle={hasStyle} />
            {shown === 'content' ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="booking-element-content">
                    {content}
                </div>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="booking-element-style">
                    {info.colors.length > 0 && (
                        <Section title={__('Colores')}>
                            <ElementColors config={config} onChange={onChange} keys={info.colors} brand={brand} base={BOOKING_CLASSIC_THEME} />
                            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Vacío = sale de los colores generales del diseño (se ve punteado).')}</p>
                        </Section>
                    )}
                    {info.sections.length > 0 && (
                        <div className="-imcrm-mx-4 imcrm-border-t imcrm-border-border">
                            <ThemeInspector
                                config={config}
                                onChange={onChange}
                                brand={brand}
                                isAdmin={isAdmin}
                                showLogo={config.settings.show_logo}
                                variant="booking"
                                classicTheme={BOOKING_CLASSIC_THEME}
                                only={info.sections}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

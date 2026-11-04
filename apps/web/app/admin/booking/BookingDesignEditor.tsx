import { BOOKING_CLASSIC_THEME, type BookingConfig, type BookingDisplay, type PublicThemePreset, type SavedPublicTheme } from '@imagina-base/shared';

import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';

import { Check, Section, Segmented } from '../automations/email/EmailBlockInspector';
import { MyThemes } from '../forms/design/MyThemes';
import { ThemeGallery } from '../forms/design/ThemeGallery';
import { ThemeInspector } from '../forms/design/ThemeInspector';
import { activePresetId, applyTheme, startTheme } from '../forms/design/themeOps';

/**
 * v0.1.354 — «Diseño» de la agenda: el MISMO motor de temas de los
 * formularios (ADR-S94) — plantillas, «Mis temas» y todos los ajustes — más lo
 * propio de una página de reservas: qué se muestra y cómo se distribuye.
 * Vale para la página de reservas y para la de cada cita (cambiar o cancelar).
 */
export function BookingDesignEditor({
    config,
    onChange,
    brand,
    isAdmin,
    suggestedName,
    narrow,
}: {
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
    brand: string;
    isAdmin: boolean;
    suggestedName: string;
    narrow: boolean;
}): JSX.Element {
    const toast = useToast();
    const s = config.settings;
    const d = s.display;
    const setD = (patch: Partial<BookingDisplay>): void => onChange({ ...config, settings: { ...s, display: { ...d, ...patch } } });

    const applyPreset = (p: PublicThemePreset): void => {
        // «Clásico» = el de siempre de la agenda (más ancho y con «Paso X de Y»).
        if (p.id === 'classic') {
            onChange({ ...config, settings: { ...s, theme: null } });
            return;
        }
        onChange(applyTheme(config, p.theme, { keepCustomCss: !isAdmin, carryImages: true }));
    };
    const applySaved = (t: SavedPublicTheme): void => {
        onChange(applyTheme(config, t.theme, { keepCustomCss: !isAdmin }));
        toast.success(__('Tema aplicado'), __('«%s». Si no te convence, deshazlo.').replace('%s', t.name));
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-tour="booking-design">
            <Section title={__('Plantillas')}>
                <ThemeGallery brand={brand} activeId={activePresetId(s)} onApply={applyPreset} columns={narrow ? 3 : 2} />
            </Section>
            <MyThemes brand={brand} current={startTheme(s, BOOKING_CLASSIC_THEME)} suggestedName={suggestedName.slice(0, 60)} onApply={applySaved} />
            <Section title={__('Mostrar u ocultar')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="booking-display">
                    <Check label={__('El logo de la empresa')} checked={s.show_logo} onChange={(v) => onChange({ ...config, settings: { ...s, show_logo: v } })} testId="booking-show-logo" />
                    <Check label={__('Dónde es la cita')} checked={d.show_location} onChange={(v) => setD({ show_location: v })} testId="booking-show-location" />
                    <Check
                        label={__('La duración y la descripción de cada servicio')}
                        checked={d.show_service_details}
                        onChange={(v) => setD({ show_service_details: v })}
                        testId="booking-show-service-details"
                    />
                    <Check label={__('El precio de cada servicio')} checked={d.show_prices} onChange={(v) => setD({ show_prices: v })} testId="booking-show-prices" />
                    <Check label={__('Las fotos de quienes atienden')} checked={d.show_staff_photos} onChange={(v) => setD({ show_staff_photos: v })} testId="booking-show-staff-photos" />
                    <Check
                        label={__('El cargo y la descripción de quienes atienden')}
                        checked={d.show_staff_details}
                        onChange={(v) => setD({ show_staff_details: v })}
                        testId="booking-show-staff-details"
                    />
                </div>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('El título y la descripción se muestran u ocultan en «Página», más abajo.')}
                </p>
            </Section>
            <Section title={__('Distribución')}>
                <Segmented
                    label={__('El calendario')}
                    value={d.calendar_layout}
                    options={[
                        { value: 'side', label: __('Al lado de los horarios') },
                        { value: 'stacked', label: __('Arriba de los horarios') },
                    ]}
                    onChange={(v) => setD({ calendar_layout: v as BookingDisplay['calendar_layout'] })}
                />
                <Segmented
                    label={__('Los horarios')}
                    value={d.slot_style}
                    options={[
                        { value: 'grid', label: __('Cuadrícula') },
                        { value: 'list', label: __('Lista') },
                    ]}
                    onChange={(v) => setD({ slot_style: v as BookingDisplay['slot_style'] })}
                />
                <Segmented
                    label={__('La semana empieza el')}
                    value={d.week_start}
                    options={[
                        { value: 'monday', label: __('Lunes') },
                        { value: 'sunday', label: __('Domingo') },
                    ]}
                    onChange={(v) => setD({ week_start: v as BookingDisplay['week_start'] })}
                />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('«Al lado» sólo si la página es lo bastante ancha; en el celular el calendario siempre va arriba.')}
                </p>
            </Section>
            <div className="-imcrm-mx-4 imcrm-border-t imcrm-border-border">
                <ThemeInspector
                    config={config}
                    onChange={onChange}
                    brand={brand}
                    isAdmin={isAdmin}
                    showLogo={s.show_logo}
                    variant="booking"
                    classicTheme={BOOKING_CLASSIC_THEME}
                />
            </div>
        </div>
    );
}

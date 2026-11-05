import { BOOKING_CLASSIC_THEME, type BookingConfig, type PublicThemePreset, type SavedPublicTheme } from '@imagina-base/shared';

import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';

import { Section } from '../automations/email/EmailBlockInspector';
import { MyThemes } from '../forms/design/MyThemes';
import { ThemeGallery } from '../forms/design/ThemeGallery';
import { ThemeInspector } from '../forms/design/ThemeInspector';
import { activePresetId, applyTheme, startTheme } from '../forms/design/themeOps';

/**
 * «Diseño» de la agenda: el MISMO motor de temas de los formularios (ADR-S94).
 * v0.1.378 — Como en el constructor de formularios: a la izquierda las
 * plantillas y «Mis temas»; a la derecha todos los ajustes del tema. Lo que
 * se muestra de cada parte (precios, fotos, dónde es…) y cómo se distribuye
 * el calendario se cambian tocando esa parte en la vista previa.
 */
export function BookingDesignLibrary({
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
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-tour="booking-design" data-testid="booking-design-library">
            <Section title={__('Plantillas')}>
                <ThemeGallery brand={brand} activeId={activePresetId(s)} onApply={applyPreset} columns={narrow ? 3 : 2} />
            </Section>
            <MyThemes brand={brand} current={startTheme(s, BOOKING_CLASSIC_THEME)} suggestedName={suggestedName.slice(0, 60)} onApply={applySaved} />
        </div>
    );
}

/** Todos los ajustes del tema de la agenda (colores, tipografía, página, campos, botón…). */
export function BookingThemePanel({
    config,
    onChange,
    brand,
    isAdmin,
}: {
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
    brand: string;
    isAdmin: boolean;
}): JSX.Element {
    return (
        <div data-testid="booking-theme-panel">
            <ThemeInspector
                config={config}
                onChange={onChange}
                brand={brand}
                isAdmin={isAdmin}
                showLogo={config.settings.show_logo}
                variant="booking"
                classicTheme={BOOKING_CLASSIC_THEME}
            />
        </div>
    );
}

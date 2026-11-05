import { useState } from 'react';

import type { FormConfig } from '@imagina-base/shared';

import { Choice } from '@/components/design/DesignStyleControls';
import { __ } from '@/lib/i18n';

import { ImageUpload } from './ImageUpload';

type LogoMode = 'brand' | 'custom' | 'none';

/** v0.1.369 — Qué logo muestra el formulario (lo leído de sus ajustes). */
export function formLogoMode(s: Pick<FormConfig['settings'], 'show_logo' | 'logo_file_id'>): LogoMode {
    if (!s.show_logo) return 'none';
    return s.logo_file_id !== null ? 'custom' : 'brand';
}

/**
 * v0.1.369 — El logo del formulario: el de la empresa, uno propio para este
 * formulario (una imagen de la empresa, nunca SVG: se convierte al subirla) o
 * ninguno. Se ve en la página, en la confirmación por correo y en los correos
 * del formulario.
 */
export function LogoSetting({
    settings,
    hasBrandLogo,
    onChange,
}: {
    settings: FormConfig['settings'];
    hasBrandLogo: boolean;
    onChange: (patch: Partial<FormConfig['settings']>) => void;
}): JSX.Element {
    const saved = formLogoMode(settings);
    // «Otro logo» elegido y todavía sin subir: hasta tener la imagen se ve el de la empresa.
    const [pickingCustom, setPickingCustom] = useState(false);
    const mode: LogoMode = pickingCustom && saved === 'brand' ? 'custom' : saved;

    const choose = (m: LogoMode): void => {
        setPickingCustom(m === 'custom');
        if (m === 'none') onChange({ show_logo: false });
        else if (m === 'brand') onChange({ show_logo: true, logo_file_id: null });
        else onChange({ show_logo: true });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-logo-setting">
            <Choice
                label={__('Logo')}
                value={mode}
                options={[
                    { value: 'brand', label: __('El de la empresa') },
                    { value: 'custom', label: __('Otro logo') },
                    { value: 'none', label: __('Sin logo') },
                ]}
                onChange={choose}
            />
            {mode === 'brand' && !hasBrandLogo && (
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="form-logo-no-brand">
                    {__('Tu empresa todavía no tiene logo: se sube en Ajustes → Marca. Mientras tanto no se muestra ninguno.')}
                </p>
            )}
            {mode === 'custom' && (
                <ImageUpload
                    label={__('Logo de este formulario')}
                    fileId={settings.logo_file_id}
                    maxSide={600}
                    hint={__('PNG, JPG o WebP. Mejor con fondo transparente. El tamaño se ajusta en Diseño → Página → Alto del logo.')}
                    onChange={(id) => {
                        setPickingCustom(id === null);
                        onChange({ show_logo: true, logo_file_id: id });
                    }}
                    testId="form-logo-upload"
                />
            )}
        </div>
    );
}

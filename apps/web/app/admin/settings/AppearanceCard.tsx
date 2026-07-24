import { Check, Monitor, Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { useTheme, type ThemeMode } from '@/lib/theme';

/**
 * v0.1.112 — Apariencia (per-usuario, por navegador): claro / oscuro /
 * seguir al sistema. El atajo rápido es el botón del topbar; acá está el
 * tri-estado completo, que es el único lugar donde se puede volver a
 * "Seguir al sistema" después de elegir manualmente.
 *
 * No viaja al backend a propósito: es una preferencia de dispositivo (el
 * mismo usuario puede querer oscuro en su notebook de noche y claro en la
 * pantalla de la oficina).
 */
const OPTIONS: { id: ThemeMode; label: string; hint: string; icon: LucideIcon }[] = [
    { id: 'light', label: 'Claro', hint: 'La interfaz de siempre', icon: Sun },
    { id: 'dark', label: 'Oscuro', hint: 'Superficies oscuras, menos brillo', icon: Moon },
    { id: 'system', label: 'Seguir al sistema', hint: 'Usa el modo de tu dispositivo', icon: Monitor },
];

export function AppearanceCard(): JSX.Element {
    const { mode, resolved, setMode } = useTheme();

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-theme-resolved={resolved}>
            <div>
                <h2 className="imcrm-text-base imcrm-font-semibold">{__('Apariencia')}</h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Elegí cómo se ve la app en este dispositivo. También podés cambiarlo desde el ícono de sol/luna de la barra superior.')}
                </p>
            </div>

            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-3">
                {OPTIONS.map((opt) => {
                    const active = mode === opt.id;
                    return (
                        <button
                            key={opt.id}
                            type="button"
                            onClick={() => setMode(opt.id)}
                            aria-pressed={active}
                            data-theme-option={opt.id}
                            className={[
                                'imcrm-relative imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-p-4 imcrm-text-left imcrm-transition-colors',
                                active
                                    ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-1 imcrm-ring-primary'
                                    : 'imcrm-border-border imcrm-bg-card hover:imcrm-border-primary/40 hover:imcrm-bg-accent/40',
                            ].join(' ')}
                        >
                            <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                                <opt.icon className="imcrm-h-4 imcrm-w-4" />
                            </span>
                            <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                <span className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                                    {__(opt.label)}
                                </span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{__(opt.hint)}</span>
                            </span>
                            {active && (
                                <Check className="imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                            )}
                        </button>
                    );
                })}
            </div>

            {mode === 'system' && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Tu dispositivo está en modo')} <strong>{resolved === 'dark' ? __('oscuro') : __('claro')}</strong>.
                </p>
            )}
        </section>
    );
}

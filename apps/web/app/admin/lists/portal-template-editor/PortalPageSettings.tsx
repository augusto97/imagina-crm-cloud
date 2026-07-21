import { useState } from 'react';
import { PanelTop } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PAGE_FONT_STACKS, type PageFont, type PortalPageSettings } from '@/lib/blockStyle';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const PAGE_BG_SWATCHES = [
    '#ffffff', '#f8fafc', '#f1f5f9', '#eff6ff', '#ecfdf5',
    '#fefce8', '#fdf2f8', '#0f172a', '#1e293b', '#115e59',
];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * v0.1.94 — Popover "Página" de la toolbar del editor del portal:
 * fondo de toda la página, ancho máximo del contenido y tipografía
 * global. Persiste en `portal_template.page` y lo aplica el SPA del
 * portal al bootear. Popover plano (sin Radix anidado — lección
 * v0.1.85 del autocomplete).
 */
export function PortalPageSettingsButton({
    value,
    onChange,
}: {
    value: PortalPageSettings;
    onChange: (next: PortalPageSettings) => void;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const dirty = Object.keys(value).length > 0;

    const set = (patch: Partial<PortalPageSettings>): void => {
        const next = { ...value, ...patch };
        for (const k of Object.keys(next) as Array<keyof PortalPageSettings>) {
            if (next[k] === undefined) delete next[k];
        }
        onChange(next);
    };

    return (
        <div className="imcrm-relative">
            <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn('imcrm-gap-1.5', dirty && 'imcrm-border-primary/40 imcrm-text-primary')}
                onClick={() => setOpen((v) => !v)}
            >
                <PanelTop className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Página')}
            </Button>
            {open && (
                <>
                    <div className="imcrm-fixed imcrm-inset-0 imcrm-z-30" onClick={() => setOpen(false)} />
                    <div className="imcrm-absolute imcrm-right-0 imcrm-top-full imcrm-z-40 imcrm-mt-1 imcrm-w-72 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-shadow-imcrm-md">
                        <p className="imcrm-mb-2 imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                            {__('Ajustes de la página del portal')}
                        </p>

                        <div className="imcrm-mb-3 imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                {__('Fondo de la página')}
                            </span>
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                                {PAGE_BG_SWATCHES.map((hex) => (
                                    <button
                                        key={hex}
                                        type="button"
                                        aria-label={hex}
                                        title={hex}
                                        onClick={() => set({ bg: hex })}
                                        className={cn(
                                            'imcrm-h-5 imcrm-w-5 imcrm-rounded imcrm-border imcrm-transition-transform hover:imcrm-scale-110',
                                            value.bg === hex
                                                ? 'imcrm-border-primary imcrm-ring-2 imcrm-ring-primary/40'
                                                : 'imcrm-border-border',
                                        )}
                                        style={{ backgroundColor: hex }}
                                    />
                                ))}
                                {value.bg !== undefined && (
                                    <button
                                        type="button"
                                        onClick={() => set({ bg: undefined })}
                                        className="imcrm-ml-1 imcrm-text-[10px] imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                    >
                                        {__('Quitar')}
                                    </button>
                                )}
                            </div>
                            <Input
                                value={value.bg ?? ''}
                                onChange={(e) => {
                                    const raw = e.target.value.trim();
                                    if (raw === '') {
                                        set({ bg: undefined });
                                        return;
                                    }
                                    const hex = raw.startsWith('#') ? raw : `#${raw}`;
                                    if (HEX_RE.test(hex)) set({ bg: hex.toLowerCase() });
                                }}
                                placeholder="#hex"
                                className="imcrm-h-7 imcrm-w-24 imcrm-font-mono imcrm-text-[11px]"
                                aria-label={__('Fondo de página hex')}
                            />
                        </div>

                        <div className="imcrm-mb-3 imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                {__('Ancho máximo del contenido (px)')}
                            </span>
                            <Input
                                type="number"
                                min={480}
                                max={2400}
                                value={value.max_width ?? ''}
                                placeholder={__('896 (default)')}
                                onChange={(e) => {
                                    const n = Number(e.target.value);
                                    set({
                                        max_width:
                                            Number.isFinite(n) && n >= 480 ? Math.floor(n) : undefined,
                                    });
                                }}
                                className="imcrm-h-8"
                                aria-label={__('Ancho máximo')}
                            />
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                {__('Tipografía global')}
                            </span>
                            <Select
                                value={value.font ?? 'sans'}
                                onChange={(e) =>
                                    set({
                                        font:
                                            e.target.value === 'sans'
                                                ? undefined
                                                : (e.target.value as PageFont),
                                    })
                                }
                                aria-label={__('Tipografía')}
                            >
                                <option value="sans">{__('Moderna (default)')}</option>
                                <option value="serif">{__('Serif (editorial)')}</option>
                                <option value="rounded">{__('Redondeada (amigable)')}</option>
                                <option value="mono">{__('Monoespaciada (técnica)')}</option>
                            </Select>
                            <p
                                className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-2 imcrm-py-1.5 imcrm-text-[12px]"
                                style={{ fontFamily: PAGE_FONT_STACKS[value.font ?? 'sans'] }}
                            >
                                {__('Así se verá el texto del portal.')}
                            </p>
                        </div>

                        <p className="imcrm-mt-2 imcrm-text-[10px] imcrm-text-muted-foreground">
                            {__('Se aplican al guardar la plantilla.')}
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}

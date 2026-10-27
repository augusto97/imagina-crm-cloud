import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { APP_BAR_BRAND, APP_BAR_NEUTRAL, type UpdateBrandingInput } from '@imagina-base/shared';
import { Palette } from 'lucide-react';

import { brandingQueryKey, useBrandingData } from '@/hooks/useBranding';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** Hex ≈ del token default (`--imcrm-primary: 191 85% 32%`) para el picker. */
const DEFAULT_PICKER_HEX = '#0c7e97';
/** Hex ≈ del riel default (`--imcrm-sidebar: 192 55% 26%`) para el picker. */
const DEFAULT_SIDEBAR_PICKER_HEX = '#1e5a67';

/** v0.1.326 — barras del sistema del teléfono: neutras, de la marca u otro color. */
type AppBarMode = 'neutral' | 'brand' | 'custom';

function appBarModeOf(saved: string | null | undefined): { mode: AppBarMode; hex: string } {
    if (saved === APP_BAR_BRAND) return { mode: 'brand', hex: '' };
    if (saved && HEX_RE.test(saved)) return { mode: 'custom', hex: saved };
    return { mode: 'neutral', hex: '' };
}

/** ¿Texto claro u oscuro sobre este fondo? (luminancia WCAG). */
function inkFor(hex: string): string {
    const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = n.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111827' : '#ffffff';
}

/** Un teléfono chiquito: la barra de la hora, la barra de la app y la de abajo. */
function PhonePreview({ bar, appBg }: { bar: string; appBg: string }): JSX.Element {
    const ink = inkFor(bar);
    return (
        <div
            aria-hidden
            data-testid="app-bar-preview"
            data-bar={bar}
            className="imcrm-flex imcrm-h-[132px] imcrm-w-[70px] imcrm-shrink-0 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-[12px] imcrm-border-[3px] imcrm-border-foreground/80 imcrm-bg-background"
        >
            <div className="imcrm-flex imcrm-h-3.5 imcrm-items-center imcrm-justify-between imcrm-px-1.5 imcrm-text-[6px] imcrm-font-semibold" style={{ background: bar, color: ink }}>
                <span>9:41</span>
                <span>●●●</span>
            </div>
            <div className="imcrm-flex imcrm-h-4 imcrm-items-center imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-1.5" style={{ background: appBg }}>
                <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-sm imcrm-bg-primary" />
                <span className="imcrm-h-1 imcrm-w-6 imcrm-rounded-full imcrm-bg-muted-foreground/40" />
            </div>
            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1 imcrm-p-1.5">
                <span className="imcrm-h-1 imcrm-w-10 imcrm-rounded-full imcrm-bg-muted-foreground/30" />
                <span className="imcrm-h-1 imcrm-w-8 imcrm-rounded-full imcrm-bg-muted-foreground/20" />
                <span className="imcrm-h-1 imcrm-w-9 imcrm-rounded-full imcrm-bg-muted-foreground/20" />
            </div>
            <div className="imcrm-flex imcrm-h-3 imcrm-items-center imcrm-justify-center" style={{ background: bar }}>
                <span className="imcrm-h-0.5 imcrm-w-5 imcrm-rounded-full" style={{ background: ink, opacity: 0.7 }} />
            </div>
        </div>
    );
}

/**
 * Card "Marca" de Ajustes: branding white-label del workspace (sólo admin —
 * el backend igualmente lo exige con 403; el front sólo oculta). Nombre de la
 * app + color primario se guardan juntos con "Guardar" (PATCH parcial, sólo
 * campos tocados); el logo se sube/quita al instante (upload a `/files` →
 * PATCH `logo_file_id`). Al guardar se invalida el query del branding y
 * `useBranding` re-aplica los tokens solo.
 */
export function BrandingPanel(): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const brandingQ = useBrandingData();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [appName, setAppName] = useState('');
    const [colorHex, setColorHex] = useState('');
    // v0.1.176 — color del RIEL del menú, independiente del primario.
    // Vacío = el riel sigue al primario (comportamiento histórico).
    const [sidebarHex, setSidebarHex] = useState('');
    const [barMode, setBarMode] = useState<AppBarMode>('neutral');
    const [barHex, setBarHex] = useState('');
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // Rehidratar el form cuando llega (o cambia) el branding del tenant.
    useEffect(() => {
        const b = brandingQ.data;
        if (!b) return;
        setAppName(b.app_name ?? '');
        setColorHex(b.primary_color ?? '');
        setSidebarHex(b.sidebar_color ?? '');
        const bar = appBarModeOf(b.app_bar_color);
        setBarMode(bar.mode);
        setBarHex(bar.hex);
    }, [brandingQ.data]);

    const invalidate = () => qc.invalidateQueries({ queryKey: brandingQueryKey(tenantId) });
    const onError = (e: unknown) =>
        setNotice({ kind: 'err', text: e instanceof CloudApiError ? e.message : 'No se pudo guardar.' });

    const save = useMutation({
        mutationFn: (patch: UpdateBrandingInput) => api.updateBranding(patch),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: 'Marca guardada.' });
            void invalidate();
        },
        onError,
    });

    const uploadLogo = useMutation({
        mutationFn: async (file: File) => {
            const { id } = await api.uploadFile(file);
            return api.updateBranding({ logo_file_id: id });
        },
        onSuccess: () => {
            setNotice({ kind: 'ok', text: 'Logo actualizado.' });
            void invalidate();
        },
        onError,
    });

    const removeLogo = useMutation({
        mutationFn: () => api.updateBranding({ logo_file_id: null }),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: 'Logo quitado.' });
            void invalidate();
        },
        onError,
    });

    const restore = useMutation({
        mutationFn: () =>
            api.updateBranding({ primary_color: null, sidebar_color: null, app_bar_color: null, logo_file_id: null, app_name: null }),
        onSuccess: () => {
            setAppName('');
            setColorHex('');
            setSidebarHex('');
            setBarMode('neutral');
            setBarHex('');
            setNotice({ kind: 'ok', text: 'Marca restaurada a los valores por defecto.' });
            void invalidate();
        },
        onError,
    });

    const busy = save.isPending || uploadLogo.isPending || removeLogo.isPending || restore.isPending;

    const handleSave = (): void => {
        const b = brandingQ.data;
        const nextName = appName.trim() === '' ? null : appName.trim();
        const nextColor = colorHex.trim() === '' ? null : colorHex.trim();
        const nextSidebar = sidebarHex.trim() === '' ? null : sidebarHex.trim();
        if (nextColor !== null && !HEX_RE.test(nextColor)) {
            setNotice({ kind: 'err', text: 'Color primario inválido: usa el formato #RRGGBB.' });
            return;
        }
        if (nextSidebar !== null && !HEX_RE.test(nextSidebar)) {
            setNotice({ kind: 'err', text: 'Color de la barra lateral inválido: usa el formato #RRGGBB.' });
            return;
        }
        const nextBar = barMode === 'brand' ? APP_BAR_BRAND : barMode === 'custom' ? barHex.trim() : null;
        if (barMode === 'custom' && !HEX_RE.test(barHex.trim())) {
            setNotice({ kind: 'err', text: 'Color de las barras del teléfono inválido: usa el formato #RRGGBB.' });
            return;
        }
        // PATCH parcial: sólo los campos que cambiaron respecto de lo guardado.
        const patch: UpdateBrandingInput = {};
        if (nextName !== (b?.app_name ?? null)) patch.app_name = nextName;
        const savedColor = b?.primary_color ?? null;
        if ((nextColor?.toLowerCase() ?? null) !== (savedColor?.toLowerCase() ?? null)) {
            patch.primary_color = nextColor;
        }
        const savedSidebar = b?.sidebar_color ?? null;
        if ((nextSidebar?.toLowerCase() ?? null) !== (savedSidebar?.toLowerCase() ?? null)) {
            patch.sidebar_color = nextSidebar;
        }
        const savedBar = b?.app_bar_color ?? null;
        if ((nextBar?.toLowerCase() ?? null) !== (savedBar?.toLowerCase() ?? null)) {
            patch.app_bar_color = nextBar;
        }
        if (Object.keys(patch).length === 0) {
            setNotice({ kind: 'ok', text: 'No hay cambios para guardar.' });
            return;
        }
        save.mutate(patch);
    };

    const logoUrl = brandingQ.data?.logo_url ?? null;
    const pickerValue = HEX_RE.test(colorHex.trim()) ? colorHex.trim() : DEFAULT_PICKER_HEX;
    // Sin riel propio el picker muestra el riel por defecto (teal-tinta
    // `192 55% 26%` ≈ #1e5a67) — el color que se ve en pantalla.
    const sidebarPickerValue = HEX_RE.test(sidebarHex.trim()) ? sidebarHex.trim() : DEFAULT_SIDEBAR_PICKER_HEX;
    const brandHex = HEX_RE.test(colorHex.trim()) ? colorHex.trim() : DEFAULT_PICKER_HEX;
    const barPickerValue = HEX_RE.test(barHex.trim()) ? barHex.trim() : '#1f2937';
    const previewBar = barMode === 'brand' ? brandHex : barMode === 'custom' ? barPickerValue : APP_BAR_NEUTRAL.light;
    const barOptions: Array<{ mode: AppBarMode; title: string; text: string; swatch: string }> = [
        { mode: 'neutral', title: 'Neutras (recomendado)', text: 'Blancas en modo claro y negras en oscuro, como la barra de la app.', swatch: APP_BAR_NEUTRAL.light },
        { mode: 'brand', title: 'Color de la marca', text: 'El color primario. Con un color muy vivo se ve llamativo.', swatch: brandHex },
        { mode: 'custom', title: 'Otro color', text: 'Uno que elijas: un gris o un tono suave de tu marca.', swatch: barPickerValue },
    ];

    return (
        <Card data-tour="branding-card">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Palette className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>Marca</CardTitle>
                        <CardDescription>
                            Personaliza el nombre, los colores (primario, barra lateral y barras del teléfono) y el logo. Tu
                            equipo los ve en la app, y tus clientes en su portal y en los correos de acceso: ahí no
                            aparece nada de la plataforma.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                    <label className="imcrm-block imcrm-space-y-1 sm:imcrm-col-span-2">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">Nombre de la app</span>
                        <Input
                            value={appName}
                            onChange={(e) => setAppName(e.target.value)}
                            placeholder="El nombre de tu empresa"
                            maxLength={60}
                        />
                    </label>
                    <div className="imcrm-space-y-1">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">Color primario</span>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <input
                                type="color"
                                aria-label="Selector de color primario"
                                value={pickerValue}
                                onChange={(e) => setColorHex(e.target.value)}
                                className="imcrm-h-9 imcrm-w-12 imcrm-shrink-0 imcrm-cursor-pointer imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-p-1"
                            />
                            <Input
                                value={colorHex}
                                onChange={(e) => setColorHex(e.target.value)}
                                placeholder="#0c7e97 (por defecto)"
                                spellCheck={false}
                                className="imcrm-font-mono"
                            />
                        </div>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            Botones, enlaces y acentos de toda la app.
                        </p>
                    </div>
                    <div className="imcrm-space-y-1" data-testid="branding-sidebar-color">
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">Color de la barra lateral</span>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <input
                                type="color"
                                aria-label="Selector de color de la barra lateral"
                                value={sidebarPickerValue}
                                onChange={(e) => setSidebarHex(e.target.value)}
                                className="imcrm-h-9 imcrm-w-12 imcrm-shrink-0 imcrm-cursor-pointer imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-p-1"
                            />
                            <Input
                                value={sidebarHex}
                                onChange={(e) => setSidebarHex(e.target.value)}
                                placeholder="Sigue al color primario"
                                spellCheck={false}
                                className="imcrm-font-mono"
                                aria-label="Color de la barra lateral (hex)"
                            />
                            {sidebarHex.trim() !== '' && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="imcrm-shrink-0 imcrm-text-muted-foreground"
                                    onClick={() => setSidebarHex('')}
                                    title="Volver a seguir al color primario"
                                    data-testid="branding-sidebar-clear"
                                >
                                    Quitar
                                </Button>
                            )}
                        </div>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            El fondo del menú de la izquierda. Vacío: se tiñe con el color primario. El texto se
                            ajusta solo (claro sobre un fondo oscuro, oscuro sobre uno claro).
                        </p>
                    </div>
                </div>

                <fieldset className="imcrm-space-y-2" data-testid="branding-app-bar">
                    <legend className="imcrm-text-xs imcrm-text-muted-foreground">Barras del teléfono (app instalada)</legend>
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        La barra de arriba (con la hora) y, en Android, la de abajo, cuando tu equipo usa la app instalada o
                        la abre desde el navegador del teléfono.
                    </p>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 sm:imcrm-flex-row sm:imcrm-items-start">
                        <div className="imcrm-grid imcrm-flex-1 imcrm-gap-2" role="radiogroup" aria-label="Color de las barras del teléfono">
                            {barOptions.map((o) => (
                                <label
                                    key={o.mode}
                                    className={cn(
                                        'imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2.5 imcrm-rounded-md imcrm-border imcrm-p-2.5 imcrm-transition-colors',
                                        barMode === o.mode ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent/50',
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="app-bar-mode"
                                        value={o.mode}
                                        checked={barMode === o.mode}
                                        onChange={() => setBarMode(o.mode)}
                                        className="imcrm-mt-0.5 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                        data-testid={`app-bar-${o.mode}`}
                                    />
                                    <span className="imcrm-min-w-0 imcrm-flex-1">
                                        <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                            <span className="imcrm-h-3 imcrm-w-3 imcrm-rounded-full imcrm-ring-1 imcrm-ring-border" style={{ background: o.swatch }} />
                                            {o.title}
                                        </span>
                                        <span className="imcrm-mt-0.5 imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">{o.text}</span>
                                    </span>
                                </label>
                            ))}
                            {barMode === 'custom' && (
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                    <input
                                        type="color"
                                        aria-label="Selector de color de las barras del teléfono"
                                        value={barPickerValue}
                                        onChange={(e) => setBarHex(e.target.value)}
                                        className="imcrm-h-9 imcrm-w-12 imcrm-shrink-0 imcrm-cursor-pointer imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-p-1"
                                    />
                                    <Input
                                        value={barHex}
                                        onChange={(e) => setBarHex(e.target.value)}
                                        placeholder="#1f2937"
                                        spellCheck={false}
                                        className="imcrm-font-mono"
                                        aria-label="Color de las barras del teléfono (hex)"
                                        data-testid="app-bar-hex"
                                    />
                                </div>
                            )}
                        </div>
                        <PhonePreview bar={previewBar} appBg={APP_BAR_NEUTRAL.light} />
                    </div>
                </fieldset>

                <div className="imcrm-space-y-1">
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">Logo</span>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                        {logoUrl ? (
                            <img
                                src={logoUrl}
                                alt="Logo del workspace"
                                className="imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-rounded-md imcrm-object-contain imcrm-ring-1 imcrm-ring-border"
                            />
                        ) : (
                            <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-xs imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                                —
                            </span>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="imcrm-hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) uploadLogo.mutate(file);
                                e.target.value = '';
                            }}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            {uploadLogo.isPending ? 'Subiendo…' : 'Subir logo'}
                        </Button>
                        {logoUrl && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => removeLogo.mutate()}
                            >
                                Quitar
                            </Button>
                        )}
                    </div>
                </div>

                {notice && (
                    <div
                        className={[
                            'imcrm-rounded-md imcrm-p-2 imcrm-text-sm',
                            notice.kind === 'ok'
                                ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800'
                                : 'imcrm-bg-rose-100 imcrm-text-rose-800',
                        ].join(' ')}
                    >
                        {notice.text}
                    </div>
                )}

                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                    <Button type="button" size="sm" disabled={busy} onClick={handleSave} data-testid="branding-save">
                        {save.isPending ? 'Guardando…' : 'Guardar'}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => restore.mutate()}
                        className="imcrm-ml-auto imcrm-text-muted-foreground"
                    >
                        Restaurar valores por defecto
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

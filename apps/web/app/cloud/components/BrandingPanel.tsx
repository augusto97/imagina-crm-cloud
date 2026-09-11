import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateBrandingInput } from '@imagina-base/shared';
import { Palette } from 'lucide-react';

import { brandingQueryKey, useBrandingData } from '@/hooks/useBranding';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** Hex ≈ del token default (`--imcrm-primary: 191 85% 32%`) para el picker. */
const DEFAULT_PICKER_HEX = '#0c7e97';
/** Hex ≈ del riel default (`--imcrm-sidebar: 192 55% 26%`) para el picker. */
const DEFAULT_SIDEBAR_PICKER_HEX = '#1e5a67';

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
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // Rehidratar el form cuando llega (o cambia) el branding del tenant.
    useEffect(() => {
        const b = brandingQ.data;
        if (!b) return;
        setAppName(b.app_name ?? '');
        setColorHex(b.primary_color ?? '');
        setSidebarHex(b.sidebar_color ?? '');
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
            api.updateBranding({ primary_color: null, sidebar_color: null, logo_file_id: null, app_name: null }),
        onSuccess: () => {
            setAppName('');
            setColorHex('');
            setSidebarHex('');
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
            setNotice({ kind: 'err', text: 'Color primario inválido: usá el formato #RRGGBB.' });
            return;
        }
        if (nextSidebar !== null && !HEX_RE.test(nextSidebar)) {
            setNotice({ kind: 'err', text: 'Color de la barra lateral inválido: usá el formato #RRGGBB.' });
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

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Palette className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>Marca</CardTitle>
                        <CardDescription>
                            Personalizá el nombre, el color primario, el color de la barra lateral y el logo que ve
                            tu equipo en este workspace.
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
                            placeholder="Imagina Base"
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

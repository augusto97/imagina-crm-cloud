import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PLATFORM_APP_NAME, type PlatformBrand } from '@imagina-base/shared';
import { ImageUp, Loader2, Palette, Smartphone, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { brandInitials } from '@/hooks/useAppIdentity';
import {
    regenerateIconSet,
    uploadIconSet,
    uploadLogo,
    usePlatformBrandAdmin,
    useUpdatePlatformBrand,
} from '@/hooks/usePlatformBrand';
import { cn } from '@/lib/utils';

/**
 * v0.1.327 — Plataforma → Marca: cómo se presenta la app ante las empresas
 * que no tienen marca propia. El logo va en el login y en la pantalla de
 * arranque; el ícono, en la pestaña, en el menú y en el teléfono (app
 * instalada). En el dominio propio de una empresa nunca aparecen.
 */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const BG_PRESETS = ['#ffffff', '#f4f4f5', '#18181b', '#000000'];

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function PlatformBrandCard(): JSX.Element {
    const q = usePlatformBrandAdmin();
    if (q.isError) return <p className="imcrm-text-sm imcrm-text-destructive">{errorText(q.error)}</p>;
    if (!q.data) {
        return (
            <Card>
                <CardContent className="imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">Cargando…</CardContent>
            </Card>
        );
    }
    return <BrandEditor initial={q.data} />;
}

function BrandEditor({ initial }: { initial: PlatformBrand }): JSX.Element {
    const save = useUpdatePlatformBrand();
    const toast = useToast();
    const [draft, setDraft] = useState<PlatformBrand>(initial);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => setDraft(initial), [initial]);

    const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

    async function run(label: string, fn: () => Promise<void>): Promise<void> {
        setBusy(label);
        setError(null);
        try {
            await fn();
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(null);
        }
    }

    const onSave = (): Promise<void> =>
        run('save', async () => {
            let next = draft;
            // Cambió el color de fondo: los tamaños se vuelven a generar desde el original.
            if (next.icon_source_url && next.icons && next.icon_background !== initial.icon_background) {
                next = { ...next, icons: await regenerateIconSet(next.icon_source_url, next.icon_background) };
            }
            await save.mutateAsync(next);
            toast.success('Marca guardada');
        });

    return (
        <Card data-testid="platform-brand">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                        <Palette className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    </span>
                    <CardTitle>Marca de la plataforma</CardTitle>
                </div>
                <CardDescription>
                    El nombre, el logo y el ícono con los que se presenta la app: en el inicio de sesión, en la
                    pantalla de arranque, en la pestaña del navegador y en el teléfono cuando se instala. Las empresas
                    que suben su propio logo (Ajustes → Marca) siguen viendo el suyo, y en el dominio propio de una
                    empresa esta marca nunca aparece. Sin logo, la app muestra el nombre en texto.
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-8">
                <div className="imcrm-space-y-1.5">
                    <Label htmlFor="brand-name">Nombre de la app</Label>
                    <Input
                        id="brand-name"
                        value={draft.app_name}
                        maxLength={60}
                        onChange={(e) => setDraft((d) => ({ ...d, app_name: e.target.value }))}
                        placeholder={DEFAULT_PLATFORM_APP_NAME}
                        className="imcrm-max-w-sm"
                    />
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        Se ve en el login, en la pestaña y debajo del ícono de la app instalada.
                    </p>
                </div>

                <section className="imcrm-space-y-3">
                    <div>
                        <h3 className="imcrm-text-sm imcrm-font-semibold">Logo</h3>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            Horizontal, idealmente con fondo transparente (PNG o SVG). Se muestra en el inicio de sesión
                            y en la pantalla de arranque.
                        </p>
                    </div>
                    <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2">
                        <LogoSlot
                            label="Para fondo claro"
                            url={draft.logo_url}
                            name={draft.app_name}
                            surface="light"
                            busy={busy === 'logo'}
                            testId="brand-logo"
                            onPick={(file) =>
                                run('logo', async () => {
                                    const url = await uploadLogo(file);
                                    setDraft((d) => ({ ...d, logo_url: url }));
                                })
                            }
                            onClear={() => setDraft((d) => ({ ...d, logo_url: null }))}
                        />
                        <LogoSlot
                            label="Para modo oscuro (opcional)"
                            url={draft.logo_dark_url}
                            name={draft.app_name}
                            surface="dark"
                            busy={busy === 'logo-dark'}
                            testId="brand-logo-dark"
                            onPick={(file) =>
                                run('logo-dark', async () => {
                                    const url = await uploadLogo(file);
                                    setDraft((d) => ({ ...d, logo_dark_url: url }));
                                })
                            }
                            onClear={() => setDraft((d) => ({ ...d, logo_dark_url: null }))}
                        />
                    </div>
                    {draft.logo_url && !draft.logo_dark_url && (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            Sin una versión para modo oscuro, quien use la app en oscuro ve el nombre en texto (un logo
                            oscuro sobre fondo oscuro no se lee).
                        </p>
                    )}
                </section>

                <section className="imcrm-space-y-3">
                    <div>
                        <h3 className="imcrm-text-sm imcrm-font-semibold">Ícono</h3>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            Cuadrado, de 512 × 512 px o más. Lo usamos en la pestaña del navegador, en el menú de la
                            app y en el inicio del teléfono (la app genera sola todos los tamaños). Deja algo de aire
                            alrededor: Android lo recorta en círculo.
                        </p>
                    </div>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-6">
                        <IconPreview brand={draft} />
                        <div className="imcrm-flex imcrm-min-w-[220px] imcrm-flex-1 imcrm-flex-col imcrm-gap-4">
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                                <PickButton
                                    testId="brand-icon-input"
                                    busy={busy === 'icon'}
                                    label={draft.icons ? 'Cambiar ícono' : 'Subir ícono'}
                                    onPick={(file) =>
                                        run('icon', async () => {
                                            const set = await uploadIconSet(file, draft.icon_background);
                                            setDraft((d) => ({ ...d, ...set }));
                                        })
                                    }
                                />
                                {draft.icons && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setDraft((d) => ({ ...d, icons: null, icon_source_url: null }))}
                                    >
                                        <Trash2 className="imcrm-h-4 imcrm-w-4" /> Quitar
                                    </Button>
                                )}
                            </div>
                            <div className="imcrm-space-y-1.5">
                                <Label htmlFor="brand-icon-bg">Fondo del ícono</Label>
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                    {BG_PRESETS.map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            aria-label={`Fondo ${c}`}
                                            aria-pressed={draft.icon_background === c}
                                            onClick={() => setDraft((d) => ({ ...d, icon_background: c }))}
                                            className={cn(
                                                'imcrm-h-7 imcrm-w-7 imcrm-rounded-full imcrm-border imcrm-border-border',
                                                draft.icon_background === c && 'imcrm-ring-2 imcrm-ring-primary imcrm-ring-offset-2 imcrm-ring-offset-background',
                                            )}
                                            style={{ background: c }}
                                        />
                                    ))}
                                    <input
                                        id="brand-icon-bg"
                                        type="color"
                                        value={draft.icon_background}
                                        onChange={(e) => setDraft((d) => ({ ...d, icon_background: e.target.value }))}
                                        className="imcrm-h-7 imcrm-w-10 imcrm-cursor-pointer imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-transparent"
                                    />
                                </div>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    Rellena el cuadrado del ícono en el teléfono. Usa el mismo fondo de tu logo.
                                </p>
                            </div>
                        </div>
                    </div>
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-muted/60 imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground">
                        <Smartphone className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                        <span>
                            Si la app ya estaba instalada en un teléfono, el teléfono guarda el ícono y los colores de
                            cuando se instaló y los actualiza por su cuenta (Android puede tardar hasta un par de días).
                            Para verlo de inmediato, quita la app del teléfono y vuelve a instalarla.
                        </span>
                    </p>
                </section>

                {error && (
                    <p role="alert" className="imcrm-text-sm imcrm-text-destructive">
                        {error}
                    </p>
                )}
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                    <Button type="button" onClick={() => void onSave()} disabled={!dirty || busy !== null} data-testid="brand-save">
                        {busy === 'save' && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                        Guardar
                    </Button>
                    {dirty && <span className="imcrm-text-xs imcrm-text-muted-foreground">Tienes cambios sin guardar.</span>}
                </div>
            </CardContent>
        </Card>
    );
}

function PickButton({
    label,
    busy,
    onPick,
    testId,
}: {
    label: string;
    busy: boolean;
    onPick: (file: File) => void;
    testId: string;
}): JSX.Element {
    const ref = useRef<HTMLInputElement>(null);
    return (
        <>
            <input
                ref={ref}
                type="file"
                accept={ACCEPT}
                className="imcrm-hidden"
                data-testid={testId}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) onPick(file);
                }}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
                {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <ImageUp className="imcrm-h-4 imcrm-w-4" />}
                {busy ? 'Preparando…' : label}
            </Button>
        </>
    );
}

function LogoSlot({
    label,
    url,
    own = true,
    name,
    surface,
    busy,
    onPick,
    onClear,
    testId,
}: {
    label: string;
    url: string | null;
    own?: boolean;
    name: string;
    surface: 'light' | 'dark';
    busy: boolean;
    onPick: (file: File) => void;
    onClear: () => void;
    testId: string;
}): JSX.Element {
    return (
        <div className="imcrm-space-y-2">
            <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{label}</p>
            <div
                className={cn(
                    'imcrm-flex imcrm-h-24 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-px-4',
                    surface === 'dark' ? 'imcrm-bg-[#121212] imcrm-text-[#ededed]' : 'imcrm-bg-white imcrm-text-[#18181b]',
                )}
            >
                {url ? (
                    <img src={url} alt="" className="imcrm-max-h-12 imcrm-max-w-[220px] imcrm-object-contain" />
                ) : (
                    <span className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">{name || DEFAULT_PLATFORM_APP_NAME}</span>
                )}
            </div>
            <div className="imcrm-flex imcrm-gap-2">
                <PickButton testId={`${testId}-input`} busy={busy} label={own && url ? 'Cambiar' : 'Subir'} onPick={onPick} />
                {own && url && (
                    <Button type="button" variant="ghost" size="sm" onClick={onClear}>
                        <Trash2 className="imcrm-h-4 imcrm-w-4" /> Quitar
                    </Button>
                )}
            </div>
        </div>
    );
}

/** Cómo se ve el ícono: en el inicio del teléfono (recortado en círculo) y en la pestaña. */
function IconPreview({ brand }: { brand: PlatformBrand }): JSX.Element {
    const icon = brand.icons?.maskable_192 ?? null;
    const fav = brand.icons?.favicon_32 ?? null;
    return (
        <div className="imcrm-flex imcrm-items-end imcrm-gap-6 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-4" data-testid="brand-icon-preview">
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1.5">
                {icon ? (
                    <img src={icon} alt="" className="imcrm-h-16 imcrm-w-16 imcrm-rounded-full imcrm-shadow-imcrm-md" />
                ) : (
                    <span className="imcrm-flex imcrm-h-16 imcrm-w-16 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-foreground imcrm-text-lg imcrm-font-semibold imcrm-text-background imcrm-shadow-imcrm-md">
                        {brandInitials(brand.app_name || DEFAULT_PLATFORM_APP_NAME)}
                    </span>
                )}
                <span className="imcrm-max-w-[80px] imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                    {brand.app_name}
                </span>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1.5">
                {icon ? (
                    <img src={icon} alt="" className="imcrm-h-12 imcrm-w-12 imcrm-rounded-xl imcrm-shadow-imcrm-sm" />
                ) : (
                    <span className="imcrm-flex imcrm-h-12 imcrm-w-12 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-bg-foreground imcrm-text-sm imcrm-font-semibold imcrm-text-background">
                        {brandInitials(brand.app_name || DEFAULT_PLATFORM_APP_NAME)}
                    </span>
                )}
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">iPhone</span>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1.5">
                <span className="imcrm-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-t-lg imcrm-border imcrm-border-b-0 imcrm-border-border imcrm-bg-card imcrm-px-2.5 imcrm-text-[11px]">
                    {fav ? (
                        <img src={fav} alt="" className="imcrm-h-4 imcrm-w-4" />
                    ) : (
                        <span className="imcrm-h-4 imcrm-w-4 imcrm-rounded-sm imcrm-bg-foreground/80" />
                    )}
                    <span className="imcrm-max-w-[90px] imcrm-truncate">{brand.app_name}</span>
                </span>
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">Pestaña</span>
            </div>
        </div>
    );
}

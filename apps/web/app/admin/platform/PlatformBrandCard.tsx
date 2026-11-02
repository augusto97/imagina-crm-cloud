import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PLATFORM_APP_NAME, marketingUrlSchema, type PlatformBrand } from '@imagina-base/shared';
import { ImageUp, Loader2, Palette, Smartphone, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import {
    generateIconSet,
    iconSourceFromSavedImage,
    uploadIconSource,
    uploadLogo,
    uploadLogoMaybeIconSource,
    usePlatformBrandAdmin,
    useUpdatePlatformBrand,
} from '@/hooks/usePlatformBrand';
import { cn } from '@/lib/utils';

import { IconStudio } from './IconStudio';

/**
 * v0.1.327 — Plataforma → Marca: cómo se presenta la app ante las empresas
 * que no tienen marca propia. El logo va en el login; el ícono, en la
 * pestaña, en el menú y en el teléfono (app instalada). En el dominio propio
 * de una empresa nunca aparecen.
 */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

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
    const marketingError =
        draft.marketing_url === null
            ? null
            : marketingUrlSchema.safeParse(draft.marketing_url).success
              ? null
              : 'Escribe la dirección completa, que empiece con https://';

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

    // v0.1.343 — un original recién subido arranca con el diseño sugerido.
    const [autoSuggestFor, setAutoSuggestFor] = useState<string | null>(null);
    const patch = useCallback((p: Partial<PlatformBrand>) => setDraft((d) => ({ ...d, ...p })), []);
    const clearAutoSuggest = useCallback(() => setAutoSuggestFor(null), []);
    const takeIconSource = (url: string): void => {
        setDraft((d) => ({ ...d, icon_source_url: url }));
        setAutoSuggestFor(url);
    };

    const onSave = (): Promise<void> =>
        run('save', async () => {
            let next = draft;
            // Cambió el original, el diseño o el fondo: los tamaños se generan ahora.
            const iconChanged =
                next.icon_source_url !== initial.icon_source_url ||
                JSON.stringify(next.icon_design) !== JSON.stringify(initial.icon_design) ||
                next.icon_background !== initial.icon_background ||
                next.icon_background_auto !== initial.icon_background_auto ||
                (next.icons !== null && !next.icons.maskable_dark_512);
            if (next.icon_source_url && (iconChanged || next.icons === null)) {
                next = { ...next, icons: await generateIconSet(next.icon_source_url, next) };
            }
            if (!next.icon_source_url) next = { ...next, icons: null, icon_design: null };
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
                    pestaña del navegador y en el teléfono cuando se instala. Las empresas
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

                <div className="imcrm-space-y-1.5">
                    <Label htmlFor="brand-marketing">Sitio del producto</Label>
                    <Input
                        id="brand-marketing"
                        type="url"
                        inputMode="url"
                        value={draft.marketing_url ?? ''}
                        maxLength={500}
                        onChange={(e) => {
                            const v = e.target.value.trim();
                            setDraft((d) => ({ ...d, marketing_url: v === '' ? null : v }));
                        }}
                        placeholder="https://imagina.cloud/base"
                        className="imcrm-max-w-sm"
                        aria-invalid={marketingError !== null}
                        data-testid="brand-marketing-url"
                    />
                    {marketingError ? (
                        <p className="imcrm-text-xs imcrm-text-destructive">{marketingError}</p>
                    ) : (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            La página donde presentas la app. El inicio de sesión muestra «Conoce …» con un enlace
                            ahí, sólo en este dominio (en el dominio propio de una empresa nunca aparece). Desde ese
                            sitio, enlaza el botón de registro a <code>/registro</code> de la app y agrega etiquetas
                            como <code>?utm_source=sitio&amp;utm_campaign=precios</code>: en Empresas verás de dónde
                            llegó cada una.
                        </p>
                    )}
                </div>

                <section className="imcrm-space-y-3">
                    <div>
                        <h3 className="imcrm-text-sm imcrm-font-semibold">Logo</h3>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            Horizontal, idealmente con fondo transparente (PNG o SVG). Se muestra en el inicio de
                            sesión.
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
                                    // v0.1.328 — sin ícono propio, un logo casi cuadrado también
                                    // pasa a ser el ícono (si no, la app instalada sale con el genérico).
                                    const res = await uploadLogoMaybeIconSource(file, draft.icon_source_url === null);
                                    setDraft((d) => ({ ...d, logo_url: res.logo_url }));
                                    if (res.icon_source_url) {
                                        takeIconSource(res.icon_source_url);
                                        toast.success('Usamos tu logo también como ícono de la app. Puedes ajustarlo abajo.');
                                    }
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
                        <h3 className="imcrm-text-sm imcrm-font-semibold">Ícono de la app</h3>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            Sube tu isotipo (el símbolo, cuadrado, de 512 × 512 px o más; PNG o SVG). La app lo arma como un
                            ícono de app con los colores de tu logo y genera sola todos los tamaños: el inicio del
                            teléfono, la pantalla con que abre la app, el computador y la pestaña del navegador.
                        </p>
                    </div>
                    <IconStudio
                        brand={draft}
                        onChange={patch}
                        busy={busy === 'icon'}
                        autoSuggestFor={autoSuggestFor}
                        onAutoSuggested={clearAutoSuggest}
                        onPickIcon={(file) => run('icon', async () => takeIconSource(await uploadIconSource(file)))}
                        onRemoveIcon={() => setDraft((d) => ({ ...d, icons: null, icon_source_url: null, icon_design: null }))}
                    />
                    {!draft.icon_source_url && draft.logo_url && (
                        <div
                            className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-xs"
                            data-testid="brand-icon-missing"
                        >
                            <span className="imcrm-min-w-[200px] imcrm-flex-1">
                                Todavía no hay ícono: la app instalada y la pestaña muestran el genérico. Puedes usar tu
                                logo como ícono (para la mejor calidad, sube el archivo original con «Subir ícono»).
                            </span>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy !== null}
                                data-testid="brand-icon-from-logo"
                                onClick={() => run('icon', async () => takeIconSource(await iconSourceFromSavedImage(draft.logo_url!)))}
                            >
                                Usar el logo como ícono
                            </Button>
                        </div>
                    )}
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-muted/60 imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground">
                        <Smartphone className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                        <span>
                            Si la app ya estaba instalada en un teléfono, el teléfono guarda el ícono y los colores de
                            cuando se instaló y los actualiza por su cuenta (Android puede tardar hasta un par de días).
                            Para verlo de inmediato, quita la app del teléfono y vuelve a instalarla. Para comprobar el
                            color de apertura, abre la app con el teléfono en <strong>modo claro</strong>: en modo oscuro
                            Android siempre usa su propio fondo.
                        </span>
                    </p>
                </section>

                {error && (
                    <p role="alert" className="imcrm-text-sm imcrm-text-destructive">
                        {error}
                    </p>
                )}
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                    <Button type="button" onClick={() => void onSave()} disabled={!dirty || busy !== null || marketingError !== null} data-testid="brand-save">
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

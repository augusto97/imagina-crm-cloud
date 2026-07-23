import { useEffect, useMemo } from 'react';
import { hexToHslTriplet } from '@/hooks/useBranding';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { isDataField, jsonbKeyForField, type Field, type PortalBoot } from '@imagina-base/shared';
import { PAGE_FONT_STACKS, readPageSettings } from '@/lib/blockStyle';
import { CloudApiError } from '@/lib/cloud/client';
import { formatValue } from '@/cloud/lib/fieldValue';
import { portalApi } from '@/cloud-portal/portalClient';
import { PortalRenderer, type PortalRendererData } from '@/portal/PortalRenderer';
import { setTenantFormat } from '@/lib/tenantFormat';
import type { PortalBlock, PortalBootData } from '@/portal/types';

/**
 * SPA del portal del cliente (ADR-S: F3 / CONTRACT §9). Dos rutas:
 *  - `/portal/acceso?token=…` canjea el magic link (abre la cookie de sesión)
 *    y redirige al portal.
 *  - `/portal` pide `GET /portal/me` y renderiza el record + su template.
 * BrowserRouter + fallback SPA en el server (Caddy en prod).
 */
export function PortalApp(): JSX.Element {
    return (
        <Routes>
            <Route path="/portal/acceso" element={<AccessPage />} />
            <Route path="/portal" element={<PortalPage />} />
            <Route path="*" element={<Navigate to="/portal" replace />} />
        </Routes>
    );
}

function AccessPage(): JSX.Element {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = params.get('token') ?? '';

    const consume = useMutation({
        mutationFn: () => portalApi.consumePortal(token),
        onSuccess: () => navigate('/portal', { replace: true }),
    });

    useEffect(() => {
        if (token) consume.mutate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    if (!token) return <Centered>Falta el token de acceso en el enlace.</Centered>;
    if (consume.isError) {
        const msg =
            consume.error instanceof CloudApiError
                ? consume.error.message
                : 'No se pudo validar el enlace.';
        return <Centered>{msg}</Centered>;
    }
    return <Centered>Validando tu acceso…</Centered>;
}

function PortalPage(): JSX.Element {
    const boot = useQuery({
        queryKey: ['portal-me'],
        queryFn: () => portalApi.portalMe(),
        retry: false,
    });

    if (boot.isError) return <Centered>Tu enlace expiró o no tenés acceso. Pedí uno nuevo.</Centered>;
    if (!boot.data) return <Centered>Cargando tu portal…</Centered>;

    return <PortalContent boot={boot.data} />;
}

function PortalContent({ boot }: { boot: PortalBoot }): JSX.Element {
    const dataFields = boot.fields.filter((f) => isDataField(f.type));

    // White-label: el portal sale con la marca de la empresa (mismo mecanismo
    // que el admin — re-pintamos los tokens del tema con el color del tenant).
    // Defensivo ante un boot sin branding (respuesta cacheada de una versión previa).
    const branding = boot.branding ?? { primary_color: null, app_name: null, logo_url: null };
    // v0.1.104 — el cliente ve montos/fechas con el formato regional de la
    // empresa (misma capa que el admin; tolerante a boots viejos sin format).
    useEffect(() => {
        setTenantFormat(boot.format ?? null);
    }, [boot.format]);
    useEffect(() => {
        const root = document.documentElement;
        const hsl = branding.primary_color ? hexToHslTriplet(branding.primary_color) : null;
        if (hsl) {
            root.style.setProperty('--imcrm-primary', hsl);
            root.style.setProperty('--imcrm-ring', hsl);
        } else {
            root.style.removeProperty('--imcrm-primary');
            root.style.removeProperty('--imcrm-ring');
        }
        return () => {
            root.style.removeProperty('--imcrm-primary');
            root.style.removeProperty('--imcrm-ring');
        };
    }, [branding.primary_color]);
    // Los bloques del portal leen el record por SLUG (herencia del plugin);
    // el backend keyea por f{id} → traducimos acá una sola vez.
    const rendererData = useMemo<PortalRendererData>(() => {
        const fields: Record<string, unknown> = {};
        const relations: Record<string, unknown> = {};
        for (const f of boot.fields) {
            const key = jsonbKeyForField(f.id);
            if (key in boot.record.data) fields[f.slug] = boot.record.data[key];
            const rel = boot.record.relations?.[key];
            if (rel !== undefined) relations[f.slug] = rel;
        }
        return {
            record: { id: boot.record.id, fields, relations },
            fields: boot.fields.map((f) => ({
                slug: f.slug,
                label: f.label,
                type: f.type,
                config: f.config,
            })),
            template: { blocks: boot.template as unknown as PortalBlock[] },
        };
    }, [boot]);

    const portalBoot = useMemo<PortalBootData>(
        () => ({
            rest_root: '/api/v1',
            list_slug: boot.list_slug,
            user_id: boot.user_id,
            record_id: boot.record.id,
        }),
        [boot],
    );

    const hasTemplate = rendererData.template.blocks.length > 0;

    // v0.1.94 — ajustes de página del portal diseñados en el editor:
    // fondo de página, ancho máximo del contenido y tipografía global.
    const page = readPageSettings(boot.template_page ?? undefined);
    const pageStyle: React.CSSProperties = {};
    if (page.bg !== undefined) pageStyle.backgroundColor = page.bg;
    if (page.font !== undefined) pageStyle.fontFamily = PAGE_FONT_STACKS[page.font];
    const contentStyle: React.CSSProperties =
        page.max_width !== undefined ? { maxWidth: `${page.max_width}px` } : {};

    return (
        <div className="imcrm-min-h-screen imcrm-bg-background imcrm-text-foreground" style={pageStyle}>
            <header className="imcrm-border-b imcrm-border-border imcrm-px-6 imcrm-py-4">
                <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-4xl imcrm-items-center imcrm-gap-3" style={contentStyle}>
                    {branding.logo_url && (
                        <img
                            src={branding.logo_url}
                            alt=""
                            className="imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-rounded-md imcrm-object-contain"
                        />
                    )}
                    <div>
                        <p className="imcrm-text-xs imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {branding.app_name ?? boot.list_name}
                        </p>
                        <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">Tu portal</h1>
                    </div>
                </div>
            </header>

            <main className="imcrm-mx-auto imcrm-max-w-4xl imcrm-space-y-4 imcrm-p-6" style={contentStyle}>
                {hasTemplate ? (
                    // Template diseñado en el editor: TODOS los tipos de bloque
                    // (estáticos + interactivos contra /portal/*).
                    <PortalRenderer boot={portalBoot} data={rendererData} />
                ) : (
                    // Sin template: fallback con los datos del record.
                    <section className="imcrm-space-y-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5">
                        <dl className="imcrm-space-y-3">
                            {dataFields.map((f) => (
                                <FieldRow key={f.id} field={f} value={boot.record.data[jsonbKeyForField(f.id)]} />
                            ))}
                        </dl>
                    </section>
                )}
            </main>
        </div>
    );
}

function FieldRow({ field, value }: { field: Field; value: unknown }): JSX.Element {
    const text = formatValue(field, value);
    return (
        <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-3 imcrm-border-b imcrm-border-border/60 imcrm-pb-2 last:imcrm-border-0">
            <dt className="imcrm-text-sm imcrm-font-medium imcrm-text-muted-foreground">{field.label}</dt>
            <dd className="imcrm-col-span-2 imcrm-text-sm">
                {text === '' ? <span className="imcrm-text-muted-foreground">—</span> : text}
            </dd>
        </div>
    );
}



function Centered({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-background imcrm-p-6 imcrm-text-center imcrm-text-muted-foreground">
            {children}
        </div>
    );
}

import { useEffect, useMemo, useState } from 'react';
import { useQuery as useRQ } from '@tanstack/react-query';
import { hexToHslTriplet } from '@/hooks/useBranding';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router';
import { isDataField, jsonbKeyForField, type Field, type PortalBoot } from '@imagina-base/shared';
import { hexLuminance, PAGE_FONT_STACKS, readPageSettings } from '@/lib/blockStyle';
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

    // v0.1.155 — un enlace sin token o ya usado/vencido terminaba en un cartel
    // muerto. Ahora cae en la misma pantalla de auto-servicio: el cliente se
    // manda uno nuevo sin depender de nadie.
    if (!token) return <RequestAccessScreen note="Ese enlace no trae el código de acceso." />;
    if (consume.isError) {
        const msg =
            consume.error instanceof CloudApiError
                ? consume.error.message
                : 'No se pudo validar el enlace.';
        return <RequestAccessScreen note={msg} />;
    }
    return <Centered>Validando tu acceso…</Centered>;
}

function PortalPage(): JSX.Element {
    const boot = useQuery({
        queryKey: ['portal-me'],
        queryFn: () => portalApi.portalMe(),
        retry: false,
    });

    // v0.1.154 — el enlace vence a las 24 h y la sesión a los 30 días de
    // inactividad: en vez de un cartel muerto, el cliente pide uno nuevo acá.
    if (boot.isError) return <RequestAccessScreen />;
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
                    <PortalRenderer
                        boot={portalBoot}
                        data={rendererData}
                        surfaceDark={page.bg !== undefined ? hexLuminance(page.bg) <= 0.5 : false}
                    />
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

                {/* v0.1.153 — "todo lo relacionado a mí": las listas que la
                    empresa habilitó en el panel del portal (sus facturas, sus
                    tickets…). El backend ya devuelve SOLO las filas del
                    cliente (scope del portal) y sin los campos ocultos. */}
                {(boot.related_lists ?? []).map((rel) => (
                    <RelatedListSection key={rel.list_id} slug={rel.slug} name={rel.name} />
                ))}
            </main>
        </div>
    );
}

/**
 * Una lista relacionada dentro del portal: "Mis facturas", "Mis tickets".
 * Pide `/portal/lists/:slug/records`, que ya viene acotado a lo del cliente.
 */
function RelatedListSection({ slug, name }: { slug: string; name: string }): JSX.Element | null {
    const q = useRQ({
        queryKey: ['portal-related', slug],
        queryFn: () => portalApi.portalRelatedRecords(slug, { per_page: 20 }),
        retry: false,
    });

    if (q.isError) return null;
    const cols = (q.data?.fields ?? []).slice(0, 6);
    return (
        <section className="imcrm-space-y-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5">
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-3">
                <h2 className="imcrm-text-base imcrm-font-semibold imcrm-tracking-tight">{name}</h2>
                {q.data && (
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {q.data.meta.total === 0
                            ? 'Sin registros'
                            : `${q.data.meta.total} ${q.data.meta.total === 1 ? 'registro' : 'registros'}`}
                    </span>
                )}
            </div>
            {!q.data ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">Cargando…</p>
            ) : q.data.data.length === 0 ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">Todavía no hay nada acá.</p>
            ) : (
                <div className="imcrm-overflow-x-auto">
                    <table className="imcrm-w-full imcrm-text-sm">
                        <thead>
                            <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-xs imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                {cols.map((c) => (
                                    <th key={c.slug} className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">
                                        {c.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {q.data.data.map((row) => (
                                <tr key={row.id} className="imcrm-border-b imcrm-border-border/60 last:imcrm-border-0">
                                    {cols.map((c) => (
                                        <td key={c.slug} className="imcrm-px-2 imcrm-py-2 imcrm-align-top">
                                            {renderPortalCell(c, row.fields[c.slug])}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

/** Formatea una celda de lista relacionada con el mismo criterio de la ficha. */
function renderPortalCell(
    col: { slug: string; label: string; type: string; config: Record<string, unknown> },
    value: unknown,
): string {
    const text = formatValue(
        { id: 0, list_id: 0, slug: col.slug, label: col.label, type: col.type, config: col.config } as unknown as Field,
        value,
    );
    return text === '' ? '—' : text;
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



/**
 * Sin sesión (o vencida): el cliente se manda solo un enlace nuevo. La
 * respuesta del backend es siempre la misma exista o no el email, así que el
 * mensaje de confirmación no confirma nada — es a propósito.
 */
function RequestAccessScreen({ note }: { note?: string } = {}): JSX.Element {
    const [email, setEmail] = useState('');
    const ask = useMutation({ mutationFn: () => portalApi.portalRequestAccess(email.trim()) });

    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-background imcrm-p-6">
            <div className="imcrm-w-full imcrm-max-w-sm imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6">
                <div className="imcrm-space-y-1">
                    <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">Entrar a tu portal</h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {note ?? 'Tu enlace de acceso venció o cerraste sesión.'} Escribí tu correo y te
                        mandamos uno nuevo.
                    </p>
                </div>
                {ask.isSuccess ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm">
                        Si ese correo tiene acceso, en unos segundos te llega un enlace. Revisá también la carpeta
                        de spam.
                    </p>
                ) : (
                    <form
                        className="imcrm-space-y-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (email.includes('@')) ask.mutate();
                        }}
                    >
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="tu@email.com"
                            className="imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                        />
                        <button
                            type="submit"
                            disabled={ask.isPending || !email.includes('@')}
                            className="imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-bg-primary imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground disabled:imcrm-opacity-60"
                        >
                            {ask.isPending ? 'Enviando…' : 'Enviarme un enlace'}
                        </button>
                    </form>
                )}
            </div>
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

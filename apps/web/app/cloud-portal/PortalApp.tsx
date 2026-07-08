import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { isDataField, jsonbKeyForField, type Field, type PortalBoot } from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { formatValue } from '@/cloud/lib/fieldValue';
import { portalApi } from '@/cloud-portal/portalClient';

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

    return (
        <div className="imcrm-min-h-screen imcrm-bg-background imcrm-text-foreground">
            <header className="imcrm-border-b imcrm-border-border imcrm-px-6 imcrm-py-4">
                <div className="imcrm-mx-auto imcrm-max-w-2xl">
                    <p className="imcrm-text-xs imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {boot.list_name}
                    </p>
                    <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">Tu portal</h1>
                </div>
            </header>

            <main className="imcrm-mx-auto imcrm-max-w-2xl imcrm-space-y-4 imcrm-p-6">
                <TemplateBlocks template={boot.template} />
                <section className="imcrm-space-y-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5">
                    <dl className="imcrm-space-y-3">
                        {dataFields.map((f) => (
                            <FieldRow key={f.id} field={f} value={boot.record.data[jsonbKeyForField(f.id)]} />
                        ))}
                    </dl>
                </section>
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

/**
 * Renderer mínimo del template del portal. El template es JSON libre
 * (`list.settings.portal_template`); acá cubrimos los bloques de texto más
 * comunes (heading/notice/static_text) y los desconocidos se ignoran en
 * silencio — mismo criterio de versionado que el renderer del plugin.
 */
function TemplateBlocks({ template }: { template: Array<Record<string, unknown>> }): JSX.Element | null {
    const blocks = template.filter((b) => typeof b['type'] === 'string');
    if (blocks.length === 0) return null;

    return (
        <>
            {blocks.map((block, i) => {
                const type = block['type'] as string;
                const config = (block['config'] as Record<string, unknown> | undefined) ?? block;
                const title = asText(config['title']);
                const body = asText(config['html'] ?? config['text'] ?? config['message']);
                if (type === 'heading') {
                    return (
                        <h2 key={i} className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                            {title ?? body ?? ''}
                        </h2>
                    );
                }
                if (type === 'notice') {
                    return (
                        <div
                            key={i}
                            className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-4 imcrm-text-sm"
                        >
                            {title && <p className="imcrm-font-medium">{title}</p>}
                            {body && <p className="imcrm-text-muted-foreground">{body}</p>}
                        </div>
                    );
                }
                if (type === 'static_text' && (title || body)) {
                    return (
                        <section key={i} className="imcrm-space-y-1">
                            {title && <h3 className="imcrm-text-sm imcrm-font-semibold">{title}</h3>}
                            {body && <p className="imcrm-text-sm imcrm-text-muted-foreground">{body}</p>}
                        </section>
                    );
                }
                return null;
            })}
        </>
    );
}

function asText(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-background imcrm-p-6 imcrm-text-center imcrm-text-muted-foreground">
            {children}
        </div>
    );
}

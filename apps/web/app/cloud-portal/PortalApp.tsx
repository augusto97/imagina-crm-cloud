import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router';
import { CloudApiError } from '@/lib/cloud/client';
import { portalApi } from '@/cloud-portal/portalClient';
import { setPortalAccount } from '@/portal/portalAccount';
import {
    HostBrandContext,
    PortalBrandSetterContext,
    applyPortalBrand,
    useHostBrand,
    type PortalBrand,
} from '@/cloud-portal/portalBrand';

/** El portal con sesión (diseño, gráficos, documentos) en su propio chunk. */
const loadPortalHome = () => import('@/cloud-portal/PortalHome');
const PortalHome = lazy(loadPortalHome);

/**
 * SPA del portal del cliente (ADR-S: F3 / CONTRACT §9). Dos rutas:
 *  - `/portal/acceso?token=…` canjea el magic link (abre la cookie de sesión)
 *    y redirige al portal.
 *  - `/portal` pide `GET /portal/me` y renderiza el record + su template.
 * BrowserRouter + fallback SPA en el server (Caddy en prod).
 */
export function PortalApp(): JSX.Element {
    // v0.1.245 — la marca del DOMINIO por el que se entró (sin sesión). En el
    // dominio de una empresa, las pantallas de entrar ya salen con su logo; en
    // el de la plataforma, un portal neutro (nunca la marca de la plataforma).
    const host = useQuery({
        queryKey: ['portal-host-boot'],
        queryFn: () => portalApi.publicBoot(),
        retry: 1,
        staleTime: Infinity,
    });
    const hostTenant = host.data?.tenant ?? null;
    const hostBrand: PortalBrand | null = hostTenant
        ? {
              name: hostTenant.app_name ?? (hostTenant.name || null),
              logoUrl: hostTenant.logo_url,
              primaryColor: hostTenant.primary_color,
          }
        : null;
    // La sesión, si hay una en pantalla, avisa SU marca (la de la cuenta).
    const [sessionBrand, setSessionBrand] = useState<PortalBrand | null>(null);
    const brand = sessionBrand ?? hostBrand;
    const brandKey = JSON.stringify(brand);
    useEffect(() => {
        applyPortalBrand(brand);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [brandKey]);

    return (
        <HostBrandContext.Provider value={hostBrand}>
            <PortalBrandSetterContext.Provider value={setSessionBrand}>
                <Routes>
                    <Route path="/portal/acceso" element={<AccessPage />} />
                    <Route path="/portal" element={<PortalPage />} />
                    <Route path="*" element={<Navigate to="/portal" replace />} />
                </Routes>
            </PortalBrandSetterContext.Provider>
        </HostBrandContext.Provider>
    );
}

function AccessPage(): JSX.Element {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const token = params.get('token') ?? '';
    // v0.1.241 — el enlace de "cambiar a otra empresa" trae la cuenta a abrir.
    const cuenta = params.get('cuenta');

    const consume = useMutation({
        mutationFn: () => portalApi.consumePortal(token),
        onSuccess: () => navigate(cuenta && /^\d+$/.test(cuenta) ? `/portal?cuenta=${cuenta}` : '/portal', { replace: true }),
    });

    // El enlace es de un solo uso: StrictMode monta el efecto dos veces y el
    // segundo canje daba 404 (mismo guard que la verificación de email).
    const consumed = useRef<string | null>(null);
    useEffect(() => {
        if (!token || consumed.current === token) return;
        consumed.current = token;
        consume.mutate();
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
    const [params, setParams] = useSearchParams();
    const qc = useQueryClient();
    const [loggedOut, setLoggedOut] = useState(false);
    // v0.1.241 — la cuenta elegida vive en la URL (`?cuenta=`), así recargar o
    // compartir la pestaña mantiene lo que se estaba mirando. Se fija ANTES de
    // pedir nada: todos los requests del portal la mandan.
    const raw = params.get('cuenta');
    const cuenta = raw && /^\d+$/.test(raw) ? Number(raw) : null;
    setPortalAccount(cuenta);

    const boot = useQuery({
        queryKey: ['portal-me', cuenta],
        queryFn: () => portalApi.portalMe(),
        retry: false,
        enabled: !loggedOut,
    });
    // El chunk del portal se baja EN PARALELO con /portal/me (no después).
    useEffect(() => {
        void loadPortalHome();
    }, []);

    // Una cuenta que ya no está (le quitaron ese acceso): se vuelve a la de
    // siempre en vez de mostrar un error.
    const stale = boot.error instanceof CloudApiError && boot.error.code === 'portal_account_not_found' && cuenta !== null;
    useEffect(() => {
        if (stale) setParams({}, { replace: true });
    }, [stale, setParams]);

    if (loggedOut) return <RequestAccessScreen note="Cerraste sesión." />;
    // v0.1.154 — el enlace vence a las 24 h y la sesión a los 30 días de
    // inactividad: en vez de un cartel muerto, el cliente pide uno nuevo aquí.
    if (boot.isError && !stale) return <RequestAccessScreen />;
    if (!boot.data) return <Centered>Cargando tu portal…</Centered>;

    return (
        <Suspense fallback={<Centered>Cargando tu portal…</Centered>}>
            <PortalHome
                key={boot.data.account_id ?? 0}
                boot={boot.data}
                onSelectAccount={(id) => setParams({ cuenta: String(id) })}
                onLogout={() => {
                    setPortalAccount(null);
                    qc.clear();
                    setLoggedOut(true);
                }}
            />
        </Suspense>
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
    const brand = useHostBrand();

    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-background imcrm-p-6">
            <div className="imcrm-w-full imcrm-max-w-sm imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6">
                <BrandMark />
                <div className="imcrm-space-y-1">
                    <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">
                        {brand?.name ? `Entrar al portal de ${brand.name}` : 'Entrar a tu portal'}
                    </h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {note ?? 'Tu enlace de acceso venció o cerraste sesión.'} Escribe tu correo y te
                        mandamos uno nuevo.
                    </p>
                </div>
                {ask.isSuccess ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm">
                        Si ese correo tiene acceso, en unos segundos te llega un enlace. Revisa también la carpeta
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
        <div className="imcrm-flex imcrm-min-h-screen imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-4 imcrm-bg-background imcrm-p-6 imcrm-text-center imcrm-text-muted-foreground">
            <BrandMark />
            {children}
        </div>
    );
}

/**
 * Logo + nombre de la empresa del dominio (v0.1.245). En el dominio de la
 * plataforma no hay empresa y no se dibuja nada: el portal queda neutro.
 */
function BrandMark(): JSX.Element | null {
    const brand = useHostBrand();
    if (!brand || (!brand.logoUrl && !brand.name)) return null;
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2.5" data-testid="imcrm-portal-brand">
            {brand.logoUrl && (
                <img src={brand.logoUrl} alt="" className="imcrm-h-10 imcrm-max-w-[160px] imcrm-object-contain" />
            )}
            {brand.name && !brand.logoUrl && (
                <span className="imcrm-text-base imcrm-font-semibold imcrm-text-foreground">{brand.name}</span>
            )}
        </div>
    );
}

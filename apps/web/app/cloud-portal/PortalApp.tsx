import { Suspense, createContext, lazy, useContext, useEffect, useRef, useState } from 'react';
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
    // v0.1.289 — el enlace de ENTRADA de una empresa (`/portal?empresa=acme`)
    // dice de qué empresa es la pantalla de entrar cuando no se entra por su
    // dominio. Se recuerda en este navegador para las pantallas siguientes.
    const [empresa] = useState(rememberEmpresa);
    // v0.1.245 — la marca del DOMINIO por el que se entró (sin sesión). En el
    // dominio de una empresa, las pantallas de entrar ya salen con su logo; en
    // el de la plataforma, un portal neutro (nunca la marca de la plataforma).
    // v0.1.289 — junto con si la empresa deja entrar con contraseña.
    const host = useQuery({
        queryKey: ['portal-login-options', empresa],
        queryFn: () => portalApi.portalLoginOptions(empresa),
        retry: 1,
        staleTime: Infinity,
    });
    const hostTenant = host.data?.tenant ?? null;
    const loginOptions: LoginOptions = { empresa: hostTenant ? empresa : null, password: host.data?.password === true };
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
            <LoginOptionsContext.Provider value={loginOptions}>
                <PortalBrandSetterContext.Provider value={setSessionBrand}>
                    <Routes>
                        <Route path="/portal/acceso" element={<AccessPage />} />
                        <Route path="/portal" element={<PortalPage />} />
                        <Route path="*" element={<Navigate to="/portal" replace />} />
                    </Routes>
                </PortalBrandSetterContext.Provider>
            </LoginOptionsContext.Provider>
        </HostBrandContext.Provider>
    );
}

/** v0.1.289 — cómo se puede entrar en esta pantalla (sin sesión). */
interface LoginOptions {
    /** Slug de la empresa del enlace de entrada (sólo si existe). */
    empresa: string | null;
    /** La empresa deja entrar con correo + contraseña. */
    password: boolean;
}
const LoginOptionsContext = createContext<LoginOptions>({ empresa: null, password: false });

const EMPRESA_KEY = 'imb-portal-empresa';

/**
 * `?empresa=` del enlace de entrada (y lo recuerda en este navegador: después
 * de entrar, salir o vencer el enlace, la pantalla sigue siendo la de esa
 * empresa). Tolerante: sin almacenamiento, sólo vale el de la URL.
 */
function rememberEmpresa(): string | null {
    const valid = (v: string | null): string | null => (v && /^[a-z0-9_-]{1,63}$/.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);
    const fromUrl = valid(new URLSearchParams(window.location.search).get('empresa'));
    try {
        if (fromUrl) window.localStorage.setItem(EMPRESA_KEY, fromUrl);
        return fromUrl ?? valid(window.localStorage.getItem(EMPRESA_KEY));
    } catch {
        return fromUrl;
    }
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
    const opts = useContext(LoginOptionsContext);
    const ask = useMutation({ mutationFn: () => portalApi.portalRequestAccess(email.trim(), opts.empresa) });
    const brand = useHostBrand();
    // v0.1.289 — con la contraseña permitida, se elige cómo entrar.
    const [mode, setMode] = useState<'link' | 'password'>('link');
    const passwordMode = opts.password && mode === 'password';

    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-background imcrm-p-4 sm:imcrm-p-6">
            <div className="imcrm-w-full imcrm-max-w-sm imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6">
                <BrandMark />
                <div className="imcrm-space-y-1">
                    <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">
                        {brand?.name ? `Entrar al portal de ${brand.name}` : 'Entrar a tu portal'}
                    </h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {passwordMode
                            ? 'Escribe tu correo y la contraseña que creaste en este portal.'
                            : `${note ?? (opts.password ? 'Elige cómo quieres entrar.' : 'Tu enlace de acceso venció o cerraste sesión.')} ${
                                  opts.password ? 'Con un enlace, escribe tu correo y te mandamos uno.' : 'Escribe tu correo y te mandamos uno nuevo.'
                              }`}
                    </p>
                </div>
                {opts.password && (
                    <div
                        role="tablist"
                        aria-label="Cómo entrar"
                        className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted imcrm-p-1"
                    >
                        {(
                            [
                                ['link', 'Con un enlace por correo'],
                                ['password', 'Con contraseña'],
                            ] as const
                        ).map(([m, label]) => (
                            <button
                                key={m}
                                type="button"
                                role="tab"
                                aria-selected={mode === m}
                                data-testid={`portal-login-mode-${m}`}
                                onClick={() => setMode(m)}
                                className={`imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-font-medium imcrm-transition-colors ${
                                    mode === m ? 'imcrm-bg-background imcrm-text-foreground imcrm-shadow-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}
                {passwordMode ? (
                    <PasswordLoginForm email={email} setEmail={setEmail} empresa={opts.empresa} onForgot={() => setMode('link')} />
                ) : ask.isSuccess ? (
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

/**
 * v0.1.289 — Entrar con correo + la contraseña del portal de ESTA empresa (no
 * la de ninguna otra cuenta). «¿Olvidaste tu contraseña?» = entrar con un
 * enlace y crear una nueva desde el menú.
 */
function PasswordLoginForm({
    email,
    setEmail,
    empresa,
    onForgot,
}: {
    email: string;
    setEmail: (v: string) => void;
    empresa: string | null;
    onForgot: () => void;
}): JSX.Element {
    const [password, setPassword] = useState('');
    const login = useMutation({
        mutationFn: () => portalApi.portalLogin({ email: email.trim(), password, empresa }),
        // Recarga completa: el portal arranca limpio con la sesión nueva.
        onSuccess: () => window.location.assign('/portal'),
    });
    const error = login.error instanceof CloudApiError ? login.error.message : login.isError ? 'No se pudo entrar. Prueba de nuevo.' : null;
    return (
        <form
            className="imcrm-space-y-3"
            onSubmit={(e) => {
                e.preventDefault();
                if (email.includes('@') && password) login.mutate();
            }}
        >
            <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                data-testid="portal-login-email"
                className="imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
            />
            <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
                data-testid="portal-login-password"
                className="imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
            />
            {error && (
                <p role="alert" className="imcrm-text-sm imcrm-text-destructive" data-testid="portal-login-error">
                    {error}
                </p>
            )}
            <button
                type="submit"
                disabled={login.isPending || !email.includes('@') || !password}
                data-testid="portal-login-submit"
                className="imcrm-h-10 imcrm-w-full imcrm-rounded-md imcrm-bg-primary imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground disabled:imcrm-opacity-60"
            >
                {login.isPending ? 'Entrando…' : 'Entrar'}
            </button>
            <button
                type="button"
                onClick={onForgot}
                className="imcrm-w-full imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
            >
                ¿Olvidaste tu contraseña? Entra con un enlace por correo y crea una nueva desde tu menú.
            </button>
        </form>
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

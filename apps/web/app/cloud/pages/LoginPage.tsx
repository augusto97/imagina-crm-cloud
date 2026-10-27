import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Eye, EyeOff, MailCheck, ShieldCheck } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { CloudApiError } from '@/lib/cloud/client';
import { isTransientError, withTransientRetry } from '@/lib/cloud/transientRetry';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppIdentity } from '@/hooks/useAppIdentity';
import { useTheme } from '@/lib/theme';
import { Illustration } from '@/admin/learn/illustrations/registry';
import { cn } from '@/lib/utils';

/** Login + registro contra el backend. Auth por cookie de sesión. */
export function LoginPage(): JSX.Element {
    const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [workspace, setWorkspace] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);
    const [busy, setBusy] = useState(false);
    // v0.1.120 — segundo paso: con 2FA activo la contraseña sola no abre sesión.
    const [challenge, setChallenge] = useState<string | null>(null);
    const [code, setCode] = useState('');
    const setSession = useSession((s) => s.setSession);
    // Marca: la de la empresa del dominio (white-label, ADR-S17) o la de la
    // plataforma (Plataforma → Marca). Sin logo subido, el nombre en texto.
    const identity = useAppIdentity();
    const appName = identity.name;
    const { resolved } = useTheme();
    const logo = resolved === 'dark' ? identity.logoDarkUrl : identity.logoUrl;
    const [logoBroken, setLogoBroken] = useState(false);
    useEffect(() => setLogoBroken(false), [logo]);
    const [showPassword, setShowPassword] = useState(false);
    const qc = useQueryClient();

    async function submit(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            if (mode === 'forgot') {
                await api.forgotPassword(email);
                setSent(true);
                return;
            }
            if (challenge !== null) {
                const session = await api.loginTwoFactor({ challenge, code });
                setSession(session);
                await qc.invalidateQueries({ queryKey: ['me'] });
                return;
            }
            const result =
                mode === 'login'
                    ? await withTransientRetry(() => api.login({ email, password }))
                    : await api.register({ email, password, name, workspace_name: workspace });
            if ('mfa_required' in result) {
                setChallenge(result.challenge);
                setPassword('');
                return;
            }
            setSession(result);
            await qc.invalidateQueries({ queryKey: ['me'] });
        } catch (err) {
            setError(
                isTransientError(err)
                    ? 'No pudimos conectar con el servidor. Prueba de nuevo en unos segundos.'
                    : err instanceof CloudApiError
                      ? err.message
                      : 'Error inesperado',
            );
        } finally {
            setBusy(false);
        }
    }

    const title =
        challenge !== null
            ? 'Verificación en dos pasos'
            : mode === 'login'
              ? 'Inicia sesión'
              : mode === 'register'
                ? 'Crea tu cuenta'
                : sent
                  ? 'Revisa tu correo'
                  : 'Recupera tu contraseña';
    const subtitle =
        challenge !== null
            ? 'Escribe el código de 6 dígitos de tu app de autenticación.'
            : mode === 'login'
              ? `Te damos la bienvenida a ${appName}.`
              : mode === 'register'
                ? 'Tu empresa queda lista en un minuto.'
                : sent
                  ? 'Si existe una cuenta con ese correo, te enviamos un enlace para crear una contraseña nueva. Vence en 30 minutos.'
                  : 'Escribe tu correo y te enviamos un enlace para crear una contraseña nueva.';
    const goTo = (next: 'login' | 'register' | 'forgot'): void => {
        setMode(next);
        setError(null);
        setSent(false);
    };

    return (
        <div className="imcrm-login imcrm-flex imcrm-min-h-[100dvh] imcrm-bg-background">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-px-6 imcrm-py-8 sm:imcrm-px-10 lg:imcrm-px-14">
                <header className="imcrm-flex imcrm-h-10 imcrm-items-center" data-testid="login-brand">
                    {logo && !logoBroken ? (
                        <img
                            src={logo}
                            alt={appName}
                            onError={() => setLogoBroken(true)}
                            className="imcrm-max-h-9 imcrm-max-w-[200px] imcrm-object-contain"
                        />
                    ) : (
                        <span className="imcrm-text-[17px] imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">
                            {appName}
                        </span>
                    )}
                </header>

                <main className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-py-10">
                    <form onSubmit={submit} className="imcrm-login-card imcrm-w-full imcrm-max-w-[380px]" noValidate={false}>
                        <div className="imcrm-mb-7 imcrm-space-y-2">
                            {challenge !== null && (
                                <span className="imcrm-mb-3 imcrm-inline-flex imcrm-h-11 imcrm-w-11 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-bg-muted imcrm-text-foreground">
                                    <ShieldCheck className="imcrm-h-5 imcrm-w-5" aria-hidden />
                                </span>
                            )}
                            {mode === 'forgot' && sent && (
                                <span className="imcrm-mb-3 imcrm-inline-flex imcrm-h-11 imcrm-w-11 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-bg-muted imcrm-text-foreground">
                                    <MailCheck className="imcrm-h-5 imcrm-w-5" aria-hidden />
                                </span>
                            )}
                            <h1 className="imcrm-text-[26px] imcrm-font-semibold imcrm-leading-tight imcrm-tracking-tight imcrm-text-foreground">
                                {title}
                            </h1>
                            <p className="imcrm-text-[14px] imcrm-leading-relaxed imcrm-text-muted-foreground">{subtitle}</p>
                        </div>

                        {challenge !== null ? (
                            <div className="imcrm-space-y-5">
                                <Field label="Código" id="mfa-code" hint="Si perdiste el teléfono, usa uno de tus códigos de respaldo.">
                                    <Input
                                        id="mfa-code"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value)}
                                        autoComplete="one-time-code"
                                        inputMode="text"
                                        autoFocus
                                        required
                                        className="imcrm-h-11 imcrm-text-center imcrm-text-lg imcrm-tracking-[0.3em]"
                                    />
                                </Field>
                                <ErrorBox error={error} />
                                <Button type="submit" className="imcrm-h-11 imcrm-w-full imcrm-text-[15px]" disabled={busy}>
                                    {busy ? 'Verificando…' : 'Verificar'}
                                </Button>
                                <BackLink
                                    onClick={() => {
                                        setChallenge(null);
                                        setCode('');
                                        setError(null);
                                    }}
                                />
                            </div>
                        ) : mode === 'forgot' && sent ? (
                            <BackLink label="Volver a iniciar sesión" onClick={() => goTo('login')} />
                        ) : (
                            <div className="imcrm-space-y-5">
                                {mode === 'register' && (
                                    <Field label="Tu nombre" id="name">
                                        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required className="imcrm-h-11" />
                                    </Field>
                                )}
                                <Field label="Correo" id="email">
                                    <Input
                                        id="email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        autoComplete="email"
                                        placeholder="tu@empresa.com"
                                        autoFocus
                                        required
                                        className="imcrm-h-11"
                                    />
                                </Field>
                                {mode !== 'forgot' && (
                                    <Field
                                        label="Contraseña"
                                        id="password"
                                        action={
                                            mode === 'login' ? (
                                                <button
                                                    type="button"
                                                    onClick={() => goTo('forgot')}
                                                    className="imcrm-text-[13px] imcrm-font-medium imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-text-foreground"
                                                >
                                                    ¿La olvidaste?
                                                </button>
                                            ) : null
                                        }
                                    >
                                        <div className="imcrm-relative">
                                            <Input
                                                id="password"
                                                type={showPassword ? 'text' : 'password'}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                                required
                                                className="imcrm-h-11 imcrm-pr-11"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword((v) => !v)}
                                                aria-label={showPassword ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                                                aria-pressed={showPassword}
                                                className="imcrm-absolute imcrm-inset-y-0 imcrm-right-0 imcrm-flex imcrm-w-11 imcrm-items-center imcrm-justify-center imcrm-rounded-r-lg imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-text-foreground"
                                            >
                                                {showPassword ? <EyeOff className="imcrm-h-4 imcrm-w-4" /> : <Eye className="imcrm-h-4 imcrm-w-4" />}
                                            </button>
                                        </div>
                                    </Field>
                                )}
                                {mode === 'register' && (
                                    <Field label="Nombre de tu empresa" id="workspace">
                                        <Input
                                            id="workspace"
                                            value={workspace}
                                            onChange={(e) => setWorkspace(e.target.value)}
                                            autoComplete="organization"
                                            required
                                            className="imcrm-h-11"
                                        />
                                    </Field>
                                )}

                                <ErrorBox error={error} />

                                <Button type="submit" className="imcrm-h-11 imcrm-w-full imcrm-text-[15px]" disabled={busy}>
                                    {busy
                                        ? 'Un momento…'
                                        : mode === 'login'
                                          ? 'Entrar'
                                          : mode === 'register'
                                            ? 'Crear cuenta'
                                            : 'Enviar enlace'}
                                </Button>

                                {mode === 'forgot' && <BackLink label="Volver a iniciar sesión" onClick={() => goTo('login')} />}
                            </div>
                        )}

                        {challenge === null && mode !== 'forgot' && (
                            <p className="imcrm-mt-8 imcrm-text-center imcrm-text-[14px] imcrm-text-muted-foreground">
                                {mode === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
                                <button
                                    type="button"
                                    onClick={() => goTo(mode === 'login' ? 'register' : 'login')}
                                    className="imcrm-font-medium imcrm-text-foreground imcrm-underline-offset-4 hover:imcrm-underline"
                                >
                                    {mode === 'login' ? 'Crea una' : 'Inicia sesión'}
                                </button>
                            </p>
                        )}
                    </form>
                </main>

                <footer className="imcrm-text-[12px] imcrm-text-muted-foreground">
                    © {new Date().getFullYear()} {appName}
                </footer>
            </div>

            <LoginShowcase />
        </div>
    );
}

/**
 * La mitad derecha (sólo en pantallas anchas): qué se puede hacer con la app,
 * con las mismas ilustraciones animadas del centro de aprendizaje (se pintan
 * con el tema y la marca de la empresa). Rotan solas cada pocos segundos.
 */
const SHOWCASE: ReadonlyArray<{ art: string; title: string; text: string }> = [
    { art: 'vistas-kanban', title: 'Tu trabajo, como lo prefieras', text: 'Tablas, tableros, calendarios y Gantt sobre los mismos datos.' },
    { art: 'tab-hero', title: 'Tus números, siempre al día', text: 'Tableros que se actualizan solos con cada registro.' },
    { art: 'auto-flujo', title: 'Lo repetitivo, en automático', text: 'Avisos, correos y tareas que se hacen sin que nadie los recuerde.' },
];

function LoginShowcase(): JSX.Element {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        if (reduce) return undefined;
        const id = window.setInterval(() => setIndex((i) => (i + 1) % SHOWCASE.length), 7000);
        return () => window.clearInterval(id);
    }, []);
    const slide = SHOWCASE[index]!;
    return (
        <aside
            aria-hidden
            className="imcrm-relative imcrm-m-3 imcrm-hidden imcrm-w-[min(46vw,720px)] imcrm-shrink-0 imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-overflow-hidden imcrm-rounded-[28px] imcrm-bg-canvas imcrm-px-12 imcrm-py-12 lg:imcrm-flex"
        >
            <div key={slide.art} className="imcrm-login-slide imcrm-relative imcrm-flex imcrm-w-full imcrm-max-w-[520px] imcrm-flex-col imcrm-gap-8">
                <div className="imcrm-overflow-hidden imcrm-rounded-xl imcrm-shadow-imcrm-lg">
                    <Illustration name={slide.art} />
                </div>
                <div className="imcrm-space-y-2 imcrm-text-center">
                    <p className="imcrm-text-[20px] imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">{slide.title}</p>
                    <p className="imcrm-text-[14px] imcrm-leading-relaxed imcrm-text-muted-foreground">{slide.text}</p>
                </div>
            </div>
            <div className="imcrm-relative imcrm-mt-10 imcrm-flex imcrm-gap-1.5">
                {SHOWCASE.map((s, i) => (
                    <span
                        key={s.art}
                        className={cn(
                            'imcrm-h-1.5 imcrm-rounded-full imcrm-transition-all imcrm-duration-300',
                            i === index ? 'imcrm-w-5 imcrm-bg-foreground/70' : 'imcrm-w-1.5 imcrm-bg-foreground/20',
                        )}
                    />
                ))}
            </div>
        </aside>
    );
}

function ErrorBox({ error }: { error: string | null }): JSX.Element | null {
    if (!error) return null;
    return (
        <p
            role="alert"
            className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-px-3 imcrm-py-2.5 imcrm-text-[13px] imcrm-text-destructive"
        >
            <AlertCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
            <span>{error}</span>
        </p>
    );
}

function BackLink({ onClick, label = 'Volver' }: { onClick: () => void; label?: string }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className="imcrm-inline-flex imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-text-[14px] imcrm-font-medium imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-text-foreground"
        >
            <ArrowLeft className="imcrm-h-4 imcrm-w-4" aria-hidden />
            {label}
        </button>
    );
}

function Field({
    label,
    id,
    hint,
    action,
    children,
}: {
    label: string;
    id: string;
    hint?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-space-y-1.5">
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
                <Label htmlFor={id} className="imcrm-text-[13px] imcrm-font-medium">
                    {label}
                </Label>
                {action}
            </div>
            {children}
            {hint && <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}

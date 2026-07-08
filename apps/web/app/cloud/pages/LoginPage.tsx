import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Login + registro contra el backend. Auth por cookie de sesión. */
export function LoginPage(): JSX.Element {
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [workspace, setWorkspace] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const setSession = useSession((s) => s.setSession);
    const qc = useQueryClient();

    async function submit(e: React.FormEvent): Promise<void> {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            const session =
                mode === 'login'
                    ? await api.login({ email, password })
                    : await api.register({ email, password, name, workspace_name: workspace });
            setSession(session);
            await qc.invalidateQueries({ queryKey: ['me'] });
        } catch (err) {
            setError(err instanceof CloudApiError ? err.message : 'Error inesperado');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-muted/30 imcrm-p-4">
            <form
                onSubmit={submit}
                className="imcrm-w-full imcrm-max-w-sm imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-sm"
            >
                <div className="imcrm-space-y-1">
                    <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                        Imagina Base
                    </h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {mode === 'login' ? 'Entrá a tu workspace' : 'Creá tu cuenta y workspace'}
                    </p>
                </div>

                {mode === 'register' && (
                    <Field label="Nombre" id="name">
                        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
                    </Field>
                )}
                <Field label="Email" id="email">
                    <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />
                </Field>
                <Field label="Contraseña" id="password">
                    <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </Field>
                {mode === 'register' && (
                    <Field label="Nombre del workspace" id="workspace">
                        <Input
                            id="workspace"
                            value={workspace}
                            onChange={(e) => setWorkspace(e.target.value)}
                            required
                        />
                    </Field>
                )}

                {error && (
                    <p className="imcrm-text-sm imcrm-text-destructive" role="alert">
                        {error}
                    </p>
                )}

                <Button type="submit" className="imcrm-w-full" disabled={busy}>
                    {busy ? '…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
                </Button>

                <button
                    type="button"
                    onClick={() => {
                        setMode(mode === 'login' ? 'register' : 'login');
                        setError(null);
                    }}
                    className="imcrm-w-full imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground"
                >
                    {mode === 'login' ? '¿No tenés cuenta? Registrate' : '¿Ya tenés cuenta? Entrá'}
                </button>
            </form>
        </div>
    );
}

function Field({
    label,
    id,
    children,
}: {
    label: string;
    id: string;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            {children}
        </div>
    );
}

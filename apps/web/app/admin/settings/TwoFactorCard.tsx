import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';

/**
 * v0.1.120 — Verificación en dos pasos (TOTP).
 *
 * El alta es de dos pasos a propósito: el servidor PROPONE un secreto y recién
 * lo activa cuando el usuario confirma un código — así nadie queda encerrado
 * afuera por haber escaneado mal el QR.
 */

/** El QR se dibuja en el cliente y sólo cuando hace falta (import diferido). */
function QrCanvas({ value }: { value: string }): JSX.Element {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        let alive = true;
        void import('qrcode').then((mod) => {
            if (alive && ref.current) {
                void mod.default.toCanvas(ref.current, value, { width: 190, margin: 1 });
            }
        });
        return () => {
            alive = false;
        };
    }, [value]);
    return (
        <canvas
            ref={ref}
            className="imcrm-rounded-md imcrm-bg-white imcrm-p-2 imcrm-ring-1 imcrm-ring-border"
        />
    );
}

function CopyButton({ text, label }: { text: string; label: string }): JSX.Element {
    const [done, setDone] = useState(false);
    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                    setDone(true);
                    window.setTimeout(() => setDone(false), 1500);
                });
            }}
        >
            {done ? (
                <Check className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" />
            ) : (
                <Copy className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" />
            )}
            {done ? __('¡Copiado!') : label}
        </Button>
    );
}

export function TwoFactorCard(): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
    const [code, setCode] = useState('');
    const [codes, setCodes] = useState<string[] | null>(null);
    const [password, setPassword] = useState('');
    const [disabling, setDisabling] = useState(false);

    const status = useQuery({
        queryKey: ['two-factor'],
        queryFn: () => api.twoFactorStatus(),
        staleTime: 15_000,
    });

    const start = useMutation({
        mutationFn: () => api.setupTwoFactor(),
        onSuccess: (data) => {
            setSetup(data);
            setCode('');
        },
        onError: (e: unknown) =>
            toast.error(__('No se pudo iniciar'), e instanceof Error ? e.message : undefined),
    });

    const enable = useMutation({
        mutationFn: () => api.enableTwoFactor(code),
        onSuccess: (data) => {
            setSetup(null);
            setCode('');
            setCodes(data.backup_codes);
            void qc.invalidateQueries({ queryKey: ['two-factor'] });
            void qc.invalidateQueries({ queryKey: ['me'] });
            toast.success(__('Verificación en dos pasos activada'));
        },
        onError: (e: unknown) =>
            toast.error(__('El código no coincide'), e instanceof Error ? e.message : undefined),
    });

    const regenerate = useMutation({
        mutationFn: () => api.regenerateBackupCodes(),
        onSuccess: (data) => {
            setCodes(data.backup_codes);
            void qc.invalidateQueries({ queryKey: ['two-factor'] });
        },
    });

    const disable = useMutation({
        mutationFn: () => api.disableTwoFactor(password),
        onSuccess: () => {
            setPassword('');
            setDisabling(false);
            setCodes(null);
            void qc.invalidateQueries({ queryKey: ['two-factor'] });
            void qc.invalidateQueries({ queryKey: ['me'] });
            toast.success(__('Verificación en dos pasos desactivada'));
        },
        onError: (e: unknown) =>
            toast.error(__('No se pudo desactivar'), e instanceof Error ? e.message : undefined),
    });

    const enabled = status.data?.enabled ?? false;

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div>
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                    <ShieldCheck className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Verificación en dos pasos')}
                </h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Además de la contraseña, al entrar te pedimos un código de tu teléfono. Si te roban la contraseña, no alcanza.')}
                </p>
            </div>

            {/* Códigos de respaldo recién generados: se muestran UNA vez. */}
            {codes !== null && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-p-4">
                    <div>
                        <p className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                            {__('Guardá estos códigos de respaldo')}
                        </p>
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Cada uno sirve UNA vez para entrar si perdés el teléfono. No se vuelven a mostrar.')}
                        </p>
                    </div>
                    <ul className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1 imcrm-font-mono imcrm-text-sm sm:imcrm-grid-cols-2">
                        {codes.map((c) => (
                            <li key={c}>{c}</li>
                        ))}
                    </ul>
                    <div className="imcrm-flex imcrm-gap-2">
                        <CopyButton text={codes.join('\n')} label={__('Copiar los códigos')} />
                        <Button variant="ghost" size="sm" onClick={() => setCodes(null)}>
                            {__('Ya los guardé')}
                        </Button>
                    </div>
                </div>
            )}

            {status.isLoading ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
            ) : enabled ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4">
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-foreground">
                        <ShieldCheck className="imcrm-h-4 imcrm-w-4 imcrm-text-success" />
                        {__('Está activa.')}{' '}
                        <span className="imcrm-text-muted-foreground">
                            {__('Códigos de respaldo sin usar:')} {status.data?.backup_codes_left ?? 0}
                        </span>
                    </p>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={regenerate.isPending}
                            onClick={() => regenerate.mutate()}
                        >
                            {__('Generar códigos nuevos')}
                        </Button>
                        {!disabling && (
                            <Button variant="ghost" size="sm" onClick={() => setDisabling(true)}>
                                <ShieldOff className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Desactivar')}
                            </Button>
                        )}
                    </div>
                    {disabling && (
                        <form
                            className="imcrm-flex imcrm-max-w-sm imcrm-flex-col imcrm-gap-2"
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (password !== '') disable.mutate();
                            }}
                        >
                            <Label htmlFor="mfa-pw">{__('Confirmá con tu contraseña')}</Label>
                            <Input
                                id="mfa-pw"
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <div className="imcrm-flex imcrm-gap-2">
                                <Button type="submit" size="sm" disabled={password === '' || disable.isPending}>
                                    {disable.isPending && (
                                        <Loader2 className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                    )}
                                    {__('Desactivar')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setDisabling(false);
                                        setPassword('');
                                    }}
                                >
                                    {__('Cancelar')}
                                </Button>
                            </div>
                        </form>
                    )}
                </div>
            ) : setup === null ? (
                <Button
                    variant="outline"
                    size="sm"
                    className="imcrm-self-start"
                    disabled={start.isPending}
                    onClick={() => start.mutate()}
                >
                    {start.isPending && <Loader2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                    {__('Activar')}
                </Button>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 sm:imcrm-flex-row">
                    <QrCanvas value={setup.otpauth_uri} />
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-3">
                        <div>
                            <p className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                                {__('1. Escaneá el código con tu app')}
                            </p>
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Google Authenticator, 1Password, Authy o la que uses. Si no podés escanear, cargá la clave a mano:')}
                            </p>
                            <p className="imcrm-mt-1 imcrm-break-all imcrm-font-mono imcrm-text-xs imcrm-text-foreground">
                                {setup.secret}
                            </p>
                            <div className="imcrm-mt-2">
                                <CopyButton text={setup.secret} label={__('Copiar la clave')} />
                            </div>
                        </div>
                        <form
                            className="imcrm-flex imcrm-flex-col imcrm-gap-2"
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (code.trim().length >= 6) enable.mutate();
                            }}
                        >
                            <Label htmlFor="mfa-confirm">{__('2. Escribí el código que muestra')}</Label>
                            <Input
                                id="mfa-confirm"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                placeholder="000000"
                                className="imcrm-max-w-[10rem]"
                            />
                            <div className="imcrm-flex imcrm-gap-2">
                                <Button type="submit" size="sm" disabled={enable.isPending}>
                                    {enable.isPending && (
                                        <Loader2 className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                    )}
                                    {__('Activar')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setSetup(null);
                                        setCode('');
                                    }}
                                >
                                    {__('Cancelar')}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </section>
    );
}

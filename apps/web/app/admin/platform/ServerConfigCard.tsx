import { CircleAlert, CircleCheck, Server } from 'lucide-react';
import type { ServerConfigCheckKey, ServerConfigStatus } from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { __ } from '@/lib/i18n';

/**
 * v0.1.362 — Plataforma → Diagnóstico → «Configuración del servidor». Nació de
 * un servidor instalado sin `NODE_ENV=production` (el runbook de ServerAvatar
 * no lo pedía): los formularios públicos quedaban en blanco y nadie podía
 * saber por qué sin entrar a la consola. La actualización completa sola lo que
 * falta (`deploy/env-heal.sh`); esta tarjeta lo muestra por si no pudo.
 */
const INFO: Record<ServerConfigCheckKey, { label: string; ok: string; bad: string; line: string }> = {
    production: {
        label: __('Modo producción'),
        ok: __('El servidor corre en modo producción.'),
        bad: __('El servidor no corre en modo producción: los formularios y tableros públicos pueden quedar en blanco, /metrics queda abierto y no se fuerza HTTPS.'),
        line: 'NODE_ENV=production',
    },
    secrets_key: {
        label: __('Clave de cifrado'),
        ok: __('Las contraseñas de correo, las conexiones y la verificación en dos pasos se guardan cifradas.'),
        bad: __('Falta la clave: las contraseñas de correo, las conexiones y la verificación en dos pasos se guardan sin cifrar.'),
        line: 'SECRETS_KEY=<openssl rand -hex 48>',
    },
    files_signing_secret: {
        label: __('Firma de enlaces'),
        ok: __('Los enlaces firmados (logo, códigos QR, archivos del portal) siguen valiendo después de reiniciar.'),
        bad: __('Falta la clave: los enlaces firmados (logo, códigos QR, archivos del portal) dejan de valer cada vez que el servidor se reinicia.'),
        line: 'FILES_SIGNING_SECRET=<openssl rand -hex 48>',
    },
    cookie_secure: {
        label: __('Cookies seguras'),
        ok: __('La sesión sólo viaja por HTTPS.'),
        bad: __('La sesión puede viajar sin HTTPS.'),
        line: 'COOKIE_SECURE=true',
    },
    app_base_url: {
        label: __('Dirección pública con https'),
        ok: __('Los enlaces de los correos salen con https.'),
        bad: __('La dirección pública no empieza con https://: los enlaces de los correos salen sin cifrado.'),
        line: 'APP_BASE_URL=https://tu-dominio',
    },
};

export function ServerConfigCard({ status }: { status: ServerConfigStatus }): JSX.Element {
    const bad = status.checks.filter((c) => !c.ok);
    // Corriendo desde el código (no desde una versión instalada) es normal no
    // estar en producción: se informa sin alarmar.
    const dev = !status.from_release && status.node_env !== 'production';

    return (
        <Card data-testid="server-config">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <Server className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>{__('Configuración del servidor')}</CardTitle>
                            <CardDescription>
                                {__('Lo que el archivo de configuración del servidor (shared/.env.production) tiene que tener para funcionar como producción.')}
                            </CardDescription>
                        </div>
                    </div>
                    <Badge
                        dot
                        variant={dev ? 'secondary' : bad.length === 0 ? 'success' : 'destructive'}
                        className="imcrm-shrink-0"
                        data-testid="server-config-status"
                    >
                        {dev
                            ? __('Desarrollo')
                            : bad.length === 0
                              ? __('En orden')
                              : bad.length === 1
                                ? __('1 cosa por revisar')
                                : `${bad.length} ${__('cosas por revisar')}`}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pt-0 imcrm-text-sm">
                {dev && (
                    <p className="imcrm-text-muted-foreground">
                        {__('Este servidor corre desde el código, no desde una versión instalada: es normal que no esté en modo producción.')}
                    </p>
                )}
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    {status.checks.map((c) => {
                        const info = INFO[c.key];
                        return (
                            <li key={c.key} className="imcrm-flex imcrm-items-start imcrm-gap-2" data-testid={`server-check-${c.key}`} data-ok={c.ok ? 'true' : 'false'}>
                                {c.ok ? (
                                    <CircleCheck className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-emerald-600" aria-hidden />
                                ) : (
                                    <CircleAlert
                                        className={dev ? 'imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground' : 'imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-destructive'}
                                        aria-hidden
                                    />
                                )}
                                <div className="imcrm-min-w-0">
                                    <span className="imcrm-font-medium">{info.label}</span>
                                    <span className="imcrm-text-muted-foreground"> — {c.ok ? info.ok : info.bad}</span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
                {bad.length > 0 && !dev && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-rose-500/30 imcrm-bg-rose-500/10 imcrm-p-3 imcrm-text-rose-900 dark:imcrm-text-rose-200">
                        <p>
                            {__('Cada actualización intenta completar el modo producción y las dos claves sola. Si sigue en rojo, no pudo escribir el archivo o el servicio lee su configuración de otro lado: agrega estas líneas a shared/.env.production y reinicia el servicio.')}
                        </p>
                        <pre className="imcrm-overflow-x-auto imcrm-rounded imcrm-bg-background/70 imcrm-p-2 imcrm-font-mono imcrm-text-xs imcrm-text-foreground" data-testid="server-config-lines">
                            {bad.map((c) => INFO[c.key].line).join('\n')}
                        </pre>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

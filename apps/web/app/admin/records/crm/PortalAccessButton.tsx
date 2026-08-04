import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2, Mail, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useFields } from '@/hooks/useFields';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import type { ListSummary } from '@/types/list';
import type { RecordEntity } from '@/types/record';

interface Props {
    list: ListSummary;
    record: RecordEntity;
}

interface AccessUser {
    user_id: number;
    email: string;
    name: string;
    created_at: string;
    last_access_at: string | null;
}

/**
 * Acceso al portal del cliente desde la ficha del registro.
 *
 * El vínculo cliente↔registro SIEMPRE se guardó (`portal_links`), pero hasta
 * v0.1.153 esta tarjeta no lo mostraba: había que re-tipear el email en cada
 * envío sin saber si el cliente ya tenía acceso ni si había entrado. Ahora
 * lista quién tiene acceso, cuándo entró por última vez, y permite reenviar el
 * enlace o quitarle el acceso (que revoca sus sesiones al instante).
 *
 * El enlace es un magic link de un solo uso: no crea contraseña. Reenviarlo NO
 * crea un acceso nuevo — es el mismo cliente entrando otra vez.
 */
export function PortalAccessButton({ list, record }: Props): JSX.Element | null {
    const enabled = readPortalEnabled(list.settings);
    const fields = useFields(list.id);
    const toast = useToast();
    const confirm = useConfirm();
    const qc = useQueryClient();

    const accessKey = ['portal-access', list.id, record.id] as const;
    const access = useQuery({
        queryKey: accessKey,
        queryFn: async (): Promise<AccessUser[]> => {
            const res = await api.get<{ users: AccessUser[] }>(
                `/lists/${encodeURIComponent(list.slug)}/portal/access?record_id=${record.id}`,
            );
            return res.data.users;
        },
        enabled,
        retry: false,
    });

    // Prefill del email desde el primer campo de tipo `email` con valor.
    const detectedEmail = useMemo(() => {
        const emailField = (fields.data ?? []).find((f) => f.type === 'email');
        if (!emailField) return '';
        const v = record.fields[emailField.slug];
        return typeof v === 'string' ? v : '';
    }, [fields.data, record.fields]);

    const [email, setEmail] = useState('');
    const [lastPath, setLastPath] = useState<string | null>(null);
    const value = email || detectedEmail;

    const issue = useMutation({
        mutationFn: async (
            to: string,
        ): Promise<{ token: string; path: string; email_sent?: boolean; email_error?: string | null }> => {
            const res = await api.post<{
                token: string;
                path: string;
                email_sent?: boolean;
                email_error?: string | null;
            }>(
                `/lists/${encodeURIComponent(list.slug)}/portal/magic-link`,
                { record_id: record.id, email: to },
            );
            return res.data;
        },
        onSuccess: (data, to) => {
            setLastPath(data.path);
            setEmail('');
            void qc.invalidateQueries({ queryKey: accessKey });
            // v0.1.150 — decir la verdad: si el SMTP rechazó el correo, el
            // enlace igual sirve (queda abajo para copiarlo), pero el cliente
            // NO lo recibió.
            if (data.email_sent === false) {
                toast.error(
                    __('El enlace se generó, pero el correo no salió'),
                    data.email_error ?? __('Revisá el SMTP en Ajustes → Correo.'),
                );
            } else {
                toast.success(__('Enlace de acceso enviado a'), to);
            }
        },
        onError: (err: unknown) => {
            toast.error(
                err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo emitir el acceso.'),
            );
        },
    });

    const revoke = useMutation({
        mutationFn: (userId: number) =>
            api.delete(`/lists/${encodeURIComponent(list.slug)}/portal/access/${userId}`),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: accessKey });
            toast.success(__('Acceso quitado.'));
        },
        onError: (err: unknown) => {
            toast.error(
                err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo quitar el acceso.'),
            );
        },
    });

    const copyLink = async (): Promise<void> => {
        if (!lastPath) return;
        const url = `${window.location.origin}${lastPath}`;
        try {
            await navigator.clipboard.writeText(url);
            toast.success(__('Enlace copiado al portapapeles.'));
        } catch {
            toast.info(__('Enlace de acceso'), url);
        }
    };

    const askRevoke = async (u: AccessUser): Promise<void> => {
        const yes = await confirm({
            title: __('¿Quitar el acceso al portal?'),
            description: `${u.email} ${__('dejará de ver este portal y se cerrarán sus sesiones. Podés volver a darle acceso cuando quieras.')}`,
            confirmLabel: __('Quitar acceso'),
            destructive: true,
        });
        if (yes) revoke.mutate(u.user_id);
    };

    if (!enabled) return null;

    const users = access.data ?? [];

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2.5">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <KeyRound className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">
                    {__('Acceso al portal del cliente')}
                </span>
                {users.length > 0 && <Badge variant="success">{__('Activo')}</Badge>}
            </div>

            {/* Quién tiene acceso hoy (persistido: no hace falta re-tipear nada). */}
            {users.map((u) => (
                <div
                    key={u.user_id}
                    className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2.5 imcrm-py-2"
                >
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{u.email}</p>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {u.last_access_at
                                ? `${__('Última entrada')}: ${formatDateTimeStr(u.last_access_at)}`
                                : __('Todavía no entró')}
                        </p>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="imcrm-gap-1.5"
                        disabled={issue.isPending}
                        onClick={() => issue.mutate(u.email)}
                    >
                        {issue.isPending ? (
                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                        ) : (
                            <Mail className="imcrm-h-3.5 imcrm-w-3.5" />
                        )}
                        {__('Reenviar enlace')}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-text-destructive"
                        disabled={revoke.isPending}
                        onClick={() => void askRevoke(u)}
                        aria-label={`${__('Quitar acceso')} ${u.email}`}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                </div>
            ))}

            {/* Alta de acceso: sólo hace falta la primera vez. */}
            {users.length === 0 && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Input
                        type="email"
                        placeholder={__('email del cliente')}
                        value={value}
                        onChange={(e) => setEmail(e.target.value)}
                        className="imcrm-h-8 imcrm-max-w-[240px] imcrm-flex-1"
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        className="imcrm-gap-1.5"
                        disabled={issue.isPending || !value.includes('@')}
                        onClick={() => issue.mutate(value)}
                    >
                        {issue.isPending ? (
                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                        ) : (
                            <Mail className="imcrm-h-3.5 imcrm-w-3.5" />
                        )}
                        {__('Dar acceso')}
                    </Button>
                </div>
            )}

            {lastPath && (
                <Button size="sm" variant="ghost" className="imcrm-w-fit imcrm-gap-1.5" onClick={() => void copyLink()}>
                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Copiar el último enlace')}
                </Button>
            )}
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('El enlace es de un solo uso y vence en 24 h. Reenviarlo no crea un acceso nuevo: es el mismo cliente entrando otra vez.')}
            </p>
        </div>
    );
}

/** Lee `settings.portal.enabled`. */
function readPortalEnabled(settings: Record<string, unknown>): boolean {
    const raw = settings.portal;
    if (raw === null || raw === undefined || typeof raw !== 'object') return false;
    return (raw as Record<string, unknown>).enabled === true;
}

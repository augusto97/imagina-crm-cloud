import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2, Mail, Trash2, UserPlus } from 'lucide-react';

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

interface AccessCheck {
    status: 'new' | 'this_record' | 'other_records' | 'staff';
    records: Array<{ list_name: string; record_id: number; record_title: string }>;
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
 *
 * v0.1.241 — una persona puede tener acceso a VARIOS registros de la empresa
 * (antes, darle acceso a otro reemplazaba el anterior en silencio). Antes de
 * dar un acceso nuevo se pregunta qué pasa con ese email en esta empresa: si
 * ya tiene otros, se avisa (se SUMA, no se reemplaza); si es del equipo, no se
 * da. Y un registro puede tener más de una persona con acceso.
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
    const [adding, setAdding] = useState(false);
    const [checking, setChecking] = useState(false);
    const value = email || (adding ? '' : detectedEmail);

    const issue = useMutation({
        mutationFn: async (
            to: string,
        ): Promise<{ token: string | null; path: string | null; email_sent?: boolean; email_error?: string | null }> => {
            const res = await api.post<{
                token: string | null;
                path: string | null;
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
            setAdding(false);
            void qc.invalidateQueries({ queryKey: accessKey });
            // v0.1.150 — decir la verdad: si el SMTP rechazó el correo, el
            // enlace igual sirve (queda abajo para copiarlo), pero el cliente
            // NO lo recibió.
            if (data.email_sent === false) {
                toast.error(
                    __('El enlace se generó, pero el correo no salió'),
                    data.path
                        ? (data.email_error ?? __('Revisá el SMTP en Ajustes → Correo.'))
                        : __('Esa cuenta ya existía fuera de esta empresa, así que el enlace sólo viaja por correo. Revisá el SMTP en Ajustes → Correo y volvé a enviarlo.'),
                );
            } else if (!data.path) {
                // SEC-24: la cuenta ya existía por su cuenta; el enlace le llega
                // sólo al dueño del correo (no se muestra para copiar).
                toast.success(__('Enlace de acceso enviado por correo a'), to);
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
        // v0.1.241 — sólo el acceso a ESTE registro: si la persona tiene otros
        // en la empresa, los conserva.
        mutationFn: (userId: number) =>
            api.delete(`/lists/${encodeURIComponent(list.slug)}/portal/access/${userId}?record_id=${record.id}`),
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

    /** Antes de dar un acceso NUEVO: ¿ya tiene otros acá? ¿es del equipo? */
    const grant = async (to: string): Promise<void> => {
        setChecking(true);
        let check: AccessCheck;
        try {
            const res = await api.get<AccessCheck>(
                `/lists/${encodeURIComponent(list.slug)}/portal/access/check?email=${encodeURIComponent(to.trim())}&record_id=${record.id}`,
            );
            check = res.data;
        } catch {
            // Sin el chequeo igual se puede dar el acceso: el backend valida.
            check = { status: 'new', records: [] };
        } finally {
            setChecking(false);
        }
        if (check.status === 'staff') {
            toast.error(
                __('Esa persona es del equipo de esta empresa'),
                __('El portal es para clientes. Para que vea esta lista, compartísela desde Compartir → Con tu equipo.'),
            );
            return;
        }
        if (check.status === 'other_records') {
            const names = check.records.map((r) => `«${r.record_title}» (${r.list_name})`).join(', ');
            const yes = await confirm({
                title: __('Ya tiene acceso al portal'),
                description: `${to.trim()} ${__('ya puede ver')} ${names}. ${__('Con esto suma este registro: no pierde lo que ya ve y desde su portal elige cuál mirar.')}`,
                confirmLabel: __('Dar acceso también a este'),
            });
            if (!yes) return;
        }
        issue.mutate(to);
    };

    const askRevoke = async (u: AccessUser): Promise<void> => {
        const yes = await confirm({
            title: __('¿Quitar el acceso al portal?'),
            description: `${u.email} ${__('dejará de ver este registro en el portal. Si no tiene otros accesos en la empresa, se cierran sus sesiones. Podés volver a darle acceso cuando quieras.')}`,
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

            {/* Alta de acceso: la primera vez, o "otra persona" (v0.1.241). */}
            {users.length === 0 || adding ? (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Input
                        type="email"
                        placeholder={users.length === 0 ? __('email del cliente') : __('email de la otra persona')}
                        value={value}
                        onChange={(e) => setEmail(e.target.value)}
                        className="imcrm-h-8 imcrm-max-w-[240px] imcrm-flex-1"
                        data-testid="portal-access-email"
                    />
                    <Button
                        size="sm"
                        variant="outline"
                        className="imcrm-gap-1.5"
                        disabled={issue.isPending || checking || !value.includes('@')}
                        onClick={() => void grant(value)}
                        data-testid="portal-access-grant"
                    >
                        {issue.isPending || checking ? (
                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                        ) : (
                            <Mail className="imcrm-h-3.5 imcrm-w-3.5" />
                        )}
                        {__('Dar acceso')}
                    </Button>
                    {adding && (
                        <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                            {__('Cancelar')}
                        </Button>
                    )}
                </div>
            ) : (
                <Button
                    size="sm"
                    variant="ghost"
                    className="imcrm-w-fit imcrm-gap-1.5"
                    onClick={() => setAdding(true)}
                    data-testid="portal-access-add-another"
                >
                    <UserPlus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Dar acceso a otra persona')}
                </Button>
            )}

            {lastPath && (
                <Button size="sm" variant="ghost" className="imcrm-w-fit imcrm-gap-1.5" onClick={() => void copyLink()}>
                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Copiar el último enlace')}
                </Button>
            )}
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('El enlace es de un solo uso y vence en 24 h. Una vez que entra, su sesión dura 30 días y se renueva cada vez que vuelve; si se le vence, puede pedirse uno nuevo solo desde la pantalla del portal.')}
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

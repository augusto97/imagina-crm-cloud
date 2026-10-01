import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api, useSession } from '@/cloud/session';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MemberInviteForm, MemberRow } from './MemberControls';

/**
 * Panel admin de miembros del workspace. Sólo se monta para el rol `admin`
 * (el backend igualmente lo exige, regla de oro: el front sólo oculta).
 *
 * v0.1.240: se INVITA por email — si la persona no tiene cuenta, se le crea y
 * le llega un correo para definir su contraseña (antes había que pedirle que
 * se registrara primero, y el registro le armaba una empresa propia vacía).
 * Las invitaciones sin abrir se ven como pendientes, con Reenviar. Guard rails
 * server-side: último admin, auto-baja, límite de usuarios del plan.
 */
export function MembersPanel(): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const meId = useSession((s) => s.user?.id ?? null);
    const invalidate = (): Promise<void> => qc.invalidateQueries({ queryKey: ['members', tenantId] });

    const membersQ = useQuery({
        queryKey: ['members', tenantId],
        queryFn: () => api.listMembers(),
    });
    const pending = membersQ.data?.filter((m) => m.pending).length ?? 0;

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Users className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>Miembros del workspace</CardTitle>
                        <CardDescription>
                            Invitá a tu equipo por email y elegí su rol. Si la persona no tiene cuenta, le llega un correo
                            para definir su contraseña; si ya tiene, queda sumada al instante. Los clientes del portal se
                            manejan desde la ficha de cada registro.
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                <MemberInviteForm
                    idPrefix="member"
                    onSubmit={async (input) => {
                        const r = await api.addMember(input);
                        await invalidate();
                        return r;
                    }}
                />

                <div className="imcrm-border-t imcrm-border-border imcrm-pt-3">
                    <p className="imcrm-mb-1 imcrm-text-xs imcrm-text-muted-foreground">
                        {membersQ.data
                            ? `${membersQ.data.length} ${membersQ.data.length === 1 ? 'persona' : 'personas'}${pending > 0 ? ` · ${pending} con invitación pendiente` : ''}`
                            : 'Cargando…'}
                    </p>
                    <ul className="imcrm-space-y-1">
                        {membersQ.data?.map((m) => (
                            <MemberRow
                                key={m.user_id}
                                member={m}
                                isSelf={m.user_id === meId}
                                onRole={async (role) => {
                                    await api.updateMemberRole(m.user_id, { role });
                                    await invalidate();
                                }}
                                onResend={() => api.resendMemberInvite(m.user_id)}
                                onRemove={async () => {
                                    await api.removeMember(m.user_id);
                                    await invalidate();
                                }}
                            />
                        ))}
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
}

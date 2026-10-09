import { Bell, Mail } from 'lucide-react';
import { NOTIFICATION_KIND_LABELS, NOTIFICATION_KINDS, type NotificationKind } from '@imagina-base/shared';

import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useNotificationPrefs, useUpdateNotificationPrefs } from '@/hooks/useNotifications';
import { __ } from '@/lib/i18n';
import { browserTimeZone, getTenantTimeZone } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

const DAYS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * v0.1.276 (ADR-S40) — Ajustes → Cuenta → Avisos. Por persona Y por empresa:
 * en la bandeja llega siempre todo; aquí se elige qué llega TAMBIÉN por correo
 * y el resumen diario (lo vencido, lo que vence hoy y lo sin leer).
 */
export function NotificationPrefsCard(): JSX.Element {
    const prefs = useNotificationPrefs();
    const update = useUpdateNotificationPrefs();
    const toast = useToast();
    const p = prefs.data;
    const tz = getTenantTimeZone() ?? browserTimeZone() ?? 'UTC';

    const save = (patch: Parameters<typeof update.mutate>[0]): void =>
        update.mutate(patch, {
            onSuccess: () => toast.success(__('Guardado')),
            onError: (err) => toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : String(err)),
        });

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="notification-prefs">
            <div>
                <h2 className="imcrm-text-base imcrm-font-semibold">{__('Avisos')}</h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Todo llega a la campana de la barra superior. Elige qué quieres recibir también por correo en esta empresa.')}
                </p>
            </div>

            {!p ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
            ) : (
                <>
                    <Card>
                        <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-pt-4">
                            <p className="imcrm-mb-1 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                <Mail className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                {__('Por correo, en el momento')}
                            </p>
                            {NOTIFICATION_KINDS.map((k: NotificationKind) => (
                                <label key={k} className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-rounded-md imcrm-px-2 imcrm-py-2 hover:imcrm-bg-accent/50">
                                    <span className="imcrm-text-sm">{__(NOTIFICATION_KIND_LABELS[k])}</span>
                                    <input
                                        type="checkbox"
                                        className="imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                        checked={p.email[k]}
                                        onChange={(e) => save({ email: { [k]: e.target.checked } })}
                                        data-pref-email={k}
                                    />
                                </label>
                            ))}
                            <p className="imcrm-px-2 imcrm-pt-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Como mucho 10 correos por hora: en una edición masiva el resto queda sólo en la campana.')}
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pt-4">
                            <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-justify-between imcrm-gap-3">
                                <span>
                                    <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                        <Bell className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                        {__('Resumen diario por correo')}
                                    </span>
                                    <span className="imcrm-mt-0.5 imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Lo vencido, lo que vence hoy y los avisos sin leer, en un solo correo. Si no hay nada, no llega.')}
                                    </span>
                                </span>
                                <input
                                    type="checkbox"
                                    className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                                    checked={p.digest === 'daily'}
                                    onChange={(e) => save({ digest: e.target.checked ? 'daily' : 'off' })}
                                    data-testid="pref-digest"
                                />
                            </label>
                            {p.digest === 'daily' && (
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3">
                                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                        {__('A las')}
                                        <Select
                                            value={String(p.digest_hour)}
                                            onChange={(e) => save({ digest_hour: Number(e.target.value) })}
                                            className="imcrm-h-8 imcrm-w-24"
                                            data-testid="pref-digest-hour"
                                        >
                                            {Array.from({ length: 24 }, (_, h) => (
                                                <option key={h} value={h}>
                                                    {`${String(h).padStart(2, '0')}:00`}
                                                </option>
                                            ))}
                                        </Select>
                                    </label>
                                    <div className="imcrm-flex imcrm-gap-1" role="group" aria-label={__('Días')}>
                                        {DAY_ORDER.map((d) => {
                                            const on = p.digest_days.includes(d);
                                            return (
                                                <button
                                                    key={d}
                                                    type="button"
                                                    aria-pressed={on}
                                                    onClick={() =>
                                                        save({ digest_days: on ? p.digest_days.filter((x) => x !== d) : [...p.digest_days, d] })
                                                    }
                                                    className={cn(
                                                        'imcrm-h-8 imcrm-w-8 imcrm-rounded-full imcrm-border imcrm-text-xs',
                                                        on ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-border-border hover:imcrm-bg-accent',
                                                    )}
                                                >
                                                    {__(DAYS[d]!)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="imcrm-w-full imcrm-text-[11px] imcrm-text-muted-foreground">
                                        {__('Hora de la empresa')} ({tz})
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </>
            )}
        </section>
    );
}

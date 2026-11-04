import { Link } from 'react-router';
import { AlertTriangle, CalendarCheck, CalendarX2, ExternalLink, Loader2, MapPin, Phone, Video } from 'lucide-react';
import {
    BOOKING_LOCATION_KINDS,
    BOOKING_LOCATION_LABELS,
    BOOKING_MAX_BUSY_CALENDARS,
    BOOKING_VIDEO_PROVIDERS,
    BOOKING_VIDEO_PROVIDER_LABELS,
    type BookingConfig,
    type BookingLocation,
    type BookingServiceItem,
    type BookingStaff,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useSession } from '@/cloud/session';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { Check, Field, Segmented } from '../automations/email/EmailBlockInspector';
import { isHttpsUrl, updateService, updateStaff } from './bookingDesignOps';
import { useConnectionCalendars, type BookingEditorOptions } from './useBookingPages';

/**
 * v0.1.350 — Piezas del constructor de la agenda que trae la entrega de
 * calendarios: dónde es cada servicio (videollamada, en persona, por
 * teléfono o un enlace fijo), el calendario de cada persona que atiende
 * (el suyo o una conexión de la empresa) y qué pasa cuando cambia la cita
 * en su calendario.
 */

const LOCATION_HINTS: Record<BookingLocation['kind'], string> = {
    page: 'Se usa «Dónde es la cita» de Publicar (por ejemplo, la dirección de la oficina).',
    video: 'Cada cita lleva su propio enlace de Google Meet o Microsoft Teams, que se crea en el calendario de quien atiende. El cliente lo recibe en el correo de confirmación.',
    in_person: 'La dirección va en la página, el correo y el archivo del calendario.',
    phone: 'Elige quién llama a quién.',
    link: 'El mismo enlace para todas las citas (una sala de Zoom, por ejemplo). El cliente lo ve recién cuando reservó, nunca en la página pública.',
};

const LOCATION_ICONS: Record<BookingLocation['kind'], typeof Video> = {
    page: MapPin,
    video: Video,
    in_person: MapPin,
    phone: Phone,
    link: ExternalLink,
};

/** «Dónde es» de un servicio. */
export function ServiceLocationEditor({ svc, config, onChange }: { svc: BookingServiceItem; config: BookingConfig; onChange: (next: BookingConfig) => void }): JSX.Element {
    const loc = svc.location;
    const set = (patch: Partial<BookingLocation>): void => onChange(updateService(config, svc.id, { location: { ...loc, ...patch } }));
    const Icon = LOCATION_ICONS[loc.kind];
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-2" data-testid="service-location">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-text-xs imcrm-font-medium">{__('Dónde es')}</span>
                <Select
                    value={loc.kind}
                    // Un enlace a medio escribir no queda escondido trabando el guardado.
                    onChange={(e) => set({ kind: e.target.value as BookingLocation['kind'], ...(isHttpsUrl(loc.url) ? {} : { url: '' }) })}
                    className="imcrm-h-8 imcrm-flex-1"
                    aria-label={__('Dónde es')}
                    data-testid="service-location-kind"
                >
                    {BOOKING_LOCATION_KINDS.map((k) => (
                        <option key={k} value={k}>
                            {__(BOOKING_LOCATION_LABELS[k])}
                        </option>
                    ))}
                </Select>
            </div>
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {loc.kind === 'page' && config.settings.location.trim() !== ''
                    ? sprintf(__('Se usa «%s» (Publicar → Dónde es la cita).'), config.settings.location.trim())
                    : __(LOCATION_HINTS[loc.kind])}
            </p>
            {loc.kind === 'video' && (
                <Field label={__('Videollamada')} hint={loc.video === 'auto' ? __('Google Meet si quien atiende usa Google Calendar; Microsoft Teams si usa Outlook.') : undefined}>
                    <Select value={loc.video} onChange={(e) => set({ video: e.target.value as BookingLocation['video'] })} className="imcrm-h-8" data-testid="service-location-video">
                        {BOOKING_VIDEO_PROVIDERS.map((v) => (
                            <option key={v} value={v}>
                                {__(BOOKING_VIDEO_PROVIDER_LABELS[v])}
                            </option>
                        ))}
                    </Select>
                </Field>
            )}
            {loc.kind === 'in_person' && (
                <Field label={__('Dirección')}>
                    <Input
                        value={loc.address}
                        onChange={(e) => set({ address: e.target.value })}
                        placeholder={config.settings.location.trim() || __('Calle 10 # 40-20, consultorio 302')}
                        maxLength={500}
                        className="imcrm-h-8"
                        data-testid="service-location-address"
                    />
                </Field>
            )}
            {loc.kind === 'phone' && (
                <>
                    <Segmented
                        label={__('Quién llama')}
                        value={loc.phone}
                        options={[
                            { value: 'client', label: __('Llamamos al cliente') },
                            { value: 'company', label: __('El cliente nos llama') },
                        ]}
                        onChange={(v) => set({ phone: v })}
                    />
                    {loc.phone === 'client' ? (
                        config.settings.ask_phone === 'hidden' ? (
                            <p className="imcrm-text-[11px] imcrm-text-destructive">{__('La página no le pide el teléfono al cliente: pídelo en Campos de la lista.')}</p>
                        ) : (
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Se llama al teléfono que deja el cliente al reservar.')}</p>
                        )
                    ) : (
                        <Field label={__('Número al que llama el cliente')}>
                            <Input value={loc.phone_number} onChange={(e) => set({ phone_number: e.target.value })} placeholder="+57 601 555 1234" maxLength={60} className="imcrm-h-8" data-testid="service-location-phone" />
                        </Field>
                    )}
                </>
            )}
            {loc.kind === 'link' && (
                <Field label={__('Enlace')}>
                    <Input
                        type="url"
                        value={loc.url}
                        onChange={(e) => set({ url: e.target.value.trim() })}
                        placeholder="https://zoom.us/j/123456789"
                        className={cn('imcrm-h-8', loc.url !== '' && !loc.url.startsWith('https://') && 'imcrm-border-destructive')}
                        data-testid="service-location-url"
                    />
                    {loc.url !== '' && !loc.url.startsWith('https://') && <p className="imcrm-text-[11px] imcrm-text-destructive">{__('Tiene que empezar por https://')}</p>}
                </Field>
            )}
            {loc.kind !== 'page' && (
                <Field label={__('Indicaciones para el cliente (opcional)')}>
                    <Input
                        value={loc.note}
                        onChange={(e) => set({ note: e.target.value })}
                        placeholder={loc.kind === 'in_person' ? __('Toca el timbre del 302') : loc.kind === 'video' ? __('Conéctate 5 minutos antes') : __('Ten a mano tu número de cliente')}
                        maxLength={300}
                        className="imcrm-h-8"
                    />
                </Field>
            )}
        </div>
    );
}

/**
 * El calendario de una persona que atiende: el suyo («Mi calendario», que
 * conecta y elige ella) o una conexión de la empresa (con sus calendarios,
 * que elige quien arma la agenda).
 */
export function StaffCalendarPanel({
    staff,
    config,
    onChange,
    options,
    listId,
}: {
    staff: BookingStaff;
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
    options: BookingEditorOptions;
    listId: number;
}): JSX.Element {
    const meId = useSession((s) => s.user?.id ?? null);
    const set = (patch: Partial<BookingStaff>): void => onChange(updateStaff(config, staff.id, patch));
    const member = options.members.find((m) => m.id === staff.staff_user_id);
    const own = member?.calendar ?? null;
    // La empresa: las conexiones del equipo (y una privada de esa misma persona, de antes).
    const companyCalendars = options.calendars.filter((c) => c.owner_user_id === null || (staff.staff_user_id !== null && c.owner_user_id === staff.staff_user_id));
    const chosen = companyCalendars.find((c) => c.id === staff.connection_id) ?? null;
    const usesVideo = config.services.some((s) => s.active && s.location.kind === 'video' && (staff.services.length === 0 || staff.services.includes(s.id)));
    const isMe = meId !== null && staff.staff_user_id === meId;
    const hasCalendar = staff.calendar_source === 'person' ? own !== null : chosen !== null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-2" data-testid="staff-calendar-panel">
            <Segmented
                label={__('Su calendario')}
                value={staff.calendar_source}
                options={[
                    { value: 'person', label: __('El suyo') },
                    { value: 'connection', label: __('Una conexión de la empresa') },
                ]}
                onChange={(v) => set({ calendar_source: v, ...(v === 'person' ? { connection_id: null, busy_calendars: [], write_calendar: null } : {}) })}
            />
            {staff.calendar_source === 'person' ? (
                staff.staff_user_id === null ? (
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Elige primero a la persona.')}</p>
                ) : own ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="staff-own-calendar">
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                            <CalendarCheck className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-success" aria-hidden />
                            <span>
                                {own.provider === 'google_calendar' ? 'Google Calendar' : 'Outlook'}
                                {own.account ? ` · ${own.account}` : ''}
                            </span>
                        </p>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {own.busy_count > 1
                                ? sprintf(__('Mira lo ocupado en %d calendarios.'), own.busy_count)
                                : __('Mira lo ocupado en su calendario principal.')}{' '}
                            {isMe ? (
                                <Link to="/settings?s=calendario" className="imcrm-text-primary hover:imcrm-underline">
                                    {__('Cambiar mis calendarios')}
                                </Link>
                            ) : (
                                __('Cuáles mira lo elige la persona en Ajustes → Cuenta → Mi calendario.')
                            )}
                        </p>
                        {own.problem && (
                            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-destructive">
                                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                                {own.problem}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-muted-foreground" data-testid="staff-own-calendar-missing">
                        <CalendarX2 className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                        <p>
                            {isMe ? (
                                <>
                                    {__('Todavía no conectaste tu calendario.')}{' '}
                                    <Link to="/settings?s=calendario" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline" data-testid="staff-connect-mine">
                                        {__('Conectar mi calendario')}
                                    </Link>
                                </>
                            ) : (
                                __('Todavía no conectó su calendario. Lo conecta la persona desde Ajustes → Cuenta → Mi calendario, con su propia cuenta de Google u Outlook.')
                            )}
                        </p>
                    </div>
                )
            ) : (
                <>
                    <Field label={__('Conexión')}>
                        <Select
                            value={staff.connection_id === null ? '' : String(staff.connection_id)}
                            onChange={(e) => set({ connection_id: e.target.value === '' ? null : Number(e.target.value), busy_calendars: [], write_calendar: null })}
                            className="imcrm-h-8"
                            data-testid="staff-calendar"
                        >
                            <option value="">{__('Ninguna')}</option>
                            {companyCalendars.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.account ? ` · ${c.account}` : ''}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    {companyCalendars.length === 0 && (
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('No hay calendarios de la empresa conectados. Se conectan en Ajustes → Integraciones (Google Calendar u Outlook).')}</p>
                    )}
                    {chosen && chosen.owner_user_id === null && <CompanyCalendarChooser listId={listId} staff={staff} onChange={set} />}
                </>
            )}
            {hasCalendar && (
                <>
                    <Check label={__('No ofrecer los horarios ocupados en su calendario')} checked={staff.read_busy} onChange={(v) => set({ read_busy: v })} />
                    <Check label={__('Agregar cada cita a su calendario')} checked={staff.create_events} onChange={(v) => set({ create_events: v })} />
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Del calendario sólo se lee la hora de inicio y de fin de cada evento: nunca el título, la descripción ni los invitados.')}
                    </p>
                </>
            )}
            {usesVideo && (
                <Field
                    label={__('Su enlace de videollamada fijo (opcional)')}
                    hint={
                        hasCalendar
                            ? __('Si la videollamada no se puede crear en su calendario (por ejemplo, una cuenta personal de Microsoft sin Teams), se usa este.')
                            : __('Sin calendario conectado, las videollamadas de esta persona usan este enlace.')
                    }
                >
                    <Input
                        type="url"
                        value={staff.meeting_url}
                        onChange={(e) => set({ meeting_url: e.target.value.trim() })}
                        placeholder="https://meet.google.com/abc-defg-hij"
                        className={cn('imcrm-h-8', staff.meeting_url !== '' && !staff.meeting_url.startsWith('https://') && 'imcrm-border-destructive')}
                        data-testid="staff-meeting-url"
                    />
                </Field>
            )}
        </div>
    );
}

/** En una conexión de la empresa: en cuáles calendarios mirar lo ocupado y en cuál crear las citas. */
function CompanyCalendarChooser({ listId, staff, onChange }: { listId: number; staff: BookingStaff; onChange: (patch: Partial<BookingStaff>) => void }): JSX.Element {
    const q = useConnectionCalendars(listId, staff.connection_id, true);
    if (q.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" aria-hidden />
                {__('Leyendo los calendarios de la cuenta…')}
            </p>
        );
    }
    if (q.isError || !q.data) {
        return <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('No se pudo leer la lista de calendarios de esta cuenta: se usa el principal.')}</p>;
    }
    const items = q.data;
    if (items.length <= 1) return <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Esta cuenta tiene un solo calendario: se usa ese.')}</p>;
    const busy = new Set(staff.busy_calendars);
    const isBusy = (id: string, primary: boolean): boolean => (staff.busy_calendars.length === 0 ? primary : busy.has(id));
    const toggle = (id: string, on: boolean): void => {
        const current = staff.busy_calendars.length === 0 ? items.filter((c) => c.primary).map((c) => c.id) : [...staff.busy_calendars];
        const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
        // Sólo el principal = lo de siempre (vacío).
        const onlyPrimary = next.length === 1 && items.find((c) => c.id === next[0])?.primary === true;
        onChange({ busy_calendars: onlyPrimary || next.length === 0 ? [] : next.slice(0, BOOKING_MAX_BUSY_CALENDARS) });
    };
    const writable = items.filter((c) => c.can_write);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="staff-company-calendars">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <span className="imcrm-text-[11px] imcrm-font-medium">{__('Mirar lo ocupado en')}</span>
                {items.map((c) => (
                    <Check key={c.id} label={c.primary ? sprintf(__('%s (principal)'), c.name) : c.name} checked={isBusy(c.id, c.primary)} onChange={(v) => toggle(c.id, v)} />
                ))}
            </div>
            {writable.length > 1 && (
                <Field label={__('Crear las citas en')}>
                    <Select
                        value={staff.write_calendar ?? ''}
                        onChange={(e) => onChange({ write_calendar: e.target.value === '' || items.find((c) => c.id === e.target.value)?.primary ? null : e.target.value })}
                        className="imcrm-h-8"
                        data-testid="staff-write-calendar"
                    >
                        {writable.map((c) => (
                            <option key={c.id} value={c.primary ? '' : c.id}>
                                {c.primary ? sprintf(__('%s (principal)'), c.name) : c.name}
                            </option>
                        ))}
                    </Select>
                </Field>
            )}
        </div>
    );
}

/** Qué pasa cuando quien atiende cambia la cita en su propio calendario. */
export function CalendarSyncEditor({ config, onChange }: { config: BookingConfig; onChange: (next: BookingConfig) => void }): JSX.Element {
    const sync = config.calendar_sync;
    const set = (patch: Partial<typeof sync>): void => onChange({ ...config, calendar_sync: { ...sync, ...patch } });
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-testid="calendar-sync">
            <span className="imcrm-text-xs imcrm-font-medium">{__('Si quien atiende cambia la cita en su calendario')}</span>
            <Check label={__('Si mueve el evento, mover la cita')} checked={sync.move} onChange={(v) => set({ move: v })} testId="calendar-sync-move" />
            <Check label={__('Si borra el evento, cancelar la cita')} checked={sync.cancel} onChange={(v) => set({ cancel: v })} testId="calendar-sync-cancel" />
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {config.notifications.notify_client_on_team_change
                    ? __('Se revisa cada pocos minutos y al cliente se le avisa por correo, como cuando el equipo la cambia desde la app.')
                    : __('Se revisa cada pocos minutos. Al cliente no se le avisa (Correos y recordatorios → avisarle cuando el equipo cambia la cita).')}
            </p>
        </div>
    );
}

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Copy, ImagePlus, Loader2, Plus, Trash2, Users, X } from 'lucide-react';
import {
    BOOKING_DURATION_PRESETS,
    BOOKING_MAX_SEATS,
    BOOKING_SLOT_INTERVALS,
    HOLIDAY_COUNTRIES,
    durationLabel,
    holidayBlocksByDefault,
    serviceDurations,
    type BookingConfig,
    type BookingInterval,
    type BookingServiceItem,
    type BookingStaff,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useAttachment } from '@/hooks/useAttachments';
import { __, sprintf } from '@/lib/i18n';
import { formatDateStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { Check, Field } from '../automations/email/EmailBlockInspector';
import { uploadOne } from '../records/FileFieldControl';
import {
    addTimeOff,
    dayProblem,
    nextInterval,
    removeTimeOff,
    setDefaultDuration,
    setHolidayCountry,
    setHolidayWorked,
    setServiceDayIntervals,
    setServiceHours,
    toggleServiceDuration,
    updateService,
    updateStaff,
    updateTimeOff,
    copyHolidaysToAll,
    moveService,
    removeService,
} from './bookingDesignOps';
import { useBookingHolidays } from './useBookingPages';

/**
 * v0.1.349 — Piezas del constructor de la agenda que trae la entrega de
 * reglas: la tarjeta de cada servicio (duraciones, cupos, horario y reglas
 * propias), los festivos por país, las vacaciones y el perfil de quien
 * atiende (foto, cargo y descripción).
 */

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DURATION_CHOICES = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];

export function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-pointer-events-none disabled:imcrm-opacity-40"
        >
            {children}
        </button>
    );
}

function minutesLabel(n: number): string {
    if (n === 0) return __('Sin aviso mínimo');
    if (n < 60) return `${n} min`;
    if (n % 1440 === 0) return `${n / 1440} ${n === 1440 ? __('día') : __('días')}`;
    return `${n / 60} h`;
}

export const NOTICE_OPTIONS = [0, 30, 60, 120, 240, 720, 1440, 2880, 4320, 10080];

export function intervalLabel(n: number): string {
    if (n === 0) return __('Lo que dura la cita');
    return n < 60 ? `${n} min` : `${n / 60} h`;
}

/** El horario de una semana (tramos por día) — el de quien atiende o el propio de un servicio. */
export function WeekHoursEditor({
    week,
    onDay,
    onCopyWeekdays,
    testId,
}: {
    week: BookingInterval[][];
    onDay: (dow: number, intervals: BookingInterval[]) => void;
    onCopyWeekdays?: (dow: number) => void;
    testId?: string;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid={testId}>
            {WEEK_ORDER.map((dow) => {
                const day = week[dow] ?? [];
                const problem = dayProblem(day);
                return (
                    <div key={dow} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-px-3 imcrm-py-2" data-day={dow}>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <label className="imcrm-flex imcrm-w-28 imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input type="checkbox" checked={day.length > 0} onChange={(e) => onDay(dow, e.target.checked ? [{ start: '08:00', end: '17:00' }] : [])} data-day-toggle={dow} />
                                {__(DAY_NAMES[dow]!)}
                            </label>
                            {day.length === 0 && <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('No atiende')}</span>}
                            {onCopyWeekdays && day.length > 0 && dow >= 1 && dow <= 5 && (
                                <button type="button" className="imcrm-ml-auto imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline" onClick={() => onCopyWeekdays(dow)}>
                                    {__('Copiar a lun–vie')}
                                </button>
                            )}
                        </div>
                        {day.map((t, i) => (
                            <div key={i} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-pl-6">
                                <Input
                                    type="time"
                                    step={300}
                                    value={t.start}
                                    onChange={(e) => onDay(dow, day.map((x, j) => (j === i ? { ...x, start: e.target.value || x.start } : x)))}
                                    className="imcrm-h-8 imcrm-w-32"
                                    aria-label={__('Desde')}
                                    data-interval-start={`${dow}-${i}`}
                                />
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">–</span>
                                <Input
                                    type="time"
                                    step={300}
                                    value={t.end === '24:00' ? '23:59' : t.end}
                                    onChange={(e) => onDay(dow, day.map((x, j) => (j === i ? { ...x, end: e.target.value || x.end } : x)))}
                                    className="imcrm-h-8 imcrm-w-32"
                                    aria-label={__('Hasta')}
                                    data-interval-end={`${dow}-${i}`}
                                />
                                <IconBtn label={__('Quitar el tramo')} onClick={() => onDay(dow, day.filter((_, j) => j !== i))}>
                                    <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                </IconBtn>
                                {i === day.length - 1 && nextInterval(day) && day.length < 6 && (
                                    <IconBtn label={__('Agregar otro tramo')} onClick={() => onDay(dow, [...day, nextInterval(day)!])}>
                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </IconBtn>
                                )}
                            </div>
                        ))}
                        {problem && <p className="imcrm-pl-6 imcrm-text-[11px] imcrm-text-destructive">{__(problem)}</p>}
                    </div>
                );
            })}
        </div>
    );
}

/** Lo que se pliega (reglas propias, horario propio): abierto si ya tiene algo. */
function Fold({ title, summary, defaultOpen, children, testId }: { title: string; summary?: string; defaultOpen: boolean; children: React.ReactNode; testId?: string }): JSX.Element {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="imcrm-rounded-md imcrm-border imcrm-border-border" data-testid={testId}>
            <button
                type="button"
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-xs imcrm-font-medium"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
            >
                <ChevronDown className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-transition-transform', !open && '-imcrm-rotate-90')} />
                <span className="imcrm-flex-1">{title}</span>
                {summary && <span className="imcrm-truncate imcrm-font-normal imcrm-text-muted-foreground">{summary}</span>}
            </button>
            {open && <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-p-2.5">{children}</div>}
        </div>
    );
}

/** La tarjeta de un servicio: nombre, duraciones, precio, cupos, horario y reglas propias. */
export function ServiceCard({
    svc,
    index,
    config,
    onChange,
}: {
    svc: BookingServiceItem;
    index: number;
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
}): JSX.Element {
    const set = (patch: Partial<BookingServiceItem>): void => onChange(updateService(config, svc.id, patch));
    const all = serviceDurations(svc);
    const pageRules = config.rules;
    const ownRules = [svc.buffer_before_min, svc.buffer_after_min, svc.min_notice_min, svc.slot_interval_min].some((v) => v !== null);
    const durationChoices = [...new Set([...DURATION_CHOICES, svc.duration_min])].sort((a, b) => a - b);
    const extraChoices = [...new Set([...BOOKING_DURATION_PRESETS, ...svc.durations])].filter((m) => m !== svc.duration_min).sort((a, b) => a - b);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-service={svc.id}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                <Input value={svc.name} onChange={(e) => set({ name: e.target.value })} aria-label={__('Nombre del servicio')} className="imcrm-h-8 imcrm-font-medium" data-testid="service-name" />
                <IconBtn label={__('Subir')} disabled={index === 0} onClick={() => onChange(moveService(config, svc.id, -1))}>
                    <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                </IconBtn>
                <IconBtn label={__('Bajar')} disabled={index === config.services.length - 1} onClick={() => onChange(moveService(config, svc.id, 1))}>
                    <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                </IconBtn>
                <IconBtn label={__('Quitar el servicio')} onClick={() => onChange(removeService(config, svc.id))}>
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                </IconBtn>
            </div>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Field label={__('Duración')}>
                    <Select value={String(svc.duration_min)} onChange={(e) => onChange(setDefaultDuration(config, svc.id, Number(e.target.value)))} data-testid="service-duration">
                        {durationChoices.map((m) => (
                            <option key={m} value={m}>
                                {durationLabel(m)}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label={__('Precio (opcional)')}>
                    <Input
                        type="number"
                        min={0}
                        value={svc.price ?? ''}
                        onChange={(e) => set({ price: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                        placeholder="80000"
                    />
                </Field>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('El cliente también puede elegir')}</span>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" data-testid="service-durations">
                    {extraChoices.map((m) => {
                        const on = svc.durations.includes(m);
                        return (
                            <button
                                key={m}
                                type="button"
                                aria-pressed={on}
                                onClick={() => onChange(toggleServiceDuration(config, svc.id, m, !on))}
                                disabled={!on && svc.durations.length >= 5}
                                className={cn(
                                    'imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs',
                                    on ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-font-medium imcrm-text-foreground' : 'imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-40',
                                )}
                                data-duration-chip={m}
                            >
                                {durationLabel(m)}
                            </button>
                        );
                    })}
                </div>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {all.length > 1
                        ? sprintf(__('En la página elige entre %s.'), all.map(durationLabel).join(', '))
                        : __('Marca otras duraciones si el cliente puede elegir cuánto dura la cita (por ejemplo, 30 o 60 minutos).')}
                </p>
            </div>
            <Field label={__('Descripción (opcional)')}>
                <Textarea rows={2} value={svc.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-2">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Users className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                    <span className="imcrm-text-xs imcrm-font-medium">{__('Cupos por horario')}</span>
                    <Input
                        type="number"
                        min={1}
                        max={BOOKING_MAX_SEATS}
                        value={svc.seats}
                        onChange={(e) => set({ seats: Math.min(BOOKING_MAX_SEATS, Math.max(1, Math.round(Number(e.target.value) || 1))) })}
                        className="imcrm-h-8 imcrm-w-20"
                        aria-label={__('Cupos por horario')}
                        data-testid="service-seats"
                    />
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{svc.seats > 1 ? __('Grupal') : __('Individual')}</span>
                </div>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {svc.seats > 1
                        ? sprintf(__('Hasta %d personas pueden reservar el mismo horario (una clase, un taller). Cada reserva es un registro.'), svc.seats)
                        : __('Una persona por horario. Súbelo para citas grupales (una clase o un taller).')}
                </p>
                {svc.seats > 1 && <Check label={__('Mostrarle al cliente cuántos cupos quedan')} checked={svc.show_seats_left} onChange={(v) => set({ show_seats_left: v })} />}
            </div>
            <Fold title={__('Horario propio del servicio')} summary={svc.hours ? __('Sólo en sus franjas') : __('El de quien atiende')} defaultOpen={svc.hours !== null} testId="service-hours">
                <Check
                    label={__('Ofrecer este servicio sólo en ciertas franjas')}
                    checked={svc.hours !== null}
                    onChange={(v) => onChange(setServiceHours(config, svc.id, v))}
                    testId="service-hours-toggle"
                />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Por ejemplo, las valoraciones sólo en la mañana. Se cruza con el horario de quien atiende: sólo se ofrece lo que está en los dos.')}
                </p>
                {svc.hours !== null && <WeekHoursEditor week={svc.hours} onDay={(dow, intervals) => onChange(setServiceDayIntervals(config, svc.id, dow, intervals))} />}
            </Fold>
            <Fold title={__('Reglas propias del servicio')} summary={ownRules ? __('Con reglas propias') : __('Las de la página')} defaultOpen={ownRules} testId="service-rules">
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    <Field label={__('Margen antes (min)')}>
                        <Input
                            type="number"
                            min={0}
                            max={240}
                            value={svc.buffer_before_min ?? ''}
                            placeholder={String(pageRules.buffer_before_min)}
                            onChange={(e) => set({ buffer_before_min: e.target.value === '' ? null : clamp(e.target.value, 0, 240) })}
                            data-testid="service-buffer-before"
                        />
                    </Field>
                    <Field label={__('Margen después (min)')}>
                        <Input
                            type="number"
                            min={0}
                            max={240}
                            value={svc.buffer_after_min ?? ''}
                            placeholder={String(pageRules.buffer_after_min)}
                            onChange={(e) => set({ buffer_after_min: e.target.value === '' ? null : clamp(e.target.value, 0, 240) })}
                            data-testid="service-buffer-after"
                        />
                    </Field>
                </div>
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    <Field label={__('Aviso mínimo')}>
                        <Select
                            value={svc.min_notice_min === null ? '' : String(svc.min_notice_min)}
                            onChange={(e) => set({ min_notice_min: e.target.value === '' ? null : Number(e.target.value) })}
                        >
                            <option value="">{sprintf(__('El de la página (%s)'), minutesLabel(pageRules.min_notice_min))}</option>
                            {[...new Set([...NOTICE_OPTIONS, ...(svc.min_notice_min !== null ? [svc.min_notice_min] : [])])]
                                .sort((x, y) => x - y)
                                .map((n) => (
                                    <option key={n} value={n}>
                                        {minutesLabel(n)}
                                    </option>
                                ))}
                        </Select>
                    </Field>
                    <Field label={__('Un horario cada')}>
                        <Select
                            value={svc.slot_interval_min === null ? '' : String(svc.slot_interval_min)}
                            onChange={(e) => set({ slot_interval_min: e.target.value === '' ? null : Number(e.target.value) })}
                        >
                            <option value="">{sprintf(__('El de la página (%s)'), intervalLabel(pageRules.slot_interval_min))}</option>
                            {BOOKING_SLOT_INTERVALS.map((n) => (
                                <option key={n} value={n}>
                                    {intervalLabel(n)}
                                </option>
                            ))}
                        </Select>
                    </Field>
                </div>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Vacío = lo de «Reglas». Útil si un servicio necesita más tiempo de preparación o se agenda con más anticipación.')}</p>
            </Fold>
            <Check label={__('Disponible para agendar')} checked={svc.active} onChange={(v) => set({ active: v })} />
        </div>
    );
}

/** Foto, cargo, descripción y prioridad de quien atiende. */
export function StaffProfile({
    staff,
    config,
    onChange,
    showPriority,
}: {
    staff: BookingStaff;
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
    showPriority: boolean;
}): JSX.Element {
    const toast = useToast();
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const photo = useAttachment(staff.photo_file_id);
    const set = (patch: Partial<BookingStaff>): void => onChange(updateStaff(config, staff.id, patch));
    const pick = async (file: File | undefined): Promise<void> => {
        if (!file) return;
        if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
            toast.error(__('Esa imagen no sirve'), __('Usa una foto en PNG, JPG, WebP o GIF.'));
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error(__('La foto es muy pesada'), __('Usa una de menos de 5 MB.'));
            return;
        }
        setUploading(true);
        try {
            set({ photo_file_id: await uploadOne(file) });
        } catch (err) {
            toast.error(__('No se pudo subir la foto'), err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };
    return (
        <div className="imcrm-flex imcrm-gap-3" data-testid="staff-profile">
            <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-items-center imcrm-gap-1">
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="imcrm-relative imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center imcrm-overflow-hidden imcrm-rounded-full imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/40 imcrm-text-muted-foreground hover:imcrm-bg-accent"
                    aria-label={staff.photo_file_id ? __('Cambiar la foto') : __('Subir una foto')}
                    data-testid="staff-photo"
                >
                    {uploading ? (
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    ) : photo.data?.url ? (
                        <img src={photo.data.url} alt="" className="imcrm-h-full imcrm-w-full imcrm-object-cover" />
                    ) : (
                        <ImagePlus className="imcrm-h-4 imcrm-w-4" />
                    )}
                </button>
                {staff.photo_file_id !== null && (
                    <button type="button" className="imcrm-text-[10px] imcrm-text-muted-foreground hover:imcrm-underline" onClick={() => set({ photo_file_id: null })}>
                        {__('Quitar')}
                    </button>
                )}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="imcrm-hidden" onChange={(e) => void pick(e.target.files?.[0])} data-testid="staff-photo-input" />
            </div>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                <Input value={staff.title} onChange={(e) => set({ title: e.target.value })} placeholder={__('Cargo o especialidad (opcional): «Odontóloga»')} className="imcrm-h-8" maxLength={120} data-testid="staff-title" />
                <Textarea rows={2} value={staff.bio} onChange={(e) => set({ bio: e.target.value })} placeholder={__('Unas líneas para el cliente (opcional)')} maxLength={600} data-testid="staff-bio" />
                {showPriority && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Prioridad')}</span>
                        <Select value={String(staff.priority)} onChange={(e) => set({ priority: Number(e.target.value) })} className="imcrm-h-8 imcrm-w-40" data-testid="staff-priority">
                            {[5, 4, 3, 2, 1].map((n) => (
                                <option key={n} value={n}>
                                    {n === 5 ? __('5 · la más alta') : n === 1 ? __('1 · la más baja') : String(n)}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}
            </div>
        </div>
    );
}

/** Festivos por país: qué país, y cada festivo del año con «Atiende» o no. */
export function HolidayPanel({
    listId,
    staff,
    config,
    onChange,
}: {
    listId: number;
    staff: BookingStaff;
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
}): JSX.Element {
    const thisYear = new Date().getFullYear();
    const [year, setYear] = useState(thisYear);
    const country = staff.availability.holiday_country;
    const q = useBookingHolidays(listId, country, year);
    const a = staff.availability;
    const works = (date: string, blocks: boolean): boolean => (blocks ? a.holiday_work.includes(date) : !a.holiday_off.includes(date));
    const others = config.staff.length > 1;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="availability-holidays">
            <Field label={__('Festivos')} hint={__('Los días festivos de ese país no se ofrecen. Salen del calendario oficial, así que se actualizan solos cada año.')}>
                <Select value={country ?? ''} onChange={(e) => onChange(setHolidayCountry(config, staff.id, e.target.value === '' ? null : e.target.value))} data-testid="holiday-country">
                    <option value="">{__('Atiende también los festivos')}</option>
                    {HOLIDAY_COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                            {sprintf(__('No atiende festivos de %s'), c.name)}
                        </option>
                    ))}
                </Select>
            </Field>
            {others && (
                <button type="button" className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline" onClick={() => onChange(copyHolidaysToAll(config, staff.id))} data-testid="holiday-copy-all">
                    <Copy className="imcrm-h-3 imcrm-w-3" />
                    {__('Usar estos festivos para todos los que atienden')}
                </button>
            )}
            {country !== null && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5" role="tablist" aria-label={__('Año')}>
                        {[thisYear, thisYear + 1].map((y) => (
                            <button
                                key={y}
                                type="button"
                                role="tab"
                                aria-selected={y === year}
                                onClick={() => setYear(y)}
                                className={cn('imcrm-rounded-full imcrm-px-2.5 imcrm-py-0.5 imcrm-text-xs', y === year ? 'imcrm-bg-primary/10 imcrm-font-medium' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent')}
                            >
                                {y}
                            </button>
                        ))}
                        <span className="imcrm-ml-auto imcrm-text-[11px] imcrm-text-muted-foreground">{__('Marca los que sí atiende')}</span>
                    </div>
                    {q.isLoading && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Buscando los festivos…')}</p>}
                    {q.data && !q.data.available && (
                        <p className="imcrm-text-xs imcrm-text-warning">{__('No pudimos leer los festivos de ese país ahora mismo. La página igual funciona; inténtalo más tarde o marca los cierres en «Días especiales».')}</p>
                    )}
                    {q.data && q.data.available && q.data.items.length === 0 && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('El calendario oficial todavía no publicó los festivos de ese año.')}</p>}
                    <ul className="imcrm-flex imcrm-max-h-72 imcrm-flex-col imcrm-overflow-y-auto" data-testid="holiday-list">
                        {(q.data?.items ?? []).map((h) => {
                            const blocks = holidayBlocksByDefault(h.kind);
                            const on = works(h.date, blocks);
                            return (
                                <li key={h.date} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-1 imcrm-text-xs" data-holiday={h.date}>
                                    <input type="checkbox" checked={on} onChange={(e) => onChange(setHolidayWorked(config, staff.id, h.date, e.target.checked, blocks))} aria-label={sprintf(__('Atiende el %s'), h.name)} />
                                    <span className="imcrm-w-20 imcrm-shrink-0 imcrm-tabular-nums imcrm-text-muted-foreground">{formatDateStr(h.date)}</span>
                                    <span className={cn('imcrm-min-w-0 imcrm-flex-1 imcrm-truncate', !on && 'imcrm-font-medium')}>{h.name}</span>
                                    {h.kind !== 'national' && (
                                        <span className="imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-text-muted-foreground">
                                            {h.kind === 'regional' ? __('Regional') : __('Medio día')}
                                        </span>
                                    )}
                                    <span className={cn('imcrm-shrink-0 imcrm-text-[10px]', on ? 'imcrm-text-success' : 'imcrm-text-muted-foreground')}>{on ? __('Atiende') : __('Cerrado')}</span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
}

/** Vacaciones o ausencias de varios días. */
export function TimeOffEditor({ staff, config, onChange }: { staff: BookingStaff; config: BookingConfig; onChange: (next: BookingConfig) => void }): JSX.Element {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to || from);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="time-off">
            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{__('Vacaciones, una licencia o un viaje: esos días no se ofrecen. Un día especial dentro del rango igual manda.')}</p>
            {staff.availability.time_off.map((t) => (
                <div key={t.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-time-off={t.id}>
                    <Input type="date" value={t.from} onChange={(e) => e.target.value && onChange(updateTimeOff(config, staff.id, t.id, { from: e.target.value, to: e.target.value > t.to ? e.target.value : t.to }))} className="imcrm-h-8 imcrm-w-40" aria-label={__('Desde')} />
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('al')}</span>
                    <Input type="date" value={t.to} min={t.from} onChange={(e) => e.target.value && onChange(updateTimeOff(config, staff.id, t.id, { to: e.target.value < t.from ? t.from : e.target.value }))} className="imcrm-h-8 imcrm-w-40" aria-label={__('Hasta')} />
                    <Input value={t.note} onChange={(e) => onChange(updateTimeOff(config, staff.id, t.id, { note: e.target.value }))} placeholder={__('Nota interna (opcional)')} className="imcrm-h-8 imcrm-min-w-[8rem] imcrm-flex-1" maxLength={120} />
                    <IconBtn label={__('Quitar las vacaciones')} onClick={() => onChange(removeTimeOff(config, staff.id, t.id))}>
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </IconBtn>
                </div>
            ))}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="imcrm-h-8 imcrm-w-40" aria-label={__('Desde')} data-testid="time-off-from" />
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('al')}</span>
                <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="imcrm-h-8 imcrm-w-40" aria-label={__('Hasta')} data-testid="time-off-to" />
                <Button
                    variant="outline"
                    size="sm"
                    disabled={!valid || staff.availability.time_off.length >= 30}
                    onClick={() => {
                        onChange(addTimeOff(config, staff.id, from, to || from));
                        setFrom('');
                        setTo('');
                    }}
                    data-testid="time-off-add"
                >
                    {__('Agregar')}
                </Button>
            </div>
        </div>
    );
}

function clamp(raw: string, min: number, max: number): number {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

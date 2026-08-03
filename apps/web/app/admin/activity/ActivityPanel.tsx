import { Activity, Loader2 } from 'lucide-react';

import { chipSoftStyle, type OptionColor } from '@/components/ui/color-picker';
import { useFields } from '@/hooks/useFields';
import { useRecordActivity } from '@/hooks/useActivity';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { ActivityEntity } from '@/types/activity';

import {
    actionText,
    actorOf,
    changeSentence,
    changesOf,
    formatActivityValue,
    relativeTime,
    type FieldChange,
} from './activityText';

/**
 * Timeline de actividad de un registro (reescrito en v0.1.149).
 *
 * Antes decía sólo "record_updated · por usuario #2": la UI seguía esperando
 * el shape del plugin (`record.updated` + `changes.fields[slug]`) mientras el
 * backend guarda `record_updated` + `diff` por clave `f{id}`, así que ni el
 * verbo ni el detalle matcheaban. Ahora cada entrada se lee como una frase:
 * QUIÉN, QUÉ campo, de QUÉ valor a CUÁL — con los valores formateados igual
 * que en la ficha (fechas y números con el formato de la empresa, opciones
 * con su etiqueta y su color).
 */
interface ActivityPanelProps {
    listId: number;
    recordId: number;
}

export function ActivityPanel({ listId, recordId }: ActivityPanelProps): JSX.Element {
    const activity = useRecordActivity(listId, recordId, 100);
    // El catálogo de campos es lo que traduce `f101` → "Estado" y da el tipo
    // para formatear el valor. Ya está en cache: la ficha lo usa para todo.
    const fields = useFields(listId);

    if (activity.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando actividad…')}
            </div>
        );
    }
    if (activity.isError) {
        return (
            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                {(activity.error as Error).message}
            </div>
        );
    }
    if (!activity.data || activity.data.length === 0) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-py-8 imcrm-text-center imcrm-text-muted-foreground">
                <Activity className="imcrm-h-6 imcrm-w-6" />
                <p className="imcrm-text-sm">{__('Aún no hay actividad registrada para este registro.')}</p>
            </div>
        );
    }

    return (
        <ol className="imcrm-flex imcrm-flex-col">
            {activity.data.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} fields={fields.data ?? []} />
            ))}
        </ol>
    );
}

function ActivityRow({
    entry,
    fields,
}: {
    entry: ActivityEntity;
    fields: FieldEntity[];
}): JSX.Element {
    const changes = changesOf(entry, fields);
    const actor = actorOf(entry);
    const verb = actionText(entry, changes.length);
    const exact = formatDateTimeStr(entry.created_at);

    return (
        <li className="imcrm-flex imcrm-gap-2.5 imcrm-py-2">
            <Initials name={actor} system={entry.user_id === null || entry.user_id <= 0} />
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                <p className="imcrm-text-[13px] imcrm-leading-snug imcrm-text-muted-foreground">
                    <span className="imcrm-font-medium imcrm-text-foreground">{actor}</span>
                    {verb !== '' && <> {verb}</>}
                    {changes.length === 0 && (
                        <>
                            {' '}
                            <time
                                dateTime={entry.created_at}
                                title={exact}
                                className="imcrm-whitespace-nowrap imcrm-text-muted-foreground/80"
                            >
                                · {relativeTime(entry.created_at)}
                            </time>
                        </>
                    )}
                </p>

                {changes.map((c, i) => (
                    <ChangeLine
                        key={`${c.label}-${i}`}
                        change={c}
                        // La hora va en la ÚLTIMA línea del bloque: repetirla
                        // en cada campo cambiado sería ruido (todas comparten
                        // la misma marca de tiempo).
                        time={i === changes.length - 1 ? entry.created_at : null}
                        exact={exact}
                    />
                ))}
            </div>
        </li>
    );
}

function ChangeLine({
    change,
    time,
    exact,
}: {
    change: FieldChange;
    time: string | null;
    exact: string;
}): JSX.Element {
    const { verb, from, to } = changeSentence(change);
    return (
        <p className="imcrm-text-[13px] imcrm-leading-snug imcrm-text-muted-foreground">
            {verb}{' '}
            <span className="imcrm-font-medium imcrm-text-foreground">{change.label}</span>
            {from !== null && to !== null && (
                <>
                    {' '}
                    {__('de')} <Value field={change.field} raw={change.from} text={from} old />
                    {' '}
                    {__('a')} <Value field={change.field} raw={change.to} text={to} />
                </>
            )}
            {from === null && to !== null && (
                <>
                    {' '}
                    {__('en')} <Value field={change.field} raw={change.to} text={to} />
                </>
            )}
            {from !== null && to === null && (
                <>
                    {' '}
                    ({__('antes')} <Value field={change.field} raw={change.from} text={from} old />)
                </>
            )}
            {time !== null && (
                <time
                    dateTime={time}
                    title={exact}
                    className="imcrm-whitespace-nowrap imcrm-text-muted-foreground/80"
                >
                    {' · '}
                    {relativeTime(time)}
                </time>
            )}
        </p>
    );
}

/**
 * El valor: los de select/multi_select van como CHIP con el color de la
 * opción (el mismo que se ve en la tabla), el resto como texto resaltado.
 * El valor anterior se atenúa para que la lectura sea "de X a Y".
 */
function Value({
    field,
    raw,
    text,
    old,
}: {
    field: FieldEntity | undefined;
    raw: unknown;
    text: string;
    old?: boolean;
}): JSX.Element {
    if (field !== undefined && (field.type === 'select' || field.type === 'multi_select')) {
        const values = Array.isArray(raw) ? raw : [raw];
        return (
            <span className="imcrm-inline-flex imcrm-flex-wrap imcrm-gap-1 imcrm-align-middle">
                {values.map((v, i) => (
                    <OptionPill
                        key={i}
                        field={field}
                        value={v}
                        label={formatActivityValue(field, v) ?? String(v)}
                        old={old}
                    />
                ))}
            </span>
        );
    }
    return (
        <span
            className={cn(
                'imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-text-[12px]',
                old ? 'imcrm-text-muted-foreground imcrm-line-through' : 'imcrm-text-foreground',
            )}
        >
            {text}
        </span>
    );
}

function OptionPill({
    field,
    value,
    label,
    old,
}: {
    field: FieldEntity;
    value: unknown;
    label: string;
    old?: boolean;
}): JSX.Element {
    const opts = (field.config as { options?: Array<{ value?: string; color?: string }> }).options;
    const color = Array.isArray(opts)
        ? (opts.find((o) => String(o.value) === String(value))?.color as OptionColor | undefined)
        : undefined;
    const style = chipSoftStyle(color);
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-max-w-[220px] imcrm-items-center imcrm-overflow-hidden imcrm-rounded imcrm-border imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-leading-tight imcrm-whitespace-nowrap',
                old && 'imcrm-opacity-60',
            )}
            style={style ?? {
                backgroundColor: 'hsl(var(--imcrm-muted))',
                borderColor: 'hsl(var(--imcrm-border))',
                color: 'hsl(var(--imcrm-foreground))',
            }}
        >
            <span className="imcrm-min-w-0 imcrm-truncate">{label}</span>
        </span>
    );
}

/** Avatar de iniciales (el sistema lleva su propio icono). */
function Initials({ name, system }: { name: string; system: boolean }): JSX.Element {
    const initials = name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase())
        .join('');
    return (
        <span
            aria-hidden
            className="imcrm-mt-0.5 imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-[10px] imcrm-font-semibold imcrm-text-foreground/70 imcrm-ring-1 imcrm-ring-border"
        >
            {system ? <Activity className="imcrm-h-3 imcrm-w-3" /> : initials}
        </span>
    );
}

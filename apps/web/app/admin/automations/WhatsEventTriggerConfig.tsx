import { useQuery } from '@tanstack/react-query';
import {
    WHATS_EVENT_COMMON_TAGS,
    WHATS_EVENT_KINDS,
    WHATS_EVENT_KIND_META,
    WHATS_EVENT_KIND_TAGS,
    readWhatsTriggerConfig,
    type WhatsEventKind,
} from '@imagina-base/shared';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router';

import { api as cloud } from '@/cloud/session';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import type { TriggerConfig } from '@/types/automation';
import type { FieldEntity } from '@/types/field';

import { useWhatsappConnections } from './WhatsappActionConfig';

/**
 * v0.1.402 — Editor del disparador «Cuando pasa algo en Whats»: la conexión,
 * qué evento (y sus sub-opciones), el campo con el teléfono para encontrar el
 * registro y qué hacer si no está. Lo que se guarda lo lee el servidor con
 * `readWhatsTriggerConfig` (la MISMA función que usa este editor).
 */
export function WhatsEventTriggerConfig({
    config,
    onChange,
    fields,
}: {
    config: TriggerConfig;
    onChange: (next: TriggerConfig) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const q = useWhatsappConnections();
    const conns = (q.data ?? []).filter((c) => c.provider === 'whatsapp_web');
    const parsed = readWhatsTriggerConfig(config);
    const kind = parsed?.kind ?? null;
    const meta = kind ? WHATS_EVENT_KIND_META[kind] : null;
    const connectionId = parsed?.connectionId ?? (Number(config.connection_id) > 0 ? Number(config.connection_id) : null);
    const abilities = useQuery({
        queryKey: ['whats-abilities', connectionId],
        queryFn: () => cloud.whatsAbilities(connectionId ?? 0),
        enabled: connectionId !== null,
        retry: false,
        staleTime: 60_000,
    });
    const phoneFields = fields.filter((f) => f.type === 'phone' || f.type === 'text');
    const tags = kind ? [...WHATS_EVENT_COMMON_TAGS, ...WHATS_EVENT_KIND_TAGS[kind]] : [];
    const lacksContacts = meta?.needsContactLookup === true && abilities.data !== undefined && !abilities.data.abilities.includes('contacts.view') && !abilities.data.abilities.includes('contacts.manage');

    const set = (patch: TriggerConfig): void => {
        const next: TriggerConfig = { ...config, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        onChange(next);
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-whats-event-config">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="trigger-whats-event-kind">{__('Qué pasó en Whats')}</Label>
                <Select
                    id="trigger-whats-event-kind"
                    data-testid="whats-event-kind"
                    value={kind ?? ''}
                    onChange={(e) => {
                        const next = e.target.value as WhatsEventKind | '';
                        set({ whats_event: next === '' ? undefined : next, if_missing: undefined });
                    }}
                >
                    <option value="">{__('Elige un evento…')}</option>
                    {WHATS_EVENT_KINDS.map((k) => (
                        <option key={k} value={k}>
                            {WHATS_EVENT_KIND_META[k].label}
                        </option>
                    ))}
                </Select>
                {meta ? (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{meta.help}</p>
                ) : (
                    <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">{__('Elige qué evento de Whats dispara la automatización.')}</p>
                )}
            </div>

            {meta?.sub && parsed && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <Label>{meta.sub.label}</Label>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        {meta.sub.options.map((o) => {
                            const checked = parsed.sub.includes(o.value);
                            const subKey = meta.sub!.key;
                            return (
                                <label
                                    key={o.value}
                                    className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs"
                                >
                                    <input
                                        type="checkbox"
                                        data-testid={`whats-event-sub-${o.value}`}
                                        checked={checked}
                                        onChange={(e) => {
                                            const nextSub = e.target.checked ? [...parsed.sub, o.value] : parsed.sub.filter((x) => x !== o.value);
                                            // Sin ninguna marcada vuelve a las de siempre: así nunca queda una que no dispara.
                                            set({ [subKey]: nextSub.length > 0 ? nextSub : undefined });
                                        }}
                                    />
                                    {o.label}
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="trigger-whats-event-connection">{__('Conexión de Whats')}</Label>
                <Select
                    id="trigger-whats-event-connection"
                    data-testid="whats-event-connection"
                    value={connectionId !== null ? String(connectionId) : ''}
                    onChange={(e) => set({ connection_id: e.target.value === '' ? undefined : Number(e.target.value) })}
                >
                    <option value="">{__('Cualquiera de la empresa')}</option>
                    {conns.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.display_phone ? `${c.display_phone} · ${c.name}` : c.name}
                        </option>
                    ))}
                </Select>
                {!q.isLoading && conns.length === 0 && (
                    <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                        {__('Todavía no hay una conexión de Whats: conéctala en')}{' '}
                        <Link className="imcrm-underline" to="/settings?s=conectores">
                            {__('Ajustes → Integraciones')}
                        </Link>
                        .
                    </p>
                )}
                {lacksContacts && (
                    <p
                        className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-amber-50 imcrm-p-2 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-bg-amber-500/10 dark:imcrm-text-amber-200"
                        data-testid="whats-event-needs-contacts"
                    >
                        <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        <span>
                            {__(
                                'Estos avisos a veces traen sólo el id del contacto. Para leer su teléfono, la clave de Whats necesita el permiso de ver contactos (contacts.view); sin él, esas corridas quedan canceladas.',
                            )}
                        </span>
                    </p>
                )}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="trigger-whats-event-phone">{__('Campo con el teléfono del contacto')}</Label>
                <Select
                    id="trigger-whats-event-phone"
                    data-testid="whats-event-phone-field"
                    value={parsed?.phoneFieldId ? String(parsed.phoneFieldId) : ''}
                    onChange={(e) => set({ phone_field_id: e.target.value === '' ? undefined : Number(e.target.value) })}
                >
                    <option value="">{__('El de «Configurar WhatsApp» (o el primer campo Teléfono)')}</option>
                    {phoneFields.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.label}
                        </option>
                    ))}
                </Select>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {kind === 'message_status'
                        ? __('Si el mensaje lo mandó un registro de esta lista, se usa ése; si no, se busca por el teléfono.')
                        : __('Se busca con y sin indicativo. Si hay varios con el mismo teléfono, se usa el que ya está vinculado a ese contacto.')}
                </p>
            </div>

            {parsed && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" role="radiogroup" aria-labelledby="whats-event-if-missing-label">
                    <p id="whats-event-if-missing-label" className="imcrm-text-sm imcrm-font-medium">
                        {__('Si no hay un registro con ese teléfono')}
                    </p>
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="radio"
                            name="whats-event-if-missing"
                            data-testid="whats-event-if-missing-create"
                            checked={parsed.ifMissing === 'create'}
                            onChange={() => set({ if_missing: 'create' })}
                            className="imcrm-mt-1"
                        />
                        <span>{__('Crearlo, con el nombre, el teléfono y el correo del contacto')}</span>
                    </label>
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="radio"
                            name="whats-event-if-missing"
                            data-testid="whats-event-if-missing-skip"
                            checked={parsed.ifMissing === 'skip'}
                            onChange={() => set({ if_missing: 'skip' })}
                            className="imcrm-mt-1"
                        />
                        <span>{__('No hacer nada (la corrida queda cancelada con el motivo, en el historial)')}</span>
                    </label>
                </div>
            )}

            {tags.length > 0 && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-2.5" data-testid="whats-event-variables">
                    <p className="imcrm-text-xs imcrm-font-medium">{__('Variables para las acciones')}</p>
                    <div className="imcrm-mt-1.5 imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                        {tags.map((t) => (
                            <code key={t.tag} title={t.label} className="imcrm-rounded imcrm-bg-background imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px]">
                                {`{{${t.tag}}}`}
                            </code>
                        ))}
                        <code title={__('Cualquier dato del aviso')} className="imcrm-rounded imcrm-bg-background imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px]">
                            {'{{payload.…}}'}
                        </code>
                    </div>
                </div>
            )}
        </div>
    );
}

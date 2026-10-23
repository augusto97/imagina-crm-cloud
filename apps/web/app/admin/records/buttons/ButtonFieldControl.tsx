import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    BUTTON_ROLES,
    buttonActionProblem,
    buttonChangesRecord,
    buttonDisabledState,
    buttonLabel,
    buttonSupportsBulk,
    readButtonConfig,
    type ButtonConfig,
    type ButtonPressStatus,
    type PressButtonResult,
} from '@imagina-base/shared';

import { FieldButtonView } from '@/components/fields/FieldButtonView';
import { useOptionalConfirm } from '@/components/ui/confirm-dialog';
import { useToastOptional } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { useRecord } from '@/hooks/useRecords';
import { buttonPressStatus, pressButton, refreshAfterPress, useButtonQueryClient } from '@/hooks/useButtons';
import { downloadPdf } from '@/admin/documents/useDocuments';
import { useSession } from '@/cloud/session';
import { useCanAny, CAP } from '@/lib/permissions';
import { getTenantTimeZone } from '@/lib/tenantFormat';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * Campo «Botón» en el PORTAL del cliente: el estado de cada botón lo calcula
 * el servidor (con el registro completo) y presionar va por
 * `POST /portal/me/buttons/:fieldId`. El portal lo provee; sin él, el botón
 * habla con la API del equipo.
 */
export interface PortalButtonsValue {
    states: Record<string, { disabled: boolean; reason: string | null; blocked: string | null }>;
    press: (fieldId: number) => Promise<PressButtonResult>;
    /** Lo que hay que refrescar cuando el botón cambió algo. */
    onDone?: () => void;
}
export const PortalButtonsContext = createContext<PortalButtonsValue | null>(null);

/**
 * En el portal, un botón que ahí no puede funcionar (corre una automatización
 * sin permiso, cambia campos que el cliente no edita, un PDF no publicado) NO
 * se le muestra al cliente: un botón deshabilitado para siempre, con un motivo
 * de configuración, no le sirve. El editor del portal se lo explica a la
 * empresa (y el servidor igual lo rechaza).
 */
export function usePortalButtonHidden(fieldId: number | null): boolean {
    const portal = useContext(PortalButtonsContext);
    if (!portal || fieldId === null) return false;
    const st = portal.states[String(fieldId)];
    return !st || st.blocked !== null;
}

interface ButtonFieldControlProps {
    field: FieldEntity;
    listId: number | string;
    /** El registro (para «deshabilitado si…»). Sin él, el botón no se presiona. */
    record?: RecordEntity | null;
    /** Sin `record`: el id del registro (se lee del cache de la ficha). */
    recordId?: number;
    /** Los campos de la lista (si quien dibuja ya los tiene). */
    fields?: FieldEntity[];
    size?: 'cell' | 'md' | 'full';
    /** El editor de la ficha y la vista previa lo dibujan sin acción. */
    inert?: boolean;
    /** Sube en uno para presionar desde el teclado (la tabla: Enter o Espacio). */
    pressSignal?: number;
    className?: string;
}

/**
 * El botón que se presiona — en la tabla, la ficha (modal, página, diseño v3)
 * y el portal. Muestra lo mismo que el servidor va a exigir (rol, «deshabilitado
 * si…», poder editar, acciones completas) con el motivo en el tooltip, pide la
 * confirmación si el botón la tiene y, al volver la respuesta, hace en el
 * navegador lo que le toca: abrir el enlace, bajar el PDF y seguir la
 * automatización que se inició hasta decir cómo terminó.
 */
export function ButtonFieldControl({
    field,
    listId,
    record,
    recordId,
    fields: fieldsProp,
    size = 'md',
    inert = false,
    pressSignal,
    className,
}: ButtonFieldControlProps): JSX.Element | null {
    const portal = useContext(PortalButtonsContext);
    const config = useMemo(() => readButtonConfig(field.config), [field.config]);
    const label = buttonLabel(config, field.label);
    const runner = useButtonRunner(listId);

    if (portal) {
        const st = portal.states[String(field.id)];
        if (!st || st.blocked !== null) return null;
        return (
            <FieldButtonView
                label={label}
                color={config.color}
                icon={config.icon}
                size={size}
                className={className}
                inert={inert}
                disabled={st.disabled}
                reason={st.reason}
                loading={runner.loading}
                onClick={() => void runner.run(label, config, () => portal.press(field.id), { onDone: portal.onDone })}
            />
        );
    }
    return (
        <TeamButton
            field={field}
            listId={listId}
            record={record ?? null}
            recordId={recordId}
            fieldsProp={fieldsProp}
            config={config}
            label={label}
            size={size}
            inert={inert}
            pressSignal={pressSignal}
            className={className}
            runner={runner}
        />
    );
}

function TeamButton({
    field,
    listId,
    record: recordProp,
    recordId,
    fieldsProp,
    config,
    label,
    size,
    inert,
    pressSignal,
    className,
    runner,
}: {
    field: FieldEntity;
    listId: number | string;
    record: RecordEntity | null;
    recordId?: number;
    fieldsProp?: FieldEntity[];
    config: ButtonConfig;
    label: string;
    size: 'cell' | 'md' | 'full';
    inert: boolean;
    pressSignal?: number;
    className?: string;
    runner: ButtonRunner;
}): JSX.Element {
    const fetched = useRecord(recordProp ? undefined : listId, recordProp ? undefined : recordId);
    const record = recordProp ?? fetched.data ?? null;
    const listFields = useFields(fieldsProp ? undefined : listId).data;
    const fields = useMemo(() => fieldsProp ?? listFields ?? [], [fieldsProp, listFields]);
    const role = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role ?? null);
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);

    const reason = useMemo(() => {
        if (!record) return __('Abre el registro para presionarlo');
        if (config.actions.length === 0) return __('Este botón todavía no tiene acciones');
        for (const a of config.actions) {
            const problem = buttonActionProblem(a);
            if (problem) return sprintf(__('Botón incompleto: %s'), problem.toLowerCase());
        }
        if (role !== null && role !== 'admin') {
            const roles = config.roles ?? [...BUTTON_ROLES];
            if (!(roles as readonly string[]).includes(role)) return __('Tu rol no puede presionar este botón');
        }
        if (buttonChangesRecord(config) && !canEdit) return __('Cambia el registro y tú no puedes editarlo');
        const byId = new Map(fields.map((f) => [f.id, f]));
        const state = buttonDisabledState(
            config,
            (id) => {
                const f = byId.get(id);
                if (!f) return undefined;
                return { type: f.type, value: f.type === 'relation' ? record.relations?.[f.slug] ?? [] : record.fields[f.slug] };
            },
            { timeZone: getTenantTimeZone() ?? 'UTC' },
        );
        return state.disabled ? state.reason : null;
    }, [record, config, role, canEdit, fields]);

    const press = (): void => {
        if (!record || reason !== null || inert) return;
        void runner.run(label, config, () => pressButton(listId, record.id, field.id), { recordId: record.id, poll: true });
    };

    // La tabla presiona desde el teclado (Enter / Espacio con la celda elegida).
    const lastSignal = useRef(pressSignal ?? 0);
    useEffect(() => {
        if (pressSignal === undefined || pressSignal === lastSignal.current) return;
        lastSignal.current = pressSignal;
        press();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pressSignal]);

    return (
        <FieldButtonView
            label={label}
            color={config.color}
            icon={config.icon}
            size={size}
            className={className}
            inert={inert}
            disabled={reason !== null}
            reason={reason}
            loading={runner.loading}
            onClick={press}
        />
    );
}

// ── Presionar y lo que hace el navegador con la respuesta ───────────────────

interface ButtonRunner {
    loading: boolean;
    run: (
        label: string,
        config: ButtonConfig,
        doPress: () => Promise<PressButtonResult>,
        opts?: { recordId?: number; poll?: boolean; onDone?: () => void },
    ) => Promise<void>;
}

const POLL_MS = 1500;
const POLL_MAX = 40;

function useButtonRunner(listId: number | string): ButtonRunner {
    const [loading, setLoading] = useState(false);
    const toast = useToastOptional();
    const confirm = useOptionalConfirm();
    const qc = useButtonQueryClient();
    // Se re-arma en cada montaje: en modo estricto el efecto corre dos veces y
    // un ref que sólo se apaga dejaba el botón cargando para siempre.
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const notify = (variant: 'success' | 'error' | 'info', title: string, description?: string): void => {
        if (toast) toast[variant](title, description);
        else if (variant === 'error') window.alert(description ? `${title}\n${description}` : title);
    };

    const run: ButtonRunner['run'] = async (label, config, doPress, opts = {}) => {
        const question = (config.confirm ?? '').trim();
        if (question !== '') {
            const ok = confirm
                ? await confirm({ title: question, confirmLabel: label })
                : window.confirm(question);
            if (!ok) return;
        }
        setLoading(true);
        let res: PressButtonResult;
        try {
            res = await doPress();
        } catch (err) {
            notify('error', sprintf(__('No se pudo presionar «%s»'), label), err instanceof Error ? err.message : undefined);
            return;
        } finally {
            if (mounted.current) setLoading(false);
        }
        // El aviso de «Listo» sólo cuando no hay otra señal: abrir el enlace,
        // bajar el PDF o el aviso de la automatización ya dicen lo que pasó.
        let summary = false;
        for (const a of res.actions) {
            if (!a.ok) continue;
            if (a.type === 'open_url') openButtonUrl(a.url, toast);
            else if (a.type === 'generate_pdf') {
                if (a.pdf) downloadPdf(a.pdf, a.filename);
                else summary = true;
            } else if (a.type === 'run_automation') {
                const names = a.automations.map((x) => `«${x.name}»`).join(', ');
                notify(
                    'info',
                    a.automations.length === 1
                        ? sprintf(__('Se inició la automatización %s…'), names)
                        : sprintf(__('Se iniciaron las automatizaciones %s…'), names),
                );
                if (opts.poll && a.press_id) void followAutomations(listId, a.press_id, (title, desc, variant) => notify(variant, title, desc), () => refreshAfterPress(qc, listId, opts.recordId ?? null));
            } else {
                summary = true;
            }
        }
        if (!res.ok) notify('error', res.message);
        else if (summary) notify('success', res.message);
        refreshAfterPress(qc, listId, opts.recordId ?? null);
        opts.onDone?.();
    };

    return { loading, run };
}

/**
 * Abre el enlace del botón. https en otra pestaña sin `opener` (la página
 * abierta no puede tocar la app); `mailto:` y `tel:` en el lugar (abren el
 * correo o el teléfono). Si el navegador bloquea la ventana, el aviso trae el
 * enlace para abrirlo con un click.
 */
export function openButtonUrl(url: string, toast: ReturnType<typeof useToastOptional>): void {
    if (/^(mailto|tel):/i.test(url)) {
        window.location.href = url;
        return;
    }
    const w = window.open('', '_blank');
    if (w) {
        w.opener = null;
        w.location.href = url;
        return;
    }
    if (toast) {
        toast.show({
            title: __('El navegador bloqueó la ventana'),
            description: url.length > 80 ? `${url.slice(0, 77)}…` : url,
            variant: 'warning',
            duration: 15_000,
            action: { label: __('Abrir enlace'), onClick: () => void window.open(url, '_blank', 'noopener,noreferrer') },
        });
    } else {
        window.location.href = url;
    }
}

/** Pregunta cómo terminaron las automatizaciones hasta que terminen (o se agote). */
async function followAutomations(
    listId: number | string,
    pressId: string,
    notify: (title: string, description: string | undefined, variant: 'success' | 'error' | 'info') => void,
    refresh: () => void,
): Promise<void> {
    for (let i = 0; i < POLL_MAX; i++) {
        await new Promise((r) => window.setTimeout(r, POLL_MS));
        let st: ButtonPressStatus;
        try {
            st = await buttonPressStatus(listId, pressId);
        } catch {
            return;
        }
        if (st.state === 'unknown') return;
        if (st.state !== 'done') continue;
        for (const run of st.runs) {
            if (run.status === 'failed') notify(sprintf(__('Falló la automatización «%s»'), run.name), run.error ?? undefined, 'error');
            else if (run.status === 'waiting') notify(sprintf(__('La automatización «%s» quedó en espera'), run.name), __('Sigue sola cuando le toque.'), 'info');
            else if (run.status === 'success') notify(sprintf(__('La automatización «%s» terminó'), run.name), undefined, 'success');
        }
        refresh();
        return;
    }
}

/**
 * Los botones de la lista que se pueden presionar sobre una selección (la
 * barra de acciones masivas), con el motivo de los que no.
 */
export function useBulkButtons(fields: FieldEntity[] | undefined): Array<{ field: FieldEntity; label: string; reason: string | null }> {
    const role = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role ?? null);
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    return useMemo(
        () =>
            (fields ?? [])
                .filter((f) => f.type === 'button')
                .map((field) => {
                    const config = readButtonConfig(field.config);
                    const label = buttonLabel(config, field.label);
                    let reason: string | null = null;
                    if (config.actions.length === 0) reason = __('Todavía no tiene acciones');
                    else if (!buttonSupportsBulk(config)) reason = __('Abre un enlace o descarga un PDF: se presiona de a uno');
                    else if (role !== null && role !== 'admin' && !((config.roles ?? [...BUTTON_ROLES]) as readonly string[]).includes(role)) {
                        reason = __('Tu rol no puede presionarlo');
                    } else if (buttonChangesRecord(config) && !canEdit) reason = __('Cambia el registro y tú no puedes editarlo');
                    return { field, label, reason };
                }),
        [fields, role, canEdit],
    );
}

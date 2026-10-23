import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    dataConsentMissing,
    dataConsentRecommended,
    renderDataConsent,
    type DataConsentConfig,
    type DataConsentState,
    type DataConsentVersionDto,
} from '@imagina-base/shared';
import { FileText, History, Loader2, Plus, RotateCcw, Scale, Trash2, TriangleAlert, X } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { DataConsentRecords } from '@/cloud/components/DataConsentRecords';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

export const dataConsentKey = (tenantId: number | null) => ['data-consent', tenantId] as const;

/** Lo que se edita (todo menos la versión vigente, que la decide el servidor). */
type Draft = Omit<DataConsentConfig, 'current_version'>;

function toDraft(c: DataConsentConfig): Draft {
    const { current_version: _v, ...rest } = c;
    return { ...rest, responsible: { ...rest.responsible }, purposes: [...rest.purposes] };
}

const RESPONSIBLE_FIELDS: Array<{ key: keyof Draft['responsible']; label: string; placeholder?: string; required?: boolean; type?: string }> = [
    { key: 'name', label: 'Nombre o razón social' },
    { key: 'id_number', label: 'NIT o documento', placeholder: '900.123.456-7' },
    { key: 'address', label: 'Dirección', placeholder: 'Calle 10 # 5-20' },
    { key: 'city', label: 'Ciudad', placeholder: 'Bogotá' },
    { key: 'email', label: 'Correo para ejercer los derechos', placeholder: 'datos@tuempresa.com', required: true, type: 'email' },
    { key: 'phone', label: 'Teléfono', placeholder: '+57 601 555 0000', required: true, type: 'tel' },
];

/**
 * Ajustes → Datos personales (admin). La autorización de tratamiento de datos
 * personales (Ley 1581 de 2012) que se pide en los formularios públicos y la
 * primera vez que un cliente entra al portal: el texto con su plantilla
 * sugerida (editable, con variables), los datos del responsable, las
 * finalidades, las versiones y la evidencia de cada autorización.
 */
export function DataConsentPanel(): JSX.Element | null {
    const qc = useQueryClient();
    const toast = useToast();
    const tenantId = useSession((s) => s.activeTenantId);
    const tenantName = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.tenant_name ?? '');
    const q = useQuery({ queryKey: dataConsentKey(tenantId), queryFn: () => api.dataConsentGet(), retry: false });
    const [draft, setDraft] = useState<Draft | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [viewing, setViewing] = useState<number | null>(null);
    const templateRef = useRef<HTMLTextAreaElement>(null);

    // Hidratar UNA vez (el query puede refrescarse y no tiene que pisar lo que se está escribiendo).
    useEffect(() => {
        if (q.data && draft === null) setDraft(toDraft(q.data.config));
    }, [q.data, draft]);

    const save = useMutation({
        mutationFn: (d: Draft) => api.dataConsentSet(d),
        onMutate: () => setError(null),
        onSuccess: (state: DataConsentState) => {
            const before = q.data?.current?.version ?? null;
            qc.setQueryData(dataConsentKey(tenantId), state);
            setDraft(toDraft(state.config));
            const now = state.current?.version ?? null;
            if (now !== null && now !== before) {
                toast.success(
                    __('Guardado: versión %d del texto').replace('%d', String(now)),
                    __('Las autorizaciones nuevas quedan con esta versión. Las anteriores conservan la que aceptaron.'),
                );
            } else {
                toast.success(__('Guardado'));
            }
            void qc.invalidateQueries({ queryKey: ['data-consent-records'] });
        },
        onError: (e: unknown) => setError(e instanceof CloudApiError || e instanceof Error ? e.message : String(e)),
    });

    const ctx = useMemo(() => ({ tenantName }), [tenantName]);
    const preview = useMemo(() => (draft ? renderDataConsent({ ...draft, current_version: null }, ctx) : null), [draft, ctx]);
    const missing = useMemo(() => (draft ? dataConsentMissing({ ...draft, current_version: null }, ctx) : []), [draft, ctx]);
    const recommended = useMemo(() => (draft ? dataConsentRecommended({ ...draft, current_version: null }) : []), [draft]);

    if (q.isError) {
        return (
            <p className="imcrm-text-sm imcrm-text-muted-foreground">
                {q.error instanceof CloudApiError ? q.error.message : __('No se pudo cargar la autorización de datos.')}
            </p>
        );
    }
    const state = q.data;
    if (!state || !draft || !preview) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando…')}
            </div>
        );
    }

    const saved = toDraft(state.config);
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
    const set = (patch: Partial<Draft>): void => setDraft((d) => (d ? { ...d, ...patch } : d));
    const setResp = (patch: Partial<Draft['responsible']>): void =>
        setDraft((d) => (d ? { ...d, responsible: { ...d.responsible, ...patch } } : d));
    const template = draft.template ?? state.defaults.template;
    const label = draft.checkbox_label ?? state.defaults.checkbox_label;

    const insertVariable = (key: string): void => {
        const token = `{{${key}}}`;
        const el = templateRef.current;
        const start = el?.selectionStart ?? template.length;
        const end = el?.selectionEnd ?? template.length;
        const next = template.slice(0, start) + token + template.slice(end);
        set({ template: next });
        requestAnimationFrame(() => {
            if (!el) return;
            el.focus();
            el.setSelectionRange(start + token.length, start + token.length);
        });
    };

    const status = state.active ? (
        <Badge dot variant="success" data-testid="data-consent-status">
            {__('Activa')} · {__('versión')} {state.current?.version}
        </Badge>
    ) : state.config.enabled ? (
        <Badge dot variant="warning" data-testid="data-consent-status">{__('Incompleta')}</Badge>
    ) : (
        <Badge dot variant="secondary" data-testid="data-consent-status">{__('Desactivada')}</Badge>
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="data-consent-panel">
            <Card>
                <CardHeader>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3">
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                                <Scale className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                            </span>
                            <CardTitle>{__('Autorización de tratamiento de datos personales')}</CardTitle>
                        </div>
                        {status}
                    </div>
                    <CardDescription>
                        {__(
                            'La Ley 1581 de 2012 exige pedir una autorización previa, expresa e informada antes de recoger datos personales. Aquí armas el texto de tu empresa: se muestra con una casilla obligatoria en tus formularios públicos y la primera vez que un cliente entra a tu portal. Cada aceptación queda registrada como evidencia.',
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="imcrm-space-y-3">
                    <div
                        className="imcrm-flex imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs"
                        data-testid="data-consent-lawyer-note"
                    >
                        <TriangleAlert className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        <span>
                            {__('Es un punto de partida: conviene que la revise tu abogado. La plantilla sugerida sigue la Ley 1581 de 2012 y el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015), pero cada empresa tiene sus propias finalidades y su política.')}
                        </span>
                    </div>
                    <ToggleRow
                        checked={draft.enabled}
                        onChange={(v) => set({ enabled: v })}
                        title={__('Pedir la autorización')}
                        hint={__('En todos tus formularios públicos (cada formulario la puede apagar en su constructor).')}
                        testId="data-consent-enabled"
                    />
                    <ToggleRow
                        checked={draft.ask_in_portal}
                        onChange={(v) => set({ ask_in_portal: v })}
                        title={__('Pedirla también en el portal del cliente')}
                        hint={__('La primera vez que entra y cada vez que cambia la versión del texto. Sin aceptarla no puede seguir usando el portal (sí cerrar sesión).')}
                        testId="data-consent-portal"
                    />
                    {draft.enabled && missing.length > 0 && (
                        <p className="imcrm-text-xs imcrm-text-destructive" data-testid="data-consent-missing">
                            {__('Para activarla falta:')} {missing.join(', ')}.
                        </p>
                    )}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1 imcrm-text-xs imcrm-text-muted-foreground" data-testid="data-consent-stats">
                        <span>
                            <strong className="imcrm-text-foreground">{state.stats.accepted}</strong> {__('autorizaciones registradas')}
                        </span>
                        <span>
                            <strong className="imcrm-text-foreground">{state.stats.withdrawn}</strong> {__('retiradas')}
                        </span>
                        <span>
                            <strong className="imcrm-text-foreground">{state.stats.forms_asking}</strong> {__('formularios publicados la piden')}
                        </span>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-text-base">{__('Responsable del tratamiento')}</CardTitle>
                    <CardDescription>
                        {__('Quién recoge los datos y cómo se le contacta. La ley exige el nombre, el correo o la dirección y el teléfono, para que el titular pueda ejercer sus derechos.')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    {RESPONSIBLE_FIELDS.map((f) => (
                        <label key={f.key} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <span className="imcrm-text-xs imcrm-font-medium">
                                {__(f.label)}
                                {f.required && <span className="imcrm-ml-0.5 imcrm-text-destructive">*</span>}
                            </span>
                            <Input
                                type={f.type ?? 'text'}
                                value={draft.responsible[f.key]}
                                placeholder={f.key === 'name' ? tenantName : f.placeholder}
                                onChange={(e) => setResp({ [f.key]: e.target.value })}
                                data-testid={`data-consent-resp-${f.key}`}
                            />
                        </label>
                    ))}
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 sm:imcrm-col-span-2">
                        <span className="imcrm-text-xs imcrm-font-medium">{__('Enlace a tu política de tratamiento de datos')}</span>
                        <Input
                            value={draft.policy_url}
                            placeholder="https://tuempresa.com/politica-de-datos"
                            onChange={(e) => set({ policy_url: e.target.value.trim() })}
                            data-testid="data-consent-policy"
                        />
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('Tiene que empezar con https://. Se muestra junto a la casilla y al final del texto.')}
                        </span>
                    </label>
                    {recommended.length > 0 && (
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground sm:imcrm-col-span-2">
                            {__('Recomendado (no obligatorio):')} {recommended.join(', ')}.
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-text-base">{__('Finalidades del tratamiento')}</CardTitle>
                    <CardDescription>
                        {__('Para qué usas los datos. Sé específico: la autorización sólo cubre lo que dice aquí.')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="imcrm-space-y-2">
                    {draft.purposes.map((p, i) => (
                        <div key={i} className="imcrm-flex imcrm-items-start imcrm-gap-2">
                            <span className="imcrm-mt-2 imcrm-w-5 imcrm-shrink-0 imcrm-text-right imcrm-text-xs imcrm-text-muted-foreground">{i + 1}.</span>
                            <Textarea
                                rows={2}
                                value={p}
                                onChange={(e) => set({ purposes: draft.purposes.map((x, j) => (j === i ? e.target.value : x)) })}
                                className="imcrm-min-h-0 imcrm-flex-1"
                                data-testid="data-consent-purpose"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={__('Quitar finalidad')}
                                onClick={() => set({ purposes: draft.purposes.filter((_, j) => j !== i) })}
                            >
                                <Trash2 className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </div>
                    ))}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2 imcrm-pl-7">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={draft.purposes.length >= 20}
                            onClick={() => set({ purposes: [...draft.purposes, ''] })}
                            data-testid="data-consent-add-purpose"
                        >
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Agregar finalidad')}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => set({ purposes: [...state.defaults.purposes] })}>
                            <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Usar las sugeridas')}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="imcrm-text-base">{__('Texto de la autorización')}</CardTitle>
                    <CardDescription>
                        {__('Usa las variables para los datos de tu empresa: se completan solas. Si un dato está vacío, el renglón que lo usa no aparece.')}
                    </CardDescription>
                </CardHeader>
                <CardContent className="imcrm-grid imcrm-gap-4 lg:imcrm-grid-cols-2">
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-2">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                            {state.variables.map((v) => (
                                <button
                                    key={v.key}
                                    type="button"
                                    title={v.label}
                                    onClick={() => insertVariable(v.key)}
                                    className="imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted/50 imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[11px] hover:imcrm-bg-accent"
                                >
                                    {`{{${v.key}}}`}
                                </button>
                            ))}
                        </div>
                        <Textarea
                            ref={templateRef}
                            rows={18}
                            value={template}
                            onChange={(e) => set({ template: e.target.value })}
                            className="imcrm-font-mono imcrm-text-xs imcrm-leading-relaxed"
                            data-testid="data-consent-template"
                        />
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            {draft.template !== null && (
                                <Button type="button" variant="ghost" size="sm" onClick={() => set({ template: null })} data-testid="data-consent-reset">
                                    <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Volver a la plantilla sugerida')}
                                </Button>
                            )}
                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {draft.template === null ? __('Usas la plantilla sugerida (recibe sus mejoras con cada versión de la app).') : __('Texto propio.')}
                            </span>
                        </div>
                        <label className="imcrm-mt-1 imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <span className="imcrm-text-xs imcrm-font-medium">{__('Texto junto a la casilla')}</span>
                            <Input
                                value={label}
                                onChange={(e) => set({ checkbox_label: e.target.value })}
                                data-testid="data-consent-label"
                            />
                        </label>
                    </div>
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-2">
                        <p className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Vista previa: así lo ve quien responde')}</p>
                        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-3" data-testid="data-consent-preview">
                            <label className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-text-sm">
                                <input type="checkbox" className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4" disabled />
                                <span>{preview.label}</span>
                            </label>
                            <p className="imcrm-ml-6 imcrm-mt-1.5 imcrm-text-xs imcrm-underline">{__('Ver la autorización completa')}</p>
                            <div className="imcrm-mt-2 imcrm-max-h-[420px] imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3 imcrm-text-xs imcrm-leading-relaxed">
                                {preview.text}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div
                className={cn(
                    'imcrm-sticky imcrm-bottom-2 imcrm-z-10 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-py-2.5 imcrm-shadow-imcrm-md',
                    !dirty && !error && 'imcrm-hidden',
                )}
                data-testid="data-consent-savebar"
            >
                {error ? (
                    <p role="alert" className="imcrm-mr-auto imcrm-text-xs imcrm-text-destructive" data-testid="data-consent-error">
                        {error}
                    </p>
                ) : (
                    <p className="imcrm-mr-auto imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Si cambia el texto, se crea una versión nueva al guardar.')}
                    </p>
                )}
                <Button type="button" variant="ghost" size="sm" disabled={!dirty || save.isPending} onClick={() => setDraft(saved)}>
                    {__('Descartar')}
                </Button>
                <Button type="button" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)} data-testid="data-consent-save">
                    {save.isPending && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                    {__('Guardar cambios')}
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <History className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        <CardTitle className="imcrm-text-base">{__('Versiones del texto')}</CardTitle>
                    </div>
                    <CardDescription>
                        {__('Cada vez que cambia el texto se crea una versión nueva. Cada autorización guarda la versión que la persona aceptó (y su huella), aunque después cambies el texto.')}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {state.versions.length === 0 ? (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Todavía no hay versiones: completa los datos y guarda.')}</p>
                    ) : (
                        <ul className="imcrm-divide-y imcrm-divide-border" data-testid="data-consent-versions">
                            {state.versions.map((v) => (
                                <li key={v.version} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-py-2 imcrm-text-sm">
                                    <span className="imcrm-font-medium">
                                        {__('Versión')} {v.version}
                                    </span>
                                    {state.current?.version === v.version && <Badge variant="success">{__('Vigente')}</Badge>}
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {formatDateTime(parseUtcDate(v.created_at))}
                                        {v.created_by_name ? ` · ${v.created_by_name}` : ''}
                                        {` · ${v.consents ?? 0} ${__('autorizaciones')}`}
                                    </span>
                                    <Button type="button" variant="ghost" size="sm" className="imcrm-ml-auto" onClick={() => setViewing(v.version)}>
                                        <FileText className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Ver texto')}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <DataConsentRecords />

            {viewing !== null && <VersionDialog version={viewing} onClose={() => setViewing(null)} />}
        </div>
    );
}

function ToggleRow({
    checked,
    onChange,
    title,
    hint,
    testId,
}: {
    checked: boolean;
    onChange: (v: boolean) => void;
    title: string;
    hint: string;
    testId: string;
}): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
            <input
                type="checkbox"
                className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-accent-[hsl(var(--imcrm-primary))]"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                data-testid={testId}
            />
            <span className="imcrm-space-y-0.5">
                <span className="imcrm-block imcrm-text-sm imcrm-font-medium">{title}</span>
                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{hint}</span>
            </span>
        </label>
    );
}

function VersionDialog({ version, onClose }: { version: number; onClose: () => void }): JSX.Element {
    const q = useQuery({ queryKey: ['data-consent-version', version], queryFn: () => api.dataConsentVersion(version) });
    const v: DataConsentVersionDto | undefined = q.data;
    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="data-consent-version-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {__('Versión')} {version}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-xs imcrm-text-muted-foreground">
                                {v ? `${formatDateTime(parseUtcDate(v.created_at))}${v.created_by_name ? ` · ${v.created_by_name}` : ''}` : __('Cargando…')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    {v && (
                        <>
                            <p className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-2.5 imcrm-text-sm">
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Casilla:')} </span>
                                {v.checkbox_label}
                            </p>
                            <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-auto imcrm-whitespace-pre-wrap imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3 imcrm-text-xs imcrm-leading-relaxed">
                                {v.text}
                            </div>
                            <p className="imcrm-break-all imcrm-font-mono imcrm-text-[10px] imcrm-text-muted-foreground">
                                {__('Huella (SHA-256):')} {v.text_hash}
                            </p>
                        </>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

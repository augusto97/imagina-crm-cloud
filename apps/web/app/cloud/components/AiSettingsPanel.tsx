import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiEffort, TenantAiSettings } from '@imagina-base/shared';
import { KeyRound, Sparkles } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { AiEffortSelect } from '@/cloud/components/AiEffortSelect';
import { AiModelSelect } from '@/cloud/components/AiModelSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeModelChoice, effortLabel, effortLevelsForChoice } from '@/lib/aiModels';
import { CloudApiError } from '@/lib/cloud/client';
import { __, sprintf } from '@/lib/i18n';

/**
 * Card "Asistente IA" de Ajustes del WORKSPACE (ADR-S21). Tres decisiones
 * del admin: (a) ACTIVAR el asistente — opt-in explícito porque los
 * esquemas de la empresa viajan a un proveedor externo; (b) con qué clave:
 * la de la plataforma (cuota mensual del plan) o una PROPIA (sin cuota,
 * cifrada en reposo, nunca vuelve del backend); (c) el modelo. Lo que la
 * plataforma no permite (compartir su clave / claves propias) se explica
 * en vez de fallar en silencio.
 */
export function AiSettingsPanel(): JSX.Element | null {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const q = useQuery({ queryKey: ['ai-settings', tenantId], queryFn: () => api.aiSettingsGet(), retry: false });
    const status = useQuery({ queryKey: ['ai-status', tenantId], queryFn: () => api.aiStatus(), retry: false });
    // v0.1.305 — los modelos salen de Anthropic (con la clave de la empresa o la de la plataforma).
    const models = useQuery({ queryKey: ['ai-models', tenantId], queryFn: () => api.aiModels(), retry: false, enabled: q.isSuccess });
    const refreshModels = useMutation({
        mutationFn: () => api.aiModels(true),
        onSuccess: (cat) => qc.setQueryData(['ai-models', tenantId], cat),
    });

    const [enabled, setEnabled] = useState(false);
    const [model, setModel] = useState<string>('');
    const [effort, setEffort] = useState<AiEffort | ''>('');
    const [apiKey, setApiKey] = useState('');
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    useEffect(() => {
        const s = q.data;
        if (!s) return;
        setEnabled(s.enabled);
        setModel(s.model ?? '');
        setEffort(s.effort ?? '');
        setApiKey('');
    }, [q.data]);

    const invalidate = (): void => {
        void qc.invalidateQueries({ queryKey: ['ai-settings', tenantId] });
        void qc.invalidateQueries({ queryKey: ['ai-status', tenantId] });
        void qc.invalidateQueries({ queryKey: ['billing', tenantId] });
        void qc.invalidateQueries({ queryKey: ['ai-models', tenantId] });
    };

    const save = useMutation({
        mutationFn: () =>
            api.aiSettingsSet({
                enabled,
                model: model === '' ? null : model,
                ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
                // v0.1.306 — el esfuerzo sólo se elige con clave propia (el servidor lo exige).
                ...(effortEditable ? { effort: effort === '' ? null : effort } : {}),
            }),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: __('Configuración guardada.') });
            invalidate();
        },
        onError: (err) => setNotice({ kind: 'err', text: err instanceof CloudApiError || err instanceof Error ? err.message : __('No se pudo guardar') }),
    });
    const clearKey = useMutation({
        mutationFn: () => api.aiSettingsSet({ clear_key: true }),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: __('Clave propia eliminada: el asistente vuelve a la clave de la plataforma.') });
            invalidate();
        },
        onError: (err) => setNotice({ kind: 'err', text: err instanceof Error ? err.message : __('No se pudo quitar la clave') }),
    });

    if (q.isError) {
        // 403 → no admin (el sidebar ya lo oculta); cualquier otro error se muestra.
        const e = q.error;
        if (e instanceof CloudApiError && e.status === 403) return null;
        return <p className="imcrm-text-sm imcrm-text-destructive">{e instanceof Error ? e.message : __('Error')}</p>;
    }
    const s: TenantAiSettings | undefined = q.data;
    const platformOff = s && !s.platform.enabled;
    const needsOwnKey = s && !s.platform.share_platform_key;
    const byokAllowed = s?.platform.allow_tenant_keys ?? true;
    // Con la clave propia (guardada, o tipeándola ahora) la empresa elige su esfuerzo.
    const effortEditable = !!s && (s.effort_editable || (byokAllowed && apiKey.trim() !== ''));
    const platformEffort = s?.platform.default_effort ?? 'medium';
    const effectiveModel = model === '' ? (s?.platform.default_model ?? '') : model;

    return (
        <Card data-testid="imcrm-ai-settings">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Sparkles className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <CardTitle>{__('Asistente IA')}</CardTitle>
                            {s && (
                                <Badge dot variant={status.data?.available ? 'success' : s.enabled ? 'warning' : 'secondary'}>
                                    {status.data?.available ? __('Disponible') : s.enabled ? __('Activado, sin acceso') : __('Desactivado')}
                                </Badge>
                            )}
                        </div>
                        <CardDescription>
                            {__('Pídele en lenguaje natural listas, campos, vistas, tableros y automatizaciones. Siempre muestra una vista previa antes de aplicar nada, y sólo puede hacer lo que el rol de cada persona ya le permite.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-5 imcrm-pt-0">
                {platformOff && (
                    <p className="imcrm-rounded-lg imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs">
                        {__('El operador de la plataforma tiene el asistente desactivado: por ahora no se puede usar aunque lo actives aquí.')}
                    </p>
                )}

                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" className="imcrm-mt-0.5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="imcrm-ai-enabled" />
                    <span>
                        <span className="imcrm-font-medium">{__('Activar el asistente para esta empresa')}</span>
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Para responder, el asistente envía al proveedor de IA la ESTRUCTURA de tus listas (nombres de campos, tipos, opciones) y lo que escriban tus miembros en el chat. No envía los registros.')}
                        </span>
                    </span>
                </label>

                <AiModelSelect
                    id="ai-model"
                    label={__('Modelo')}
                    value={model}
                    onChange={setModel}
                    catalog={models.data}
                    refreshing={refreshModels.isPending}
                    onRefresh={() => refreshModels.mutate()}
                    inheritLabel={
                        s ? `${__('El de la plataforma')} (${describeModelChoice(s.platform.default_model, models.data)})` : __('El de la plataforma')
                    }
                    hint={__('Con «el más reciente» el asistente pasa solo a cada modelo nuevo que publique Anthropic.')}
                    testId="imcrm-ai-model"
                />

                <AiEffortSelect
                    id="ai-effort"
                    value={effortEditable ? effort : ''}
                    onChange={setEffort}
                    levels={effectiveModel ? effortLevelsForChoice(effectiveModel, models.data) : null}
                    inheritLabel={sprintf(/* translators: %s: effort level */ __('El de la plataforma (%s)'), effortLabel(platformEffort))}
                    inheritedValue={platformEffort}
                    disabled={!effortEditable}
                    disabledNote={
                        byokAllowed
                            ? __('Con la clave de la plataforma se usa el nivel que fija la plataforma. Para elegir otro, carga la clave propia de la empresa.')
                            : __('La plataforma fija el nivel de esfuerzo.')
                    }
                    hint={__('Cuánto piensa el asistente antes de responder. Más esfuerzo da respuestas más cuidadas en pedidos complejos, pero más lentas y con más consumo de tu clave.')}
                    testId="imcrm-ai-effort"
                />

                <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-p-3">
                    <legend className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-px-1 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        <KeyRound className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Clave del proveedor')}
                    </legend>
                    {s?.has_own_key ? (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <Badge variant={s.key_unreadable ? 'destructive' : 'success'}>
                                {s.key_unreadable ? __('Clave propia ilegible') : `${__('Clave propia')} ${s.key_hint ?? ''}`}
                            </Badge>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                {s.key_unreadable
                                    ? __('La clave guardada no se puede descifrar con la clave actual del servidor: escríbela de nuevo.')
                                    : __('Tus pedidos no consumen la cuota del plan.')}
                            </span>
                            <Button variant="ghost" size="sm" onClick={() => clearKey.mutate()} disabled={clearKey.isPending} data-testid="imcrm-ai-clear-key">
                                {__('Quitar clave propia')}
                            </Button>
                        </div>
                    ) : (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {needsOwnKey
                                ? __('La plataforma no comparte su clave: para usar el asistente tu empresa tiene que cargar la suya.')
                                : status.data?.usage.limit !== null && status.data
                                  ? `${__('Usas la clave de la plataforma con la cuota de tu plan')} (${status.data.usage.used} / ${status.data.usage.limit} ${__('pedidos este mes')}).`
                                  : __('Usas la clave de la plataforma.')}
                        </p>
                    )}
                    {byokAllowed ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="ai-key" className="imcrm-text-xs">
                                {s?.has_own_key ? __('Reemplazar la clave propia') : __('Cargar una clave propia (opcional)')}
                            </Label>
                            <Input
                                id="ai-key"
                                type="password"
                                autoComplete="off"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="sk-ant-…"
                                className="imcrm-font-mono"
                                data-testid="imcrm-ai-key"
                            />
                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Clave de API de Anthropic. Se guarda cifrada y nunca se vuelve a mostrar completa. Con clave propia el asistente no tiene límite mensual.')}
                            </span>
                        </div>
                    ) : (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('La plataforma no permite claves propias por empresa.')}</p>
                    )}
                </fieldset>

                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Button onClick={() => save.mutate()} disabled={save.isPending || !s} data-testid="imcrm-ai-save">
                        {save.isPending ? __('Guardando…') : __('Guardar')}
                    </Button>
                    {notice && (
                        <span className={notice.kind === 'ok' ? 'imcrm-text-xs imcrm-text-success' : 'imcrm-text-xs imcrm-text-destructive'} data-testid="imcrm-ai-notice">
                            {notice.text}
                        </span>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

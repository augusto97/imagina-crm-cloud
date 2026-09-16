import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_MODELS, type AiModel } from '@imagina-base/shared';
import { KeyRound, Sparkles } from 'lucide-react';

import { api } from '@/cloud/session';
import { AI_MODEL_LABELS } from '@/cloud/components/AiSettingsPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';

/**
 * Consola de plataforma → Asistente IA (ADR-S21). El operador decide:
 * el interruptor GENERAL, la clave del proveedor (cifrada; nunca vuelve),
 * el modelo por defecto y las dos políticas comerciales — compartir su
 * clave con las empresas (con la cuota mensual del plan) y/o permitir que
 * cada empresa cargue la suya (BYOK, sin cuota). "Probar" hace una llamada
 * mínima con la clave tipeada (o la guardada) antes de confiar en ella.
 */
export function PlatformAiCard(): JSX.Element | null {
    const qc = useQueryClient();
    const q = useQuery({ queryKey: ['platform-ai'], queryFn: () => api.platformAiGet(), retry: false });

    const [enabled, setEnabled] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState<AiModel>('claude-opus-5');
    const [share, setShare] = useState(true);
    const [allowOwn, setAllowOwn] = useState(true);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    useEffect(() => {
        const s = q.data;
        if (!s) return;
        setEnabled(s.enabled);
        setModel(s.model);
        setShare(s.share_platform_key);
        setAllowOwn(s.allow_tenant_keys);
        setApiKey('');
    }, [q.data]);

    const save = useMutation({
        mutationFn: () =>
            api.platformAiSet({
                enabled,
                model,
                share_platform_key: share,
                allow_tenant_keys: allowOwn,
                ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
            }),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: __('Configuración guardada.') });
            void qc.invalidateQueries({ queryKey: ['platform-ai'] });
        },
        onError: (err) => setNotice({ kind: 'err', text: err instanceof CloudApiError || err instanceof Error ? err.message : __('No se pudo guardar') }),
    });
    const clearKey = useMutation({
        mutationFn: () => api.platformAiSet({ clear_key: true }),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: __('Clave eliminada.') });
            void qc.invalidateQueries({ queryKey: ['platform-ai'] });
        },
    });
    const test = useMutation({
        mutationFn: () => api.platformAiTest(apiKey.trim() || undefined),
        onSuccess: (r) => setNotice({ kind: r.ok ? 'ok' : 'err', text: r.message }),
        onError: (err) => setNotice({ kind: 'err', text: err instanceof Error ? err.message : __('No se pudo probar') }),
    });

    if (q.isError) return null;
    const s = q.data;

    return (
        <Card data-testid="imcrm-platform-ai">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Sparkles className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <CardTitle>{__('Asistente IA')}</CardTitle>
                            {s && (
                                <Badge dot variant={s.enabled && s.has_key ? 'success' : s.enabled ? 'warning' : 'secondary'}>
                                    {s.enabled ? (s.has_key ? __('Activo') : __('Activo, sin clave')) : __('Desactivado')}
                                </Badge>
                            )}
                        </div>
                        <CardDescription>
                            {__('Clave del proveedor (Anthropic), modelo por defecto y cómo la pagan las empresas: con tu clave y la cuota mensual de su plan, con la suya propia, o ambas.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-5 imcrm-pt-0">
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="imcrm-pai-enabled" />
                    <span className="imcrm-font-medium">{__('Asistente habilitado en la plataforma')}</span>
                </label>

                <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-p-3">
                    <legend className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-px-1 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        <KeyRound className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Clave de la plataforma')}
                    </legend>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        {s?.has_key ? (
                            <Badge variant={s.key_unreadable ? 'destructive' : 'success'}>
                                {s.key_unreadable ? __('Clave guardada ilegible') : `${__('Clave guardada')} ${s.key_hint ?? ''}`}
                            </Badge>
                        ) : (
                            <Badge variant="secondary">{__('Sin clave')}</Badge>
                        )}
                        {s?.key_unreadable && (
                            <span className="imcrm-text-xs imcrm-text-destructive">
                                {__('No descifra con la SECRETS_KEY actual del servidor: escribila de nuevo.')}
                            </span>
                        )}
                        {s?.has_key && (
                            <Button variant="ghost" size="sm" onClick={() => clearKey.mutate()} disabled={clearKey.isPending}>
                                {__('Quitar')}
                            </Button>
                        )}
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor="pai-key" className="imcrm-text-xs">{s?.has_key ? __('Reemplazar la clave') : __('Clave de API')}</Label>
                        <div className="imcrm-flex imcrm-gap-2">
                            <Input
                                id="pai-key"
                                type="password"
                                autoComplete="off"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="sk-ant-…"
                                className="imcrm-font-mono"
                                data-testid="imcrm-pai-key"
                            />
                            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || (!apiKey.trim() && !s?.has_key)} data-testid="imcrm-pai-test">
                                {test.isPending ? __('Probando…') : __('Probar')}
                            </Button>
                        </div>
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('Se guarda cifrada (SECRETS_KEY). También se puede fijar por env con AI_API_KEY como respaldo.')}
                        </span>
                    </div>
                </fieldset>

                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Label htmlFor="pai-model" className="imcrm-text-xs">{__('Modelo por defecto')}</Label>
                    <Select id="pai-model" value={model} onChange={(e) => setModel(e.target.value as AiModel)} data-testid="imcrm-pai-model">
                        {AI_MODELS.map((m) => (
                            <option key={m} value={m}>
                                {AI_MODEL_LABELS[m]}
                            </option>
                        ))}
                    </Select>
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Cada empresa puede elegir otro en sus Ajustes.')}</span>
                </div>

                <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <legend className="imcrm-mb-1 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('Cómo lo usan las empresas')}
                    </legend>
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input type="checkbox" className="imcrm-mt-0.5" checked={share} onChange={(e) => setShare(e.target.checked)} data-testid="imcrm-pai-share" />
                        <span>
                            <span className="imcrm-font-medium">{__('Compartir la clave de la plataforma')}</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Las empresas usan tu clave con la cuota mensual de su plan (columna "IA/mes" en Planes). Los pedidos los pagás vos.')}
                            </span>
                        </span>
                    </label>
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input type="checkbox" className="imcrm-mt-0.5" checked={allowOwn} onChange={(e) => setAllowOwn(e.target.checked)} data-testid="imcrm-pai-allow-own" />
                        <span>
                            <span className="imcrm-font-medium">{__('Permitir claves propias por empresa')}</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Cada empresa puede cargar su clave en Ajustes → Asistente IA: sin cuota y a su cargo.')}
                            </span>
                        </span>
                    </label>
                    {!share && !allowOwn && (
                        <p className="imcrm-text-xs imcrm-text-warning">{__('Con las dos apagadas ninguna empresa puede usar el asistente.')}</p>
                    )}
                </fieldset>

                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    <Button onClick={() => save.mutate()} disabled={save.isPending || !s} data-testid="imcrm-pai-save">
                        {save.isPending ? __('Guardando…') : __('Guardar')}
                    </Button>
                    {notice && (
                        <span className={notice.kind === 'ok' ? 'imcrm-text-xs imcrm-text-success' : 'imcrm-text-xs imcrm-text-destructive'} data-testid="imcrm-pai-notice">
                            {notice.text}
                        </span>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

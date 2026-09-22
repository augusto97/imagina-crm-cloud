import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation } from '@tanstack/react-query';
import type {
    Connection,
    ConnectorVisibility,
    IntegrationDef,
    IntegrationFieldDef,
    VerifyIntegrationResult,
} from '@imagina-base/shared';
import { CheckCircle2, ChevronDown, ChevronRight, Search, Send, X } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Conectar una app que funciona con una clave (v0.1.203): WhatsApp (WAS) y
 * Telegram. Un solo diálogo con los datos que pide ESA app, rotulados en
 * criollo y con los pasos para encontrarlos. La clave se prueba contra el
 * servicio antes de guardarse: si está mal, se sabe acá y no a la primera
 * automatización que falle.
 *
 * v0.1.204: la prueba que vale es un MENSAJE REAL («Enviar prueba»). Listar
 * cuentas es sólo una ayuda: una clave de WAS con permiso de envío y sin
 * permiso de listado es perfectamente válida.
 */
export function IntegrationKeyDialog({
    def,
    connection,
    visibility,
    onClose,
    onDone,
}: {
    def: IntegrationDef;
    /** Si viene, se actualiza esa conexión (rotar la clave). */
    connection: Connection | null;
    visibility: ConnectorVisibility;
    onClose: () => void;
    onDone: (message: string) => void;
}): JSX.Element {
    const fields: IntegrationFieldDef[] = def.auth.kind === 'key' ? def.auth.fields : [];
    const howTo = def.auth.kind === 'key' ? def.auth.how_to : [];
    const testDef = def.auth.kind === 'key' ? (def.auth.test ?? null) : null;
    const [testTo, setTestTo] = useState('');
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [values, setValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(fields.filter((f) => !f.secret).map((f) => [f.key, f.default])),
    );
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [check, setCheck] = useState<VerifyIntegrationResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const editing = connection !== null;

    const payload = (): Record<string, string> =>
        Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));

    const verify = useMutation({
        mutationFn: () =>
            api.integrationVerify(def.key, { fields: payload(), connection_id: connection?.id ?? null }),
        onSuccess: (res) => {
            setCheck(res);
            setError(res.ok ? null : res.error);
            // Si hay una sola cuenta posible, se elige sola.
            for (const [key, options] of Object.entries(res.options)) {
                if (options.length === 1 && (values[key] ?? '') === '') {
                    setValues((prev) => ({ ...prev, [key]: options[0]!.value }));
                }
            }
        },
        onError: (err) => setError(errText(err)),
    });

    const sendTest = useMutation({
        mutationFn: (to: string) =>
            api.integrationVerify(def.key, {
                fields: payload(),
                connection_id: connection?.id ?? null,
                test_to: to,
            }),
        onSuccess: (res, to) => {
            setCheck(res);
            setError(res.ok ? null : res.error);
            setSentTo(res.ok && res.test_sent ? to : null);
        },
        onError: (err) => {
            setSentTo(null);
            setError(errText(err));
        },
    });

    const save = useMutation({
        mutationFn: () =>
            api.integrationConnect(def.key, {
                fields: payload(),
                visibility,
                connection_id: connection?.id ?? null,
            }),
        onSuccess: (res) =>
            onDone(
                res.warning
                    ? `${def.name} ${__('quedó conectada.')} ${res.warning}`
                    : `${def.name} ${__('quedó conectada. Ya aparece en el menú de acciones de tus automatizaciones.')}`,
            ),
        onError: (err) => setError(errText(err)),
    });

    const visible = fields.filter((f) => !f.advanced);
    const advanced = fields.filter((f) => f.advanced);
    const secretField = fields.find((f) => f.secret);
    const hasLookup = fields.some((f) => f.lookup);

    const renderField = (f: IntegrationFieldDef): JSX.Element => {
        const options = check?.options[f.key] ?? [];
        const value = values[f.key] ?? '';
        return (
            <div key={f.key} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor={`int-${f.key}`}>
                    {f.label}
                    {f.required && <span className="imcrm-text-destructive"> *</span>}
                </Label>
                {f.lookup && options.length > 0 ? (
                    <Select
                        id={`int-${f.key}`}
                        value={value}
                        onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        data-testid={`imcrm-integration-field-${f.key}`}
                    >
                        <option value="">{__('Elegí una opción')}</option>
                        {options.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </Select>
                ) : (
                    <Input
                        id={`int-${f.key}`}
                        type={f.secret ? 'password' : 'text'}
                        autoComplete="off"
                        value={value}
                        placeholder={
                            f.secret && editing ? __('Dejá vacío para conservar la guardada') : f.placeholder
                        }
                        onChange={(e) => {
                            setValues((prev) => ({ ...prev, [f.key]: e.target.value }));
                            if (f.secret) setCheck(null);
                            setSentTo(null);
                        }}
                        data-testid={`imcrm-integration-field-${f.key}`}
                    />
                )}
                {f.help !== '' && <p className="imcrm-text-xs imcrm-text-muted-foreground">{f.help}</p>}
            </div>
        );
    };

    const secretTyped = secretField ? (values[secretField.key] ?? '').trim() !== '' : true;

    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg',
                        'imcrm-max-h-[90vh] imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-integration-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <IntegrationLogo integrationKey={def.key} size={44} />
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {editing ? `${__('Actualizar')} ${def.name}` : `${__('Conectar')} ${def.name}`}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {def.description}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    {howTo.length > 0 && (
                        <ol className="imcrm-mt-4 imcrm-list-decimal imcrm-space-y-1 imcrm-rounded-md imcrm-bg-muted imcrm-py-3 imcrm-pl-8 imcrm-pr-3 imcrm-text-xs imcrm-text-muted-foreground">
                            {howTo.map((step) => (
                                <li key={step}>{step}</li>
                            ))}
                        </ol>
                    )}

                    <form
                        className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setError(null);
                            save.mutate();
                        }}
                    >
                        {visible.map(renderField)}

                        {hasLookup && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="imcrm-self-start"
                                disabled={verify.isPending || (!secretTyped && !editing)}
                                onClick={() => {
                                    setError(null);
                                    verify.mutate();
                                }}
                                data-testid="imcrm-integration-lookup"
                            >
                                <Search className="imcrm-h-3.5 imcrm-w-3.5" />
                                {verify.isPending ? __('Buscando…') : __('Buscar mis cuentas')}
                            </Button>
                        )}

                        {advanced.length > 0 && (
                            <div>
                                <button
                                    type="button"
                                    className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                                    onClick={() => setShowAdvanced((v) => !v)}
                                >
                                    {showAdvanced ? (
                                        <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5" />
                                    ) : (
                                        <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" />
                                    )}
                                    {__('Opciones avanzadas')}
                                </button>
                                {showAdvanced && (
                                    <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-4">
                                        {advanced.map(renderField)}
                                    </div>
                                )}
                            </div>
                        )}

                        {testDef && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                                <Label htmlFor="int-test-to">{testDef.label}</Label>
                                <div className="imcrm-flex imcrm-gap-2">
                                    <Input
                                        id="int-test-to"
                                        autoComplete="off"
                                        value={testTo}
                                        placeholder={testDef.placeholder}
                                        onChange={(e) => {
                                            setTestTo(e.target.value);
                                            setSentTo(null);
                                        }}
                                        data-testid="imcrm-integration-test-to"
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={
                                            sendTest.isPending || testTo.trim() === '' || (!secretTyped && !editing)
                                        }
                                        onClick={() => {
                                            setError(null);
                                            sendTest.mutate(testTo.trim());
                                        }}
                                        data-testid="imcrm-integration-test-send"
                                    >
                                        <Send className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {sendTest.isPending ? __('Enviando…') : __('Enviar prueba')}
                                    </Button>
                                </div>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">{testDef.help}</p>
                            </div>
                        )}

                        {sentTo !== null && !error && (
                            <p
                                className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-text-success"
                                data-testid="imcrm-integration-test-ok"
                            >
                                <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                                {`${__('Mensaje de prueba enviado a')} ${sentTo}. ${__('Si te llegó, ya podés conectar.')}`}
                            </p>
                        )}
                        {sentTo === null &&
                            check?.ok &&
                            !error &&
                            (check.account_label !== null || Object.values(check.options).some((o) => o.length > 0)) && (
                                <p
                                    className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-text-success"
                                    data-testid="imcrm-integration-verified"
                                >
                                    <CheckCircle2 className="imcrm-h-4 imcrm-w-4" />
                                    {check.account_label
                                        ? `${__('Clave válida')} · ${check.account_label}`
                                        : __('Clave válida')}
                                </p>
                            )}
                        {check?.warning && !error && (
                            <p className="imcrm-text-xs imcrm-text-warning">{check.warning}</p>
                        )}
                        {error && (
                            <p className="imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-integration-error">
                                {error}
                            </p>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {__('Cancelar')}
                            </Button>
                            <Button type="submit" disabled={save.isPending} data-testid="imcrm-integration-save">
                                {save.isPending ? __('Comprobando…') : editing ? __('Guardar') : __('Conectar')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

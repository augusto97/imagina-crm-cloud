import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
    SIGNATURE_MAX_SIGNERS,
    SIGNATURE_VERIFY,
    createSignatureRequestSchema,
    signatureVerifyNeedsPhone,
    type SignatureRequestDto,
    type SignatureVerify,
    type SignatureVerifyTemplate,
} from '@imagina-base/shared';
import { ChevronDown, ChevronUp, FileSignature, Loader2, Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { SignatureCodeChannelPicker } from './SignatureCodeChannelPicker';
import { useCreateSignature, useSignatureSources } from './useSignatures';

interface SignerRow {
    name: string;
    email: string;
    phone: string;
    role: string;
}

/** Cómo confirma quien firma que es quien dice ser (v0.1.448: también por SMS o WhatsApp). */
const VERIFY_OPTIONS: Record<SignatureVerify, string> = {
    email: 'Con un código que le llega al correo (recomendado)',
    sms: 'Con un código que le llega por SMS',
    whatsapp: 'Con un código que le llega por WhatsApp',
    none: 'Sólo con el enlace',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

/** La persona del registro: el título, el primer correo y el primer celular que tenga. */
function suggestedSigner(record: RecordEntity | undefined, fields: FieldEntity[]): SignerRow {
    if (!record) return { name: '', email: '', phone: '', role: '' };
    const title = fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text');
    const email = fields.filter((f) => f.type === 'email').map((f) => str(record.fields[f.slug])).find((v) => EMAIL_RE.test(v)) ?? '';
    const phone = fields.filter((f) => f.type === 'phone').map((f) => str(record.fields[f.slug])).find((v) => v !== '') ?? '';
    return { name: title ? str(record.fields[title.slug]).slice(0, 120) : '', email, phone: phone.slice(0, 32), role: '' };
}

function errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * D6 (v0.1.446) — «Pedir firma»: qué PDF (una plantilla de la lista o un PDF
 * que ya está en el registro), quiénes firman y en qué orden, cómo se
 * identifican, y qué pasa en el registro cuando firman todos.
 */
export default function RequestSignatureDialog({
    listId,
    recordId,
    fields,
    record,
    initialTemplateId,
    onClose,
    onCreated,
}: {
    listId: number;
    recordId: number;
    fields: FieldEntity[];
    record?: RecordEntity;
    initialTemplateId?: number;
    onClose: () => void;
    onCreated: (dto: SignatureRequestDto, emailed: boolean) => void;
}): JSX.Element {
    const sources = useSignatureSources(listId, recordId, true);
    const create = useCreateSignature(listId, recordId);
    const [source, setSource] = useState<string>(initialTemplateId ? `t:${initialTemplateId}` : '');
    const [title, setTitle] = useState('');
    const [signers, setSigners] = useState<SignerRow[]>(() => [suggestedSigner(record, fields)]);
    const [order, setOrder] = useState<'parallel' | 'sequential'>('parallel');
    const [verify, setVerify] = useState<SignatureVerify>('email');
    const [codeConnection, setCodeConnection] = useState<number | null>(null);
    const [codeTemplate, setCodeTemplate] = useState<SignatureVerifyTemplate | null>(null);
    const needsPhone = signatureVerifyNeedsPhone(verify);
    const [message, setMessage] = useState('');
    const [expires, setExpires] = useState('30');
    const [remind, setRemind] = useState('3');
    const [sendEmail, setSendEmail] = useState(true);
    const [moreOpen, setMoreOpen] = useState(false);
    const [saveField, setSaveField] = useState('');
    const [statusField, setStatusField] = useState('');
    const [statusValue, setStatusValue] = useState('');
    const [dateField, setDateField] = useState('');
    const [error, setError] = useState<string | null>(null);

    const fileFields = fields.filter((f) => f.type === 'file');
    const selectFields = fields.filter((f) => f.type === 'select');
    const dateFields = fields.filter((f) => f.type === 'date' || f.type === 'datetime');
    const statusOptions = useMemo(() => {
        const f = selectFields.find((x) => String(x.id) === statusField);
        const opts = (f?.config as { options?: Array<{ value: string; label: string }> } | undefined)?.options ?? [];
        return Array.isArray(opts) ? opts : [];
    }, [selectFields, statusField]);

    const templates = sources.data?.templates ?? [];
    const files = sources.data?.files ?? [];
    // Sin elección, la primera plantilla (o el primer PDF).
    const effectiveSource = source || (templates[0] ? `t:${templates[0].id}` : files[0] ? `f:${files[0].id}` : '');
    const nothing = !sources.isLoading && templates.length === 0 && files.length === 0;

    const setSigner = (i: number, patch: Partial<SignerRow>): void => setSigners((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const move = (i: number, d: -1 | 1): void =>
        setSigners((rows) => {
            const j = i + d;
            if (j < 0 || j >= rows.length) return rows;
            const next = [...rows];
            [next[i], next[j]] = [next[j]!, next[i]!];
            return next;
        });

    const submit = (): void => {
        setError(null);
        const [kind, rawId] = effectiveSource.split(':');
        const id = Number(rawId);
        if (!kind || !Number.isFinite(id) || id <= 0) {
            setError(__('Elige el documento que se firma.'));
            return;
        }
        const parsed = createSignatureRequestSchema.safeParse({
            record_id: recordId,
            source: kind === 't' ? { kind: 'template', template_id: id } : { kind: 'file', file_id: id },
            title: title.trim(),
            signers: signers.map((s) => ({ name: s.name.trim(), email: s.email.trim(), phone: needsPhone ? s.phone.trim() : '', role: s.role.trim() })),
            order,
            message: message.trim(),
            expires_days: Number(expires),
            verify,
            verify_connection_id: needsPhone ? codeConnection : null,
            verify_template: verify === 'whatsapp' ? codeTemplate : null,
            remind_days: Number(remind),
            on_complete: {
                save_field_id: saveField ? Number(saveField) : null,
                status_field_id: statusField ? Number(statusField) : null,
                status_value: statusField && statusValue ? statusValue : null,
                date_field_id: dateField ? Number(dateField) : null,
            },
            send_email: sendEmail,
        });
        if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? __('Revisa los datos.'));
            return;
        }
        create.mutate(parsed.data, {
            onSuccess: (dto) => onCreated(dto, sendEmail),
            onError: (err) => setError(errText(err)),
        });
    };

    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-bg-card sm:imcrm-inset-auto sm:imcrm-left-1/2 sm:imcrm-top-1/2 sm:imcrm-max-h-[90vh] sm:imcrm-w-[calc(100%-1.5rem)] sm:imcrm-max-w-xl sm:imcrm--translate-x-1/2 sm:imcrm--translate-y-1/2 sm:imcrm-rounded-lg sm:imcrm-border sm:imcrm-border-border sm:imcrm-shadow-imcrm-lg"
                    data-testid="signature-request-dialog"
                    data-tour="signature-request"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-p-5">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                            <FileSignature className="imcrm-h-5 imcrm-w-5" />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Pedir firma')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Cada persona recibe un enlace para leer el documento y firmarlo desde el celular o el computador, sin crear una cuenta.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    <form
                        className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col"
                        onSubmit={(e) => {
                            e.preventDefault();
                            submit();
                        }}
                    >
                        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-4 imcrm-overflow-y-auto imcrm-p-5">
                            {/* El documento */}
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sig-source">{__('Documento')}</Label>
                                {sources.isLoading ? (
                                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Buscando los documentos…')}
                                    </p>
                                ) : nothing ? (
                                    <p className="imcrm-rounded-md imcrm-bg-muted imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-muted-foreground" data-testid="signature-no-sources">
                                        {__('No hay nada para firmar todavía: arma una plantilla de documento en la configuración de la lista (Documentos) o sube un PDF a un campo Archivo del registro.')}
                                    </p>
                                ) : (
                                    <Select id="sig-source" value={effectiveSource} onChange={(e) => setSource(e.target.value)} data-testid="signature-source">
                                        {templates.length > 0 && (
                                            <optgroup label={__('Plantillas de documento')}>
                                                {templates.map((t) => (
                                                    <option key={`t${t.id}`} value={`t:${t.id}`}>
                                                        {t.name}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {files.length > 0 && (
                                            <optgroup label={__('PDF del registro')}>
                                                {files.map((f) => (
                                                    <option key={`f${f.id}`} value={`f:${f.id}`}>
                                                        {f.filename}
                                                        {f.field ? ` (${f.field})` : ''}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        )}
                                    </Select>
                                )}
                                {effectiveSource.startsWith('t:') && (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Se arma con los datos del registro en este momento; lo que se firma ya no cambia aunque cambie el registro.')}
                                    </p>
                                )}
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sig-title">{__('Nombre del documento')}</Label>
                                <Input id="sig-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={__('El de la plantilla o el del archivo')} />
                            </div>

                            {/* Quiénes firman */}
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-tour="signature-signers">
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                                    <Label>{__('Quiénes firman')}</Label>
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {signers.length} / {SIGNATURE_MAX_SIGNERS}
                                    </span>
                                </div>
                                {signers.map((s, i) => (
                                    <div key={i} className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3" data-testid="signature-signer-row">
                                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                            {order === 'sequential' && (
                                                <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-xs imcrm-font-semibold">
                                                    {i + 1}
                                                </span>
                                            )}
                                            <Input
                                                value={s.name}
                                                onChange={(e) => setSigner(i, { name: e.target.value })}
                                                placeholder={__('Nombre completo')}
                                                aria-label={__('Nombre completo')}
                                                maxLength={120}
                                                className="imcrm-flex-1"
                                                data-testid="signature-signer-name"
                                            />
                                            {order === 'sequential' && signers.length > 1 && (
                                                <span className="imcrm-flex">
                                                    <button type="button" className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={__('Subir')}>
                                                        <ChevronUp className="imcrm-h-4 imcrm-w-4" />
                                                    </button>
                                                    <button type="button" className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-30" disabled={i === signers.length - 1} onClick={() => move(i, 1)} aria-label={__('Bajar')}>
                                                        <ChevronDown className="imcrm-h-4 imcrm-w-4" />
                                                    </button>
                                                </span>
                                            )}
                                            {signers.length > 1 && (
                                                <button
                                                    type="button"
                                                    className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-destructive"
                                                    onClick={() => setSigners((rows) => rows.filter((_, j) => j !== i))}
                                                    aria-label={__('Quitar')}
                                                >
                                                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                                </button>
                                            )}
                                        </div>
                                        <div className="imcrm-mt-2 imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-[3fr_2fr]">
                                            <Input
                                                type="email"
                                                value={s.email}
                                                onChange={(e) => setSigner(i, { email: e.target.value })}
                                                placeholder={__('correo@ejemplo.com')}
                                                aria-label={__('Correo')}
                                                data-testid="signature-signer-email"
                                            />
                                            <Input value={s.role} onChange={(e) => setSigner(i, { role: e.target.value })} placeholder={__('Rol (opcional)')} aria-label={__('Rol')} maxLength={60} />
                                        </div>
                                        {needsPhone && (
                                            <Input
                                                type="tel"
                                                className="imcrm-mt-2"
                                                value={s.phone}
                                                onChange={(e) => setSigner(i, { phone: e.target.value })}
                                                placeholder={__('Celular (con indicativo, ej. +57 300 123 4567)')}
                                                aria-label={__('Celular')}
                                                maxLength={32}
                                                data-testid="signature-signer-phone"
                                            />
                                        )}
                                    </div>
                                ))}
                                {signers.length < SIGNATURE_MAX_SIGNERS && (
                                    <Button type="button" variant="outline" size="sm" className="imcrm-self-start imcrm-gap-1.5" onClick={() => setSigners((rows) => [...rows, { name: '', email: '', phone: '', role: '' }])} data-testid="signature-add-signer">
                                        <Plus className="imcrm-h-4 imcrm-w-4" />
                                        {__('Agregar otra persona')}
                                    </Button>
                                )}
                            </div>

                            {signers.length > 1 && (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label htmlFor="sig-order">{__('Orden')}</Label>
                                    <Select id="sig-order" value={order} onChange={(e) => setOrder(e.target.value as 'parallel' | 'sequential')} data-testid="signature-order">
                                        <option value="parallel">{__('Todos a la vez')}</option>
                                        <option value="sequential">{__('Uno después del otro (en este orden)')}</option>
                                    </Select>
                                    {order === 'sequential' && (
                                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cada persona recibe el enlace cuando firma la anterior.')}</p>
                                    )}
                                </div>
                            )}

                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sig-verify">{__('Cómo confirma que es quien dice ser')}</Label>
                                <Select id="sig-verify" value={verify} onChange={(e) => setVerify(e.target.value as SignatureVerify)} data-testid="signature-verify">
                                    {SIGNATURE_VERIFY.map((v) => (
                                        <option key={v} value={v}>
                                            {__(VERIFY_OPTIONS[v])}
                                        </option>
                                    ))}
                                </Select>
                                {needsPhone && (
                                    <>
                                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                            {__('El código llega al celular de cada persona. El enlace para firmar le sigue llegando al correo.')}
                                        </p>
                                        <SignatureCodeChannelPicker
                                            channel={verify as 'sms' | 'whatsapp'}
                                            connectionId={codeConnection}
                                            template={codeTemplate}
                                            onChange={(next) => {
                                                setCodeConnection(next.connectionId);
                                                setCodeTemplate(next.template);
                                            }}
                                        />
                                    </>
                                )}
                            </div>

                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="sig-message">{__('Mensaje (opcional)')}</Label>
                                <Textarea id="sig-message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder={__('Va en el correo y en la página de firma.')} />
                            </div>

                            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label htmlFor="sig-expires">{__('Vence en')}</Label>
                                    <Select id="sig-expires" value={expires} onChange={(e) => setExpires(e.target.value)}>
                                        {[3, 7, 15, 30, 60, 90].map((d) => (
                                            <option key={d} value={d}>
                                                {d} {__('días')}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <Label htmlFor="sig-remind">{__('Recordar a quien no firmó')}</Label>
                                    <Select id="sig-remind" value={remind} onChange={(e) => setRemind(e.target.value)}>
                                        <option value="0">{__('Nunca')}</option>
                                        <option value="1">{__('Cada día')}</option>
                                        <option value="2">{__('Cada 2 días')}</option>
                                        <option value="3">{__('Cada 3 días')}</option>
                                        <option value="7">{__('Cada semana')}</option>
                                    </Select>
                                </div>
                            </div>

                            <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                                <input type="checkbox" className="imcrm-mt-0.5" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} data-testid="signature-send-email" />
                                <span>
                                    {__('Mandar los enlaces por correo')}
                                    <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Si lo apagas, copias el enlace de cada persona y se lo mandas tú (por WhatsApp, por ejemplo).')}
                                    </span>
                                </span>
                            </label>

                            {/* Al terminar */}
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-border" data-tour="signature-on-complete">
                                <button
                                    type="button"
                                    className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-sm imcrm-font-medium"
                                    onClick={() => setMoreOpen((v) => !v)}
                                    aria-expanded={moreOpen}
                                    data-testid="signature-on-complete-toggle"
                                >
                                    {__('Cuando firmen todos…')}
                                    {moreOpen ? <ChevronUp className="imcrm-h-4 imcrm-w-4" /> : <ChevronDown className="imcrm-h-4 imcrm-w-4" />}
                                </button>
                                {moreOpen && (
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-p-3">
                                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                            {__('Siempre: a todas las personas les llega el PDF firmado, con la constancia de las firmas al final, y queda en esta ficha.')}
                                        </p>
                                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                            <Label htmlFor="sig-save">{__('Guardar el PDF firmado en')}</Label>
                                            <Select id="sig-save" value={saveField} onChange={(e) => setSaveField(e.target.value)} disabled={fileFields.length === 0} data-testid="signature-save-field">
                                                <option value="">{fileFields.length === 0 ? __('(la lista no tiene campos Archivo)') : __('No guardarlo en un campo')}</option>
                                                {fileFields.map((f) => (
                                                    <option key={f.id} value={f.id}>
                                                        {f.label}
                                                    </option>
                                                ))}
                                            </Select>
                                        </div>
                                        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                                <Label htmlFor="sig-status">{__('Cambiar el campo')}</Label>
                                                <Select
                                                    id="sig-status"
                                                    value={statusField}
                                                    onChange={(e) => {
                                                        setStatusField(e.target.value);
                                                        setStatusValue('');
                                                    }}
                                                    disabled={selectFields.length === 0}
                                                    data-testid="signature-status-field"
                                                >
                                                    <option value="">{__('No cambiar nada')}</option>
                                                    {selectFields.map((f) => (
                                                        <option key={f.id} value={f.id}>
                                                            {f.label}
                                                        </option>
                                                    ))}
                                                </Select>
                                            </div>
                                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                                <Label htmlFor="sig-status-value">{__('a')}</Label>
                                                <Select id="sig-status-value" value={statusValue} onChange={(e) => setStatusValue(e.target.value)} disabled={!statusField} data-testid="signature-status-value">
                                                    <option value="">{__('Elige la opción')}</option>
                                                    {statusOptions.map((o) => (
                                                        <option key={o.value} value={o.value}>
                                                            {o.label}
                                                        </option>
                                                    ))}
                                                </Select>
                                            </div>
                                        </div>
                                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                            <Label htmlFor="sig-date">{__('Poner la fecha de la firma en')}</Label>
                                            <Select id="sig-date" value={dateField} onChange={(e) => setDateField(e.target.value)} disabled={dateFields.length === 0}>
                                                <option value="">{dateFields.length === 0 ? __('(la lista no tiene campos de fecha)') : __('No poner la fecha')}</option>
                                                {dateFields.map((f) => (
                                                    <option key={f.id} value={f.id}>
                                                        {f.label}
                                                    </option>
                                                ))}
                                            </Select>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Es una firma electrónica simple (Ley 527 de 1999 y Decreto 2364 de 2012): sirve para contratos, cotizaciones, autorizaciones y actas. No es una firma digital con certificado.')}
                            </p>
                            {error && (
                                <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert" data-testid="signature-error">
                                    {error}
                                </p>
                            )}
                        </div>
                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-p-4">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {__('Cancelar')}
                            </Button>
                            <Button type="submit" disabled={create.isPending || nothing || sources.isLoading} className="imcrm-gap-2" data-testid="signature-submit">
                                {create.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                {sendEmail ? __('Enviar para firmar') : __('Crear los enlaces')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

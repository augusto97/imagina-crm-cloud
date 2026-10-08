import { lazy, Suspense, useContext, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Loader2, Paintbrush, PenLine, Send } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import {
    emailBodyMode,
    emailDesignSchema,
    emailTemplateDesign,
    renderEmailHtml,
    type EmailBodyMode,
    type EmailDesign,
    type EmailTestResult,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserPicker } from '@/components/ui/user-picker';
import { ViewSwitch } from '@/components/ui/view-switch';
import { useSession } from '@/cloud/session';
import { useBrandingData } from '@/hooks/useBranding';
import { useEmailSignature } from '@/hooks/useEmailSignature';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { sanitizeHtml } from '@/lib/sanitize';
import type { FieldEntity } from '@/types/field';
import type { ActionSpec } from '@/types/automation';

import { AutomationEditorListContext } from '../config-editors';
import { EmailPdfAttachments } from '../../documents/GeneratePdfConfig';
import { MergeTagInput } from '../MergeTagInput';
import { EmailThumbnail } from './EmailPreviewFrame';

const EmailDesigner = lazy(() => import('./EmailDesigner'));

/**
 * v0.1.265 — La acción «Enviar email» (ADR-S34): destinatario y asunto, el
 * CONTENIDO en tres formas —diseño visual por bloques (recomendado), texto
 * simple o HTML propio—, la FIRMA como opción explícita (antes era un botón
 * que pegaba HTML dentro del cuerpo, invisible para quien no lo buscaba) y
 * «Enviarme una prueba» a la casilla de quien edita.
 */
export function SendEmailConfig({
    spec,
    onChange,
    fields,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    fields: FieldEntity[];
}): JSX.Element {
    const cfg = spec.config as Record<string, unknown>;
    const str = (k: string): string => (typeof cfg[k] === 'string' ? (cfg[k] as string) : '');
    const mode = emailBodyMode(cfg);
    const listId = useContext(AutomationEditorListContext);
    const me = useSession((s) => s.user);
    const branding = useBrandingData();
    const accent = branding.data?.primary_color ?? null;
    const mySignature = useEmailSignature();
    const [designerOpen, setDesignerOpen] = useState(false);

    const set = (patch: Record<string, unknown>): void => {
        onChange({ ...spec, config: { ...cfg, ...patch } });
    };

    const design = useMemo<EmailDesign | null>(() => {
        const parsed = emailDesignSchema.safeParse(cfg.design);
        return parsed.success ? parsed.data : null;
    }, [cfg.design]);

    const includeSignature = Boolean(cfg.include_signature);
    const signatureUserId = Number(cfg.signature_user_id) || null;
    const signatureIsMine = signatureUserId !== null && signatureUserId === me?.id;
    const signatureHtml = includeSignature && signatureIsMine ? (mySignature.data ?? '') || null : null;
    const signatureHint = !includeSignature
        ? __('La firma está apagada. Activala en «Firma» (debajo del contenido) para que aparezca acá.')
        : signatureIsMine
          ? signatureHtml
              ? __('Acá va tu firma. Cambiala en Ajustes → Firma de email.')
              : __('Todavía no cargaste tu firma: hacelo en Ajustes → Firma de email.')
          : __('Acá va la firma de la persona elegida en «Firma». Para verla, usá «Ver con datos de un registro».');

    const setMode = (next: EmailBodyMode): void => {
        if (next === mode) return;
        const patch: Record<string, unknown> = { body_mode: next, is_html: next === 'html' };
        if (next === 'design' && !design) {
            setDesignerOpen(true);
        }
        set(patch);
    };

    const thumbHtml = useMemo(
        () =>
            design
                ? renderEmailHtml(design, {
                      resolve: (t) => t,
                      preview: true,
                      fieldLabel: (slug) => fields.find((f) => f.slug === slug)?.label ?? null,
                      signatureHtml,
                      appendSignature: Boolean(signatureHtml),
                  })
                : '',
        [design, fields, signatureHtml],
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Para (acepta variables y varios correos separados por coma)')}
                </Label>
                <MergeTagInput placeholder="{{email}} o user@example.com" value={str('to')} onChange={(v) => set({ to: v })} fields={fields} />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label className="imcrm-text-xs imcrm-text-muted-foreground">{__('Asunto')}</Label>
                <MergeTagInput placeholder={__('Hola {{nombre}}')} value={str('subject')} onChange={(v) => set({ subject: v })} fields={fields} />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-testid="email-content">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <span className="imcrm-text-xs imcrm-font-semibold">{__('Contenido')}</span>
                    <ViewSwitch<EmailBodyMode>
                        label={__('Formato del correo')}
                        value={mode}
                        testId="email-mode"
                        options={[
                            { value: 'design', label: __('Diseño visual') },
                            { value: 'text', label: __('Texto') },
                            { value: 'html', label: __('HTML') },
                        ]}
                        onChange={setMode}
                    />
                </div>

                {mode === 'design' && (
                    <>
                        {design ? (
                            <button
                                type="button"
                                onClick={() => setDesignerOpen(true)}
                                className="imcrm-group imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-p-1 imcrm-text-left hover:imcrm-bg-accent/50"
                                data-testid="email-design-thumb"
                            >
                                <EmailThumbnail html={thumbHtml} width={150} height={112} />
                                <span className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                    <span className="imcrm-text-xs imcrm-font-medium">
                                        {design.blocks.length} {design.blocks.length === 1 ? __('bloque') : __('bloques')}
                                    </span>
                                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-primary">
                                        <Paintbrush className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Editar diseño')}
                                    </span>
                                </span>
                            </button>
                        ) : (
                            <Button type="button" variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-self-start" onClick={() => setDesignerOpen(true)}>
                                <Paintbrush className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Diseñar el correo')}
                            </Button>
                        )}
                        <MergeTagInput
                            placeholder={__('Texto de vista previa (lo que se lee junto al asunto en la bandeja)')}
                            value={str('preheader')}
                            onChange={(v) => set({ preheader: v })}
                            fields={fields}
                        />
                    </>
                )}
                {mode === 'text' && (
                    <MergeTagInput
                        rows={5}
                        autoGrow
                        placeholder={__('Tu mensaje. Usá los botones de abajo para insertar variables.')}
                        value={str('body')}
                        onChange={(v) => set({ body: v })}
                        fields={fields}
                    />
                )}
                {mode === 'html' && (
                    <>
                        <MergeTagInput
                            rows={8}
                            autoGrow
                            placeholder="<p style=&quot;margin:0&quot;>Hola {{nombre}}</p>"
                            value={str('body')}
                            onChange={(v) => set({ body: v })}
                            fields={fields}
                        />
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('Para Outlook y Gmail usá tablas y estilos en línea (style="…"). Con «Diseño visual» eso se hace solo.')}
                        </p>
                    </>
                )}
            </div>

            <SignatureSection
                include={includeSignature}
                userId={signatureUserId}
                meId={me?.id ?? null}
                mySignature={mySignature.data ?? ''}
                mode={mode}
                onChange={(patch) => set(patch)}
            />

            <EmailPdfAttachments
                value={Array.isArray(cfg.pdf_templates) ? (cfg.pdf_templates as unknown[]).map(Number).filter((n) => n > 0) : []}
                onChange={(ids) => set({ pdf_templates: ids })}
                fields={fields}
            />

            <TestEmail config={cfg} listId={listId} myEmail={me?.email ?? ''} />

            <details className="imcrm-group imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-px-3 imcrm-py-2 [&[open]]:imcrm-bg-card [&[open]]:imcrm-shadow-imcrm-sm">
                <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-gap-2 imcrm-text-[12px] imcrm-font-medium imcrm-text-foreground/80 [&::-webkit-details-marker]:imcrm-hidden">
                    <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground imcrm-transition-transform imcrm-duration-150 group-open:imcrm-rotate-90" />
                    <span>{__('Avanzado: remitente, Cc, Cco')}</span>
                </summary>
                <div className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <div className="imcrm-flex imcrm-gap-2">
                        <Input placeholder={__('Nombre remitente')} value={str('from_name')} onChange={(e) => set({ from_name: e.target.value })} className="imcrm-flex-1" />
                        <Input placeholder="noreply@example.com" value={str('from_email')} onChange={(e) => set({ from_email: e.target.value })} className="imcrm-flex-1" />
                    </div>
                    <MergeTagInput placeholder={__('Cc (separados por coma)')} value={str('cc')} onChange={(v) => set({ cc: v })} fields={fields} />
                    <MergeTagInput placeholder={__('Cco (separados por coma)')} value={str('bcc')} onChange={(v) => set({ bcc: v })} fields={fields} />
                </div>
            </details>

            {designerOpen && (
                <Suspense fallback={null}>
                    <EmailDesigner
                        open={designerOpen}
                        onOpenChange={setDesignerOpen}
                        value={design ?? emailTemplateDesign('blank', accent)}
                        startWithTemplates={!design}
                        onApply={(d) => set({ body_mode: 'design', is_html: false, design: d })}
                        fields={fields}
                        actionConfig={cfg}
                        listId={listId}
                        subject={str('subject')}
                        preheader={str('preheader')}
                        signatureHtml={signatureHtml}
                        signatureHint={signatureHint}
                        brandAccent={accent}
                    />
                </Suspense>
            )}
        </div>
    );
}

function SignatureSection({
    include,
    userId,
    meId,
    mySignature,
    mode,
    onChange,
}: {
    include: boolean;
    userId: number | null;
    meId: number | null;
    mySignature: string;
    mode: EmailBodyMode;
    onChange: (patch: Record<string, unknown>) => void;
}): JSX.Element {
    const isMine = userId !== null && userId === meId;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3" data-testid="email-signature">
            <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2">
                <input
                    type="checkbox"
                    className="imcrm-mt-0.5"
                    checked={include}
                    onChange={(e) =>
                        onChange({
                            include_signature: e.target.checked,
                            ...(e.target.checked && userId === null && meId !== null ? { signature_user_id: meId } : {}),
                        })
                    }
                />
                <span className="imcrm-flex imcrm-flex-col">
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold">
                        <PenLine className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar la firma al final del correo')}
                    </span>
                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {mode === 'design'
                            ? __('Va al final, o donde pongas el bloque «Firma» en el diseño.')
                            : mode === 'text'
                              ? __('En un correo de texto la firma va sin formato (sin imágenes ni colores).')
                              : __('Se agrega debajo de tu HTML.')}
                    </span>
                </span>
            </label>
            {include && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-pl-6">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Firma de')}</Label>
                        <UserPicker value={userId} onChange={(id) => onChange({ signature_user_id: id })} showAssignMe placeholder={__('Elegí a alguien del equipo')} />
                    </div>
                    {isMine &&
                        (mySignature.trim() ? (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-white imcrm-p-2.5 imcrm-text-[13px] imcrm-text-neutral-800">
                                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(mySignature) }} />
                            </div>
                        ) : (
                            <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-300">
                                {__('Todavía no cargaste tu firma: el correo saldría sin firma.')}
                            </p>
                        ))}
                    <Link to="/settings?s=firma" target="_blank" className="imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline">
                        {isMine ? __('Editar mi firma') : __('Cada persona edita su firma en Ajustes → Firma de email')}
                    </Link>
                </div>
            )}
        </div>
    );
}

function TestEmail({ config, listId, myEmail }: { config: Record<string, unknown>; listId: number | undefined; myEmail: string }): JSX.Element {
    const [result, setResult] = useState<EmailTestResult | null>(null);
    const run = useMutation({
        mutationFn: async (): Promise<EmailTestResult> => {
            const res = await api.post<EmailTestResult>(`/lists/${listId ?? 0}/automations/test-email`, { config, send: true });
            return res.data;
        },
        onSuccess: setResult,
        onError: (err: unknown) =>
            setResult({
                subject: '',
                html: null,
                text: null,
                sample_record_id: null,
                sent_to: null,
                error: err instanceof Error ? err.message : String(err),
                signature_note: null,
            }),
    });
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Button type="button" variant="outline" size="sm" className="imcrm-gap-1.5 imcrm-self-start" disabled={run.isPending} onClick={() => run.mutate()} data-testid="email-send-test">
                {run.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Send className="imcrm-h-3.5 imcrm-w-3.5" />}
                {__('Enviarme una prueba')}
            </Button>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Llega a')} {myEmail || __('tu correo')} {__('con los datos del último registro de la lista. Abrila en Gmail y en Outlook para ver cómo queda.')}
            </p>
            {result && (
                <p
                    role="status"
                    className={
                        result.error
                            ? 'imcrm-rounded-md imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-xs imcrm-text-destructive'
                            : 'imcrm-rounded-md imcrm-bg-emerald-500/10 imcrm-p-2 imcrm-text-xs imcrm-text-emerald-800 dark:imcrm-text-emerald-300'
                    }
                >
                    {result.error
                        ? result.error
                        : `${__('Prueba enviada a')} ${result.sent_to}${result.sample_record_id ? ` (${__('registro')} #${result.sample_record_id})` : ''}.${result.attachments && result.attachments.length > 0 ? ` ${__('Adjuntos')}: ${result.attachments.map((a) => `${a.filename} (${Math.max(1, Math.round(a.bytes / 1024))} KB)`).join(', ')}.` : ''}${result.signature_note ? ` ${result.signature_note}` : ''}`}
                </p>
            )}
        </div>
    );
}

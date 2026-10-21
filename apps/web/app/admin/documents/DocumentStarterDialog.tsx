import { forwardRef, useEffect, useMemo, useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowLeft, Calculator, FileSpreadsheet, FileText, Receipt, ReceiptText, X } from 'lucide-react';
import {
    DEFAULT_IVA_RATE,
    DOCUMENT_STARTERS,
    buildDocumentStarter,
    emptyIssuer,
    type DocDesign,
    type DocumentIssuer,
    type DocumentStarter,
    type TemplateRoleField,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/cloud/session';
import { useBrandingData } from '@/hooks/useBranding';
import { useFields } from '@/hooks/useFields';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import { fieldPrecision } from '@/lib/fieldNumberFormat';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { fieldFitsRole, suggestRoleMapping } from '../templates/roleMapping';

/**
 * v0.1.266 — Galería de plantillas de documentos (ADR-S35). Una plantilla no
 * conoce los campos de la lista: habla de ROLES ("el nombre del cliente", "el
 * valor a cobrar"). Aquí se elige qué campo cumple cada uno (con sugerencia
 * automática por nombre y tipo, como en las plantillas de tableros) y se
 * cargan una vez los datos de quien cobra.
 */

// Diálogo centrado (mismo estilo que el resto de los diálogos de la app).
function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }): JSX.Element {
    return (
        <RDialog.Root open={open} onOpenChange={onOpenChange}>
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                {children}
            </RDialog.Portal>
        </RDialog.Root>
    );
}
// forwardRef: el portal de Radix le pasa una ref al hijo (sin esto React avisa en cada apertura).
const DialogContent = forwardRef<HTMLDivElement, { className?: string; children: React.ReactNode; 'data-testid'?: string }>(function DialogContent(
    { className, children, ...rest },
    ref,
) {
    return (
        <RDialog.Content
            ref={ref}
            {...rest}
            className={cn(
                'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-w-[calc(100%-1.5rem)] imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-gap-4 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg',
                className,
            )}
        >
            <RDialog.Close asChild>
                <button type="button" aria-label={__('Cerrar')} className="imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                    <X className="imcrm-h-4 imcrm-w-4" />
                </button>
            </RDialog.Close>
            {children}
        </RDialog.Content>
    );
});
const DialogHeader = ({ children }: { children: React.ReactNode }): JSX.Element => <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-pr-8">{children}</div>;
const DialogTitle = ({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element => (
    <RDialog.Title className={cn('imcrm-text-base imcrm-font-semibold', className)}>{children}</RDialog.Title>
);
const DialogDescription = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <RDialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">{children}</RDialog.Description>
);
const DialogFooter = ({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element => (
    <div className={cn('imcrm-flex imcrm-flex-wrap imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3', className)}>{children}</div>
);

const ICONS: Record<string, typeof FileText> = {
    cuenta_cobro: Receipt,
    cuenta_cobro_detalle: FileSpreadsheet,
    cotizacion: Calculator,
    factura: ReceiptText,
    blank: FileText,
};

const ISSUER_KEY = 'imcrm:doc-issuer';

function loadIssuer(fallbackName: string): DocumentIssuer {
    try {
        const raw = window.localStorage.getItem(ISSUER_KEY);
        if (raw) return { ...emptyIssuer(fallbackName), ...(JSON.parse(raw) as Partial<DocumentIssuer>) };
    } catch {
        /* sin storage */
    }
    return emptyIssuer(fallbackName);
}

export function DocumentStarterDialog({
    open,
    onOpenChange,
    listId,
    fields,
    onCreate,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    listId: number;
    fields: FieldEntity[];
    onCreate: (tpl: { name: string; filename: string; design: DocDesign }) => void;
}): JSX.Element {
    const [starter, setStarter] = useState<DocumentStarter | null>(null);
    useEffect(() => {
        if (!open) setStarter(null);
    }, [open]);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="imcrm-max-h-[92vh] imcrm-max-w-3xl imcrm-overflow-y-auto" data-testid="doc-starter">
                {starter === null ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>{__('Nueva plantilla de documento')}</DialogTitle>
                            <DialogDescription>
                                {__('Elige un punto de partida. Después cambias todo en el editor: textos, colores, bloques.')}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                            {DOCUMENT_STARTERS.map((s) => {
                                const Icon = ICONS[s.key] ?? FileText;
                                return (
                                    <button
                                        key={s.key}
                                        type="button"
                                        data-starter={s.key}
                                        onClick={() => (s.key === 'blank' ? onCreate(buildDocumentStarter('blank')) : setStarter(s))}
                                        className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-text-left hover:imcrm-border-primary/60 hover:imcrm-shadow-imcrm-md"
                                    >
                                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                                            <Icon className="imcrm-h-5 imcrm-w-5" />
                                        </span>
                                        <span className="imcrm-text-sm imcrm-font-semibold">{__(s.name)}</span>
                                        <span className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{__(s.description)}</span>
                                        {s.notice && (
                                            <span className="imcrm-flex imcrm-items-start imcrm-gap-1 imcrm-text-[11px] imcrm-font-medium imcrm-leading-snug imcrm-text-amber-700 dark:imcrm-text-amber-300" data-starter-notice>
                                                <AlertTriangle className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                                                {__('No es factura electrónica DIAN')}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('Los documentos son cuentas de cobro, recibos o cotizaciones. No reemplazan la factura electrónica de la DIAN.')}
                        </p>
                    </>
                ) : (
                    <StarterForm starter={starter} listId={listId} fields={fields} onBack={() => setStarter(null)} onCreate={onCreate} />
                )}
            </DialogContent>
        </Dialog>
    );
}

function StarterForm({
    starter,
    listId,
    fields,
    onBack,
    onCreate,
}: {
    starter: DocumentStarter;
    listId: number;
    fields: FieldEntity[];
    onBack: () => void;
    onCreate: (tpl: { name: string; filename: string; design: DocDesign }) => void;
}): JSX.Element {
    const branding = useBrandingData();
    const tenantName = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.tenant_name ?? '');
    const [mapping, setMapping] = useState<Record<string, string>>(() => slugMapping(starter.roles, fields));
    const [issuer, setIssuer] = useState<DocumentIssuer>(() => loadIssuer(branding.data?.app_name || tenantName));
    const paths = useRelationPaths(starter.item_roles.length > 0 ? listId : undefined);
    const [pathKey, setPathKey] = useState('');
    const path = (paths.data ?? []).find((p) => `${p.relation_field_id}:${p.direction}` === pathKey) ?? null;
    const itemFields = useFields(path?.other_list_id);
    const [itemMapping, setItemMapping] = useState<Record<string, string>>({});
    // v0.1.292 — IVA, descuento global fijo, validez y congelar (cotización / factura).
    const [ivaOn, setIvaOn] = useState(true);
    const [ivaRate, setIvaRate] = useState(DEFAULT_IVA_RATE);
    const [globalPct, setGlobalPct] = useState(0);
    const [validityDays, setValidityDays] = useState(30);
    const [freeze, setFreeze] = useState(starter.freeze_default ?? false);

    // La primera relación disponible queda elegida; y los campos de los
    // ítems se sugieren apenas se conocen.
    useEffect(() => {
        if (pathKey === '' && paths.data && paths.data.length > 0) {
            const first = paths.data[0]!;
            setPathKey(`${first.relation_field_id}:${first.direction}`);
        }
    }, [paths.data, pathKey]);
    useEffect(() => {
        if (itemFields.data) setItemMapping(slugMapping(starter.item_roles, itemFields.data));
    }, [itemFields.data, starter.item_roles]);

    const missing = starter.roles.filter((r) => r.required && !mapping[r.key]);
    const missingItems = starter.item_roles.length > 0 && (!path || starter.item_roles.some((r) => r.required && !itemMapping[r.key]));

    const create = (): void => {
        try {
            window.localStorage.setItem(ISSUER_KEY, JSON.stringify(issuer));
        } catch {
            /* sin storage */
        }
        // Los decimales de la moneda: los del campo del precio unitario.
        const priceField = (itemFields.data ?? []).find((f) => f.slug === itemMapping.precio);
        onCreate(
            buildDocumentStarter(starter.key, {
                accent: branding.data?.primary_color ?? null,
                fields: mapping,
                items: path
                    ? { source: { relation_field_id: path.relation_field_id, direction: path.direction, list_id: path.other_list_id }, fields: itemMapping }
                    : null,
                issuer,
                ...(starter.taxes
                    ? {
                          tax: { iva: ivaOn, rate: ivaRate },
                          global_discount_pct: globalPct,
                          money_decimals: priceField ? fieldPrecision(priceField) : 0,
                          freeze,
                          validity_days: validityDays,
                      }
                    : {}),
            }),
        );
    };

    const set = (k: keyof DocumentIssuer, v: string): void => setIssuer((i) => ({ ...i, [k]: v }));

    return (
        <>
            <DialogHeader>
                <DialogTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <button type="button" onClick={onBack} aria-label={__('Volver')} className="imcrm-rounded imcrm-p-1 hover:imcrm-bg-accent">
                        <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                    </button>
                    {__(starter.name)}
                </DialogTitle>
                <DialogDescription>{__('Elige qué campo de la lista va en cada lugar y carga tus datos. Lo que no elijas queda marcado entre corchetes para completarlo en el editor.')}</DialogDescription>
            </DialogHeader>
            {starter.notice && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-amber-300 imcrm-bg-amber-50 imcrm-p-2.5 imcrm-text-xs imcrm-leading-relaxed imcrm-text-amber-900 dark:imcrm-border-amber-700/60 dark:imcrm-bg-amber-950/40 dark:imcrm-text-amber-200" data-starter-form-notice>
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    {__(starter.notice)}
                </p>
            )}

            <div className="imcrm-grid imcrm-gap-5 md:imcrm-grid-cols-2">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <h4 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Datos de esta lista')}</h4>
                    {starter.roles.map((role) => (
                        <RoleSelect key={role.key} role={role} fields={fields} value={mapping[role.key] ?? ''} onChange={(v) => setMapping((m) => ({ ...m, [role.key]: v }))} />
                    ))}
                    {starter.item_roles.length > 0 && (
                        <>
                            <h4 className="imcrm-mt-2 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Ítems del detalle')}</h4>
                            <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-xs">
                                <span className="imcrm-font-medium">{__('Las líneas salen de')}</span>
                                <Select value={pathKey} onChange={(e) => setPathKey(e.target.value)} aria-label={__('Lista de los ítems')}>
                                    <option value="">{__('Elige la lista vinculada…')}</option>
                                    {(paths.data ?? []).map((p) => (
                                        <option key={`${p.relation_field_id}:${p.direction}`} value={`${p.relation_field_id}:${p.direction}`}>
                                            {p.other_list_name} ({__('por')} «{p.relation_label}»)
                                        </option>
                                    ))}
                                </Select>
                                {paths.data && paths.data.length === 0 && (
                                    <span className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-300">
                                        {__('Esta lista no está vinculada con otra. Usa la cuenta de cobro simple, o crea un campo «Relación» hacia la lista de los ítems.')}
                                    </span>
                                )}
                            </label>
                            {path &&
                                starter.item_roles.map((role) => (
                                    <RoleSelect
                                        key={role.key}
                                        role={role}
                                        fields={itemFields.data ?? []}
                                        value={itemMapping[role.key] ?? ''}
                                        onChange={(v) => setItemMapping((m) => ({ ...m, [role.key]: v }))}
                                    />
                                ))}
                        </>
                    )}
                </div>

                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5">
                    <h4 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Quién cobra')}</h4>
                    <Input value={issuer.name} onChange={(e) => set('name', e.target.value)} placeholder={__('Tu nombre o el de tu empresa')} aria-label={__('Nombre')} />
                    <div className="imcrm-flex imcrm-gap-2">
                        <Select value={issuer.doc_label} onChange={(e) => set('doc_label', e.target.value)} className="imcrm-w-24" aria-label={__('Tipo de documento')}>
                            <option value="C.C.">C.C.</option>
                            <option value="NIT">NIT</option>
                            <option value="C.E.">C.E.</option>
                            <option value="RUT">RUT</option>
                        </Select>
                        <Input value={issuer.doc_number} onChange={(e) => set('doc_number', e.target.value)} placeholder="1.020.304.050" aria-label={__('Número de documento')} />
                    </div>
                    <div className="imcrm-flex imcrm-gap-2">
                        <Input value={issuer.phone} onChange={(e) => set('phone', e.target.value)} placeholder={__('Teléfono')} aria-label={__('Teléfono')} />
                        <Input value={issuer.email} onChange={(e) => set('email', e.target.value)} placeholder={__('Correo')} aria-label={__('Correo')} />
                    </div>
                    <div className="imcrm-flex imcrm-gap-2">
                        <Input value={issuer.address} onChange={(e) => set('address', e.target.value)} placeholder={__('Dirección')} aria-label={__('Dirección')} />
                        <Input value={issuer.city} onChange={(e) => set('city', e.target.value)} placeholder={__('Ciudad')} className="imcrm-w-36" aria-label={__('Ciudad')} />
                    </div>
                    <h4 className="imcrm-mt-1 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Dónde te pagan (opcional)')}</h4>
                    <div className="imcrm-flex imcrm-gap-2">
                        <Input value={issuer.bank} onChange={(e) => set('bank', e.target.value)} placeholder={__('Banco')} aria-label={__('Banco')} />
                        <Select value={issuer.account_type} onChange={(e) => set('account_type', e.target.value)} className="imcrm-w-32" aria-label={__('Tipo de cuenta')}>
                            <option value="ahorros">{__('Ahorros')}</option>
                            <option value="corriente">{__('Corriente')}</option>
                        </Select>
                    </div>
                    <Input value={issuer.account_number} onChange={(e) => set('account_number', e.target.value)} placeholder={__('Número de cuenta')} aria-label={__('Número de cuenta')} />
                    <Input value={issuer.account_holder} onChange={(e) => set('account_holder', e.target.value)} placeholder={__('Titular (si es otro)')} aria-label={__('Titular')} />
                    {starter.taxes && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2.5" data-starter-taxes>
                            <h4 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Impuestos y descuentos')}</h4>
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                <input type="checkbox" checked={ivaOn} onChange={(e) => setIvaOn(e.target.checked)} data-starter-iva />
                                <span className="imcrm-flex-1">{__('Cobro IVA')}</span>
                                {ivaOn && (
                                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                        <Input
                                            type="number"
                                            min={0}
                                            max={100}
                                            step="0.01"
                                            value={ivaRate}
                                            onChange={(e) => setIvaRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                                            className="imcrm-h-7 imcrm-w-20 imcrm-text-xs"
                                            aria-label={__('Tarifa de IVA')}
                                        />
                                        %
                                    </span>
                                )}
                            </label>
                            {!ivaOn && (
                                <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {__('No responsable de IVA: el documento no lleva IVA y sale con la nota tributaria de abajo.')}
                                </span>
                            )}
                            {!mapping.descuento_global && (
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                    <span className="imcrm-flex-1">{__('Descuento global fijo (opcional)')}</span>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step="0.01"
                                        value={globalPct}
                                        onChange={(e) => setGlobalPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                                        className="imcrm-h-7 imcrm-w-20 imcrm-text-xs"
                                        aria-label={__('Descuento global')}
                                    />
                                    %
                                </label>
                            )}
                            {starter.key === 'cotizacion' && !mapping.validez && (
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                    <span className="imcrm-flex-1">{__('Válida por (días, sin campo de vencimiento)')}</span>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={validityDays}
                                        onChange={(e) => setValidityDays(Math.max(1, Math.min(365, Math.floor(Number(e.target.value) || 30))))}
                                        className="imcrm-h-7 imcrm-w-20 imcrm-text-xs"
                                        aria-label={__('Días de validez')}
                                    />
                                </label>
                            )}
                            <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                                <input type="checkbox" checked={freeze} onChange={(e) => setFreeze(e.target.checked)} className="imcrm-mt-0.5" data-starter-freeze />
                                <span>
                                    <span className="imcrm-font-medium">{__('Congelar el documento al emitirlo')}</span>
                                    <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                                        {__('Con su número se guarda el PDF y se entrega siempre ese, aunque cambien los datos.')}
                                    </span>
                                </span>
                            </label>
                        </div>
                    )}
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-xs">
                        <span className="imcrm-font-medium">{__('Nota tributaria al pie')}</span>
                        <Textarea rows={3} value={issuer.tax_note} onChange={(e) => set('tax_note', e.target.value)} className="imcrm-text-xs" />
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Ajústala a tu régimen: es la declaración que suelen pedir las empresas para pagar una cuenta de cobro.')}</span>
                    </label>
                </div>
            </div>

            <DialogFooter className="imcrm-items-center">
                {(missing.length > 0 || missingItems) && (
                    <span className="imcrm-mr-auto imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-300">
                        {__('Faltan algunos datos: van a quedar marcados entre corchetes.')}
                    </span>
                )}
                <Button variant="ghost" onClick={onBack}>
                    {__('Volver')}
                </Button>
                <Button onClick={create} data-testid="doc-starter-create">
                    {__('Crear y abrir el editor')}
                </Button>
            </DialogFooter>
        </>
    );
}

function RoleSelect({
    role,
    fields,
    value,
    onChange,
}: {
    role: TemplateRoleField;
    fields: FieldEntity[];
    value: string;
    onChange: (slug: string) => void;
}): JSX.Element {
    const options = useMemo(() => fields.filter((f) => fieldFitsRole(f, role)), [fields, role]);
    return (
        <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-xs" data-role={role.key}>
            <span className={cn('imcrm-font-medium', role.required && !value && 'imcrm-text-amber-700 dark:imcrm-text-amber-300')}>
                {__(role.label)}
                {!role.required && <span className="imcrm-font-normal imcrm-text-muted-foreground"> · {__('opcional')}</span>}
            </span>
            <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={__(role.label)}>
                <option value="">{role.required ? __('Elige un campo…') : __('— Sin usar —')}</option>
                {options.map((f) => (
                    <option key={f.id} value={f.slug}>
                        {f.label}
                    </option>
                ))}
            </Select>
        </label>
    );
}

const norm = (s: string): string =>
    s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ');

/** ¿El nombre del campo se parece al del rol? ("Valor" ↔ valor, "NIT" ↔ cliente_doc). */
function looksLike(role: TemplateRoleField, f: FieldEntity): boolean {
    const name = `${norm(f.label)} ${norm(f.slug)}`;
    const words = [...norm(role.key).split(' '), ...norm(role.label).split(' ')].filter((w) => w.length > 3);
    const extra: Record<string, string[]> = {
        cliente_doc: ['nit', 'cedula', 'documento', 'rut'],
        numero: ['numero', 'consecutivo', 'factura'],
        // v0.1.292 — cotización y factura.
        precio: ['precio', 'unitario', 'tarifa'],
        cantidad: ['cantidad', 'cant', 'unidades', 'qty'],
        descuento: ['descuento', 'dto', 'desc'],
        descuento_global: ['descuento', 'dto'],
        direccion: ['direccion', 'domicilio'],
        correo: ['correo', 'email', 'mail'],
        validez: ['validez', 'vence', 'vencimiento', 'valida', 'hasta'],
        condiciones: ['condiciones', 'terminos'],
        forma_pago: ['forma', 'metodo', 'medio'],
        fecha_pago: ['pago', 'limite', 'vence'],
    };
    return words.some((w) => name.includes(w)) || (extra[role.key] ?? []).some((w) => name.includes(w));
}

/**
 * Sugerencia rol → slug (por nombre y tipo). Los roles OPCIONALES sólo se
 * sugieren si el nombre del campo se parece: con sólo coincidir el tipo, la
 * «fecha límite» terminaba en cualquier fecha de la lista.
 */
function slugMapping(roles: TemplateRoleField[], fields: FieldEntity[]): Record<string, string> {
    const byId = suggestRoleMapping(roles, fields);
    const out: Record<string, string> = {};
    for (const [k, id] of Object.entries(byId)) {
        const f = fields.find((x) => x.id === id);
        const role = roles.find((r) => r.key === k);
        if (f && role && (role.required || looksLike(role, f))) out[k] = f.slug;
    }
    return out;
}

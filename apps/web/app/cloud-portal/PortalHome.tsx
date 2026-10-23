import { useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isDataField, jsonbKeyForField, type Field, type PortalBoot } from '@imagina-base/shared';
import { PAGE_FONT_STACKS, readPageSettings } from '@/lib/blockStyle';
import { formatValue } from '@/cloud/lib/fieldValue';
import { PortalAccountMenu } from '@/cloud-portal/PortalAccountMenu';
import { PortalCreateRecords } from '@/cloud-portal/PortalCreateRecords';
import { PortalDocuments } from '@/cloud-portal/PortalDocuments';
import { PortalLayout } from '@/cloud-portal/PortalLayout';
import { setTenantFormat } from '@/lib/tenantFormat';
import { PortalBrandSetterContext } from '@/cloud-portal/portalBrand';

/**
 * El portal YA con sesión: cabecera con la marca, el diseño (motor de la
 * ficha + gráficos) y los documentos. Vive en su propio chunk: las pantallas
 * de entrar («Validando tu acceso», pedir un enlace) no bajan el motor de la
 * ficha ni los gráficos (~300 KB).
 */
export default function PortalHome(props: {
    boot: PortalBoot;
    onSelectAccount: (id: number) => void;
    onLogout: () => void;
}): JSX.Element {
    return <PortalContent {...props} />;
}

function PortalContent({
    boot,
    onSelectAccount,
    onLogout,
}: {
    boot: PortalBoot;
    onSelectAccount: (id: number) => void;
    onLogout: () => void;
}): JSX.Element {
    const dataFields = boot.fields.filter((f) => isDataField(f.type));
    // Cuentas y primera página de la conversación llegan en /portal/me (regla
    // de oro nº 8): se siembran en el cache antes de montar a quien las lee.
    const qc = useQueryClient();
    useState(() => {
        if (boot.accounts) qc.setQueryData(['portal-accounts', boot.account_id ?? null], boot.accounts);
        if (boot.comments) qc.setQueryData(['portal-comments', boot.account_id ?? null], boot.comments);
        return null;
    });

    // White-label: el portal sale con la marca de la empresa (mismo mecanismo
    // que el admin — re-pintamos los tokens del tema con el color del tenant).
    // Defensivo ante un boot sin branding (respuesta cacheada de una versión previa).
    const branding = boot.branding ?? { primary_color: null, app_name: null, logo_url: null };
    // v0.1.104 — el cliente ve montos/fechas con el formato regional de la
    // empresa (misma capa que el admin; tolerante a boots viejos sin format).
    useEffect(() => {
        setTenantFormat(boot.format ?? null);
    }, [boot.format]);
    // White-label (v0.1.245): la marca de la cuenta que se mira (color, logo,
    // título y favicon) la pinta la raíz del portal — aquí sólo se avisa. El
    // nombre que se muestra es el que eligió la empresa o, si no eligió, el de
    // la empresa (antes caía al nombre de la LISTA, que es interno).
    const displayName = branding.app_name ?? (boot.tenant_name || null);
    const setBrand = useContext(PortalBrandSetterContext);
    useEffect(() => {
        setBrand({ name: displayName, logoUrl: branding.logo_url ?? null, primaryColor: branding.primary_color ?? null });
        return () => setBrand(null);
    }, [setBrand, displayName, branding.logo_url, branding.primary_color]);
    // v0.1.233 — el diseño v3 (guardado, convertido o automático) manda;
    // el servidor lo resuelve siempre. Sin diseño (respuesta de una versión
    // anterior durante un deploy) se cae a la lista simple de datos.
    const layout = boot.layout ?? null;

    // v0.1.94 — ajustes de página del portal diseñados en el editor:
    // fondo de página, ancho máximo del contenido y tipografía global.
    const page = readPageSettings(layout ? (layout as { page?: unknown }).page : undefined);
    const pageStyle: React.CSSProperties = {};
    if (page.bg !== undefined) pageStyle.backgroundColor = page.bg;
    if (page.font !== undefined) pageStyle.fontFamily = PAGE_FONT_STACKS[page.font];
    const contentStyle: React.CSSProperties =
        page.max_width !== undefined ? { maxWidth: `${page.max_width}px` } : layout ? { maxWidth: '1100px' } : {};

    return (
        <div className="imcrm-min-h-screen imcrm-bg-background imcrm-text-foreground" style={pageStyle}>
            <header className="imcrm-border-b imcrm-border-border imcrm-px-6 imcrm-py-4">
                <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-4xl imcrm-items-center imcrm-gap-3" style={contentStyle}>
                    {branding.logo_url && (
                        <img
                            src={branding.logo_url}
                            alt=""
                            className="imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-rounded-md imcrm-object-contain"
                        />
                    )}
                    <div>
                        {displayName && (
                            <p className="imcrm-text-xs imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                {displayName}
                            </p>
                        )}
                        <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">Tu portal</h1>
                    </div>
                    <PortalAccountMenu
                        accountId={boot.account_id ?? null}
                        onSelect={onSelectAccount}
                        onLogout={onLogout}
                        notifyEmail={boot.comments !== null ? boot.notify_email : null}
                        password={boot.password}
                        companyName={boot.branding?.app_name ?? boot.tenant_name ?? ''}
                        dataConsent={boot.data_consent ?? null}
                    />
                </div>
            </header>

            <main className="imcrm-mx-auto imcrm-max-w-4xl imcrm-space-y-4 imcrm-p-6" style={contentStyle}>
                {layout ? (
                    <PortalLayout boot={boot} layout={layout} />
                ) : (
                    // Sin template: fallback con los datos del record.
                    <section className="imcrm-space-y-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5">
                        <dl className="imcrm-space-y-3">
                            {dataFields.map((f) => (
                                <FieldRow key={f.id} field={f} value={boot.record.data[jsonbKeyForField(f.id)]} />
                            ))}
                        </dl>
                    </section>
                )}

                <PortalDocuments documents={boot.documents ?? []} />

                <PortalCreateRecords boot={boot} />

            </main>
        </div>
    );
}

function FieldRow({ field, value }: { field: Field; value: unknown }): JSX.Element {
    const text = formatValue(field, value);
    return (
        <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-3 imcrm-border-b imcrm-border-border/60 imcrm-pb-2 last:imcrm-border-0">
            <dt className="imcrm-text-sm imcrm-font-medium imcrm-text-muted-foreground">{field.label}</dt>
            <dd className="imcrm-col-span-2 imcrm-text-sm">
                {text === '' ? <span className="imcrm-text-muted-foreground">—</span> : text}
            </dd>
        </div>
    );
}




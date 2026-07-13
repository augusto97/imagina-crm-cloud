import { Resolver } from 'node:dns/promises';
import { Injectable } from '@nestjs/common';
import type { SmtpConfig } from '@imagina-base/shared';

/** Un registro DNS recomendado, con su estado verificado en vivo. */
export interface DnsRecordCheck {
    purpose: 'spf' | 'dkim' | 'dmarc';
    type: 'TXT' | 'CNAME';
    /** Host a crear (relativo al dominio, ej. `@`, `_dmarc`, `sel._domainkey`). */
    host: string;
    /** Valor exacto a copiar. Vacío en DKIM (la clave la genera el proveedor). */
    value: string;
    /** ok = ya está; missing = falta; partial = hay TXT pero no matchea. */
    status: 'ok' | 'missing' | 'partial' | 'unknown';
    /** Valor actual encontrado en el DNS (para diagnóstico). */
    current?: string;
    /** Guía humana (dónde obtener el valor cuando no lo podemos derivar). */
    note?: string;
}

export interface SmtpDnsReport {
    domain: string;
    provider: string;
    records: DnsRecordCheck[];
}

/**
 * Proveedores SMTP conocidos → include de SPF + selectores DKIM típicos +
 * guía. El match es por sufijo del host SMTP configurado.
 */
const PROVIDERS: Array<{
    match: RegExp;
    name: string;
    spfInclude: string;
    dkimType: 'TXT' | 'CNAME';
    dkimSelectors: string[];
    dkimNote: string;
}> = [
    { match: /(^|\.)gmail\.com$|(^|\.)google\.com$|(^|\.)googlemail\.com$/i, name: 'Google Workspace', spfInclude: 'include:_spf.google.com', dkimType: 'TXT', dkimSelectors: ['google'], dkimNote: 'Generá la clave en admin.google.com → Apps → Gmail → Autenticar correo y publicá el TXT que te da (selector "google").' },
    { match: /(^|\.)office365\.com$|(^|\.)outlook\.com$|(^|\.)protection\.outlook\.com$/i, name: 'Microsoft 365', spfInclude: 'include:spf.protection.outlook.com', dkimType: 'CNAME', dkimSelectors: ['selector1', 'selector2'], dkimNote: 'Activá DKIM en Microsoft 365 (Defender → Email authentication) y creá los 2 CNAME selector1/selector2 que te indica.' },
    { match: /(^|\.)brevo\.com$|(^|\.)sendinblue\.com$/i, name: 'Brevo', spfInclude: 'include:spf.brevo.com', dkimType: 'TXT', dkimSelectors: ['mail'], dkimNote: 'En Brevo → Senders & Domains → Authenticate copiá el TXT de `mail._domainkey`.' },
    { match: /(^|\.)amazonses\.com$|(^|\.)awsapps\.com$/i, name: 'Amazon SES', spfInclude: 'include:amazonses.com', dkimType: 'CNAME', dkimSelectors: [], dkimNote: 'SES usa Easy DKIM: la consola (Verified identities) te da 3 CNAMEs para crear.' },
    { match: /(^|\.)mailgun\.org$|(^|\.)mailgun\.com$/i, name: 'Mailgun', spfInclude: 'include:mailgun.org', dkimType: 'TXT', dkimSelectors: ['smtp', 'mailo', 'k1'], dkimNote: 'En Mailgun → Sending → Domain settings copiá el TXT `*._domainkey` que te indica.' },
    { match: /(^|\.)sendgrid\.net$/i, name: 'SendGrid', spfInclude: 'include:sendgrid.net', dkimType: 'CNAME', dkimSelectors: ['s1', 's2'], dkimNote: 'En SendGrid → Settings → Sender Authentication creá los CNAME s1/s2 del asistente.' },
    { match: /(^|\.)zoho\.com$|(^|\.)zoho\.eu$/i, name: 'Zoho Mail', spfInclude: 'include:zohomail.com', dkimType: 'TXT', dkimSelectors: ['zmail'], dkimNote: 'En Zoho Mail Admin → Email authentication generá el selector y publicá su TXT.' },
];

/** Dominio del remitente: `Acme <ventas@acme.com>` → `acme.com`. */
export function domainOfFrom(from: string): string | null {
    const email = /<([^>]+)>/.exec(from)?.[1] ?? from;
    const at = email.lastIndexOf('@');
    if (at === -1) return null;
    const domain = email.slice(at + 1).trim().toLowerCase().replace(/[>\s]+$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

/**
 * Deriva (PURO, sin red — testeable) los registros exactos que el cliente
 * debe crear: SPF con el include del proveedor (o a:host genérico), DKIM
 * guiado por proveedor y DMARC de arranque.
 */
export function deriveDnsRecords(cfg: SmtpConfig): {
    domain: string;
    provider: string;
    dkimSelectors: string[];
    records: DnsRecordCheck[];
} | null {
    const domain = domainOfFrom(cfg.from);
    if (!domain) return null;
    const provider = PROVIDERS.find((p) => p.match.test(cfg.host));

    const spfValue = provider ? `v=spf1 ${provider.spfInclude} ~all` : `v=spf1 a:${cfg.host} ~all`;
    const records: DnsRecordCheck[] = [
        {
            purpose: 'spf',
            type: 'TXT',
            host: '@',
            value: spfValue,
            status: 'unknown',
            ...(provider
                ? {}
                : { note: 'Proveedor no reconocido: si tu proveedor SMTP publica un include propio (ej. spf.tuproveedor.com), usalo en lugar de a:host.' }),
        },
        {
            purpose: 'dkim',
            type: provider?.dkimType ?? 'TXT',
            host: provider?.dkimSelectors[0] ? `${provider.dkimSelectors[0]}._domainkey` : 'selector._domainkey',
            value: '',
            status: 'unknown',
            note: provider?.dkimNote ?? 'La clave DKIM la genera tu proveedor SMTP: buscá "DKIM" en su panel y publicá el registro que te dé (host selector._domainkey).',
        },
        {
            purpose: 'dmarc',
            type: 'TXT',
            host: '_dmarc',
            value: `v=DMARC1; p=none; rua=mailto:postmaster@${domain}`,
            status: 'unknown',
            note: 'Empezá con p=none (solo monitoreo); cuando SPF y DKIM estén en verde podés subir a p=quarantine.',
        },
    ];
    return { domain, provider: provider?.name ?? 'desconocido', dkimSelectors: provider?.dkimSelectors ?? [], records };
}

/**
 * Reporte completo: derivación + VERIFICACIÓN en vivo contra el DNS real
 * (Cloudflare/Google como resolvers) — cada registro sale ok/missing/partial.
 */
@Injectable()
export class SmtpDnsService {
    async report(cfg: SmtpConfig): Promise<SmtpDnsReport | null> {
        const derived = deriveDnsRecords(cfg);
        if (!derived) return null;
        await this.verify(derived.domain, derived.records, derived.dkimSelectors);
        return { domain: derived.domain, provider: derived.provider, records: derived.records };
    }

    private async verify(domain: string, records: DnsRecordCheck[], dkimSelectors: string[]): Promise<void> {
        // Timeout corto + 1 intento por servidor: el reporte es interactivo
        // (lo dispara un botón del panel), mejor "unknown" rápido que colgarse.
        const resolver = new Resolver({ timeout: 2000, tries: 1 });
        resolver.setServers(['1.1.1.1', '8.8.8.8']);

        /** `failed` = error de RED (timeout, etc.) — distinto de "no existe". */
        const txt = async (name: string): Promise<{ values: string[]; failed: boolean }> => {
            try {
                return { values: (await resolver.resolveTxt(name)).map((parts) => parts.join('')), failed: false };
            } catch (err) {
                const code = (err as NodeJS.ErrnoException).code;
                return { values: [], failed: code !== 'ENOTFOUND' && code !== 'ENODATA' };
            }
        };
        const cname = async (name: string): Promise<{ hit: boolean; failed: boolean }> => {
            try {
                return { hit: (await resolver.resolveCname(name)).length > 0, failed: false };
            } catch (err) {
                const code = (err as NodeJS.ErrnoException).code;
                return { hit: false, failed: code !== 'ENOTFOUND' && code !== 'ENODATA' };
            }
        };

        await Promise.all(records.map(async (record) => {
            if (record.purpose === 'spf') {
                const res = await txt(domain);
                const found = res.values.filter((v) => v.toLowerCase().startsWith('v=spf1'));
                if (found.length === 0) {
                    record.status = res.failed ? 'unknown' : 'missing';
                } else {
                    record.current = found[0];
                    const needle = record.value.replace(/^v=spf1 /, '').replace(/ ~all$/, '');
                    record.status = found.some((v) => v.includes(needle)) ? 'ok' : 'partial';
                }
            } else if (record.purpose === 'dkim') {
                const selectors = dkimSelectors.length > 0 ? dkimSelectors : ['default', 'mail', 'smtp', 'k1', 'selector1', 's1'];
                // Todos los selectores en paralelo (TXT + CNAME de Easy-DKIM).
                const probes = await Promise.all(selectors.map(async (sel) => {
                    const name = `${sel}._domainkey.${domain}`;
                    const [t, c] = await Promise.all([txt(name), cname(name)]);
                    const hit = t.values.some((v) => v.includes('v=DKIM1') || v.includes('k=rsa') || v.includes('p=')) || c.hit;
                    return { sel, hit, failed: t.failed && c.failed };
                }));
                const hit = probes.find((p) => p.hit);
                if (hit) {
                    record.status = 'ok';
                    record.host = `${hit.sel}._domainkey`;
                } else {
                    record.status = probes.every((p) => p.failed) ? 'unknown' : 'missing';
                }
            } else {
                const res = await txt(`_dmarc.${domain}`);
                const dmarc = res.values.find((v) => v.toLowerCase().startsWith('v=dmarc1'));
                if (dmarc) {
                    record.status = 'ok';
                    record.current = dmarc;
                } else {
                    record.status = res.failed ? 'unknown' : 'missing';
                }
            }
        }));
    }
}

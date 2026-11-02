import { Inject, Injectable, Optional } from '@nestjs/common';
import { pickScanField, resolveTitleFieldId, type RecordQrInfo } from '@imagina-base/shared';
import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { ENV, type Env } from '../config/env';
import { DomainsService } from '../domains/domains.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RecordsService, type Actor } from '../records/records.service';
import { QR_SIZE_DEFAULT, QR_SIZE_MAX, QR_SIZE_MIN, configureQrRuntime, qrImageUrl, recordLinkFor } from './qr-runtime';
import { verifyQrToken } from './qr-token';

/** Cuánto se recuerda el origen de los enlaces de una empresa (su dominio propio responde o no). */
const LINK_BASE_TTL_MS = 5 * 60_000;

/**
 * v0.1.344 — El QR de los registros: la imagen pública firmada, el enlace a la
 * ficha (por el dominio de la empresa si responde) y el QR de un registro para
 * la ficha. Registra el runtime de las variables al arrancar.
 */
@Injectable()
export class QrService {
    private readonly secret: string;
    private readonly bases = new Map<number, { value: string; at: number }>();

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly records: RecordsService,
        private readonly fields: FieldsService,
        private readonly lists: ListsService,
        @Optional() private readonly domains?: DomainsService,
    ) {
        // Una clave propia derivada (no la misma firma que los archivos): un
        // token de QR nunca sirve como firma de otra cosa. Sin el secreto (dev),
        // uno por proceso — las imágenes dejan de valer al reiniciar.
        const root = env.FILES_SIGNING_SECRET || randomBytes(32).toString('hex');
        this.secret = createHash('sha256').update(`imagina-qr:${root}`).digest('hex');
        configureQrRuntime({
            imageBase: env.APP_BASE_URL ?? '',
            secret: this.secret,
            linkBase: (tenantId) => this.linkBase(tenantId),
        });
    }

    /** Origen de los enlaces de la empresa (cacheado 5 minutos). */
    async linkBase(tenantId: number): Promise<string> {
        const hit = this.bases.get(tenantId);
        if (hit && Date.now() - hit.at < LINK_BASE_TTL_MS) return hit.value;
        const value = this.domains ? await this.domains.baseUrlFor(tenantId, 'app').catch(() => this.env.APP_BASE_URL) : this.env.APP_BASE_URL;
        this.bases.set(tenantId, { value, at: Date.now() });
        return value;
    }

    /** El PNG del QR de un token firmado (null = token inválido). */
    async png(token: string, rawSize?: unknown): Promise<Buffer | null> {
        const content = verifyQrToken(token, this.secret);
        if (content === null) return null;
        const n = Number(rawSize);
        const size = Number.isFinite(n) && n > 0 ? Math.round(Math.min(QR_SIZE_MAX, Math.max(QR_SIZE_MIN, n))) : QR_SIZE_DEFAULT;
        return QRCode.toBuffer(content, {
            type: 'png',
            width: size,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: { dark: '#111111ff', light: '#ffffffff' },
        });
    }

    /**
     * El QR de UN registro para la ficha: su enlace y, si la lista tiene un
     * campo «Código» con valor, también ese código. Con el ACL de quien pide
     * (un registro fuera de su alcance es 404, un campo oculto no aparece).
     */
    async forRecord(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<RecordQrInfo> {
        const record = await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const data = (record.data ?? {}) as Record<string, unknown>;
        const valueOf = (id: number | null): string => {
            if (id === null) return '';
            const v = data[`f${id}`];
            return v === null || v === undefined ? '' : Array.isArray(v) ? v.map(String).join(', ') : String(v).trim();
        };
        const title = valueOf(resolveTitleFieldId(fields, list.settings as Record<string, unknown>)) || `Registro #${recordId}`;
        const link = await recordLinkFor(tenantId, list.slug, recordId);
        const codeField = pickScanField(fields, list.settings as Record<string, unknown>);
        const codeValue = codeField && `f${codeField.id}` in data ? valueOf(codeField.id) : '';
        return {
            record_id: recordId,
            title,
            link,
            link_qr_url: qrImageUrl(link),
            code: codeField && codeValue ? { field_id: codeField.id, field_label: codeField.label, value: codeValue, qr_url: qrImageUrl(codeValue) } : null,
        };
    }
}

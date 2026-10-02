import { CloudClient } from '@/lib/cloud/client';
import { portalAccountHeaders } from '@/portal/portalAccount';

/**
 * Cliente del portal del cliente. A diferencia del shell cloud, el portal NO
 * opera sobre un tenant activo (el `client` está atado a su empresa vía su
 * sesión); por eso no seteamos `X-Tenant-Id`. La sesión vive en la cookie
 * httpOnly propia del portal que abre `POST /portal/consume`. v0.1.241: manda
 * la cuenta elegida (`X-Portal-Account`) cuando la persona tiene varias.
 */
export const portalApi = new CloudClient({ getExtraHeaders: portalAccountHeaders });

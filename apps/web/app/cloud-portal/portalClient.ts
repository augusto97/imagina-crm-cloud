import { CloudClient } from '@/lib/cloud/client';

/**
 * Cliente del portal del cliente. A diferencia del shell cloud, el portal NO
 * opera sobre un tenant activo (el `client` está atado a UN record vía su
 * sesión); por eso no seteamos `X-Tenant-Id`. La sesión vive en la cookie
 * httpOnly que abre `POST /portal/consume` al canjear el magic link.
 */
export const portalApi = new CloudClient();

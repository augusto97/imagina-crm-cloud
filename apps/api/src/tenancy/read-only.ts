import type { Tx } from '../db/client';
import { tenantAccessInTx } from '../billing/tenant-access';

/**
 * SEC-34 (v0.1.239) — ¿La empresa está en SOLO-LECTURA (ADR-S09: impaga,
 * archivada o suscripción vencida)? El `TenantGuard` lo aplica a lo que hace
 * una persona por HTTP, pero lo que corre SOLO —automatizaciones programadas,
 * por fecha o por webhook entrante, recurrencias— no pasa por ahí: una empresa
 * suspendida seguía creando registros y mandando correos. Se consulta dentro
 * de la transacción con scope del tenant (RLS deja ver su propia fila).
 *
 * v0.1.338 — una empresa PAUSADA (prueba terminada o plan vencido) tampoco
 * corre nada: "no tiene acceso completo" cubre los dos casos.
 */
export async function tenantIsReadOnly(tx: Tx, tenantId: number): Promise<boolean> {
    return (await tenantAccessInTx(tx, tenantId)).state !== 'full';
}

/**
 * v0.1.338 — ¿La empresa está PAUSADA? Lo que se ve hacia afuera (el portal,
 * los enlaces públicos) se apaga además de no escribirse.
 */
export async function tenantIsLocked(tx: Tx, tenantId: number): Promise<boolean> {
    return (await tenantAccessInTx(tx, tenantId)).state === 'locked';
}

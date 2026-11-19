/**
 * v0.1.451 — Avisos y revisiones de cobro de otros módulos que corren con el
 * reloj de cobros (cada hora). Vive aparte de `BillingRemindersService` para
 * que cualquier service se registre sin importar ese archivo (que importa a la
 * revisión de respaldo y, por ella, a `PaymentsService`: un import circular
 * dejaría tipos sin definir al armar la inyección de dependencias).
 */
export const extraBillingTicks: Array<(now: Date) => Promise<number>> = [];

export function registerBillingTick(fn: (now: Date) => Promise<number>): void {
    if (!extraBillingTicks.includes(fn)) extraBillingTicks.push(fn);
}

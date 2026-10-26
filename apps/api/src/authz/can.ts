import { roleHasCapability, type Capability, type Role } from '@imagina-base/shared';

/**
 * C2 — ¿Quien pide tiene la capacidad? Las capacidades EFECTIVAS (rol propio
 * o rol base) las resuelve el TenantGuard una vez por request y viajan con el
 * actor (`aclOf(req)`). Sin ellas (un llamador interno, un test) valen las del
 * rol base. ÚNICO lugar del API que consulta la matriz de roles: todo chequeo
 * de capacidad pasa por aquí.
 */
export function can(subject: { role: Role | string; capabilities?: readonly Capability[] }, capability: Capability): boolean {
    if (subject.capabilities) return subject.capabilities.includes(capability);
    return roleHasCapability(subject.role as Role, capability);
}

/** ¿Tiene AL MENOS UNA de las capacidades? */
export function canAny(subject: { role: Role | string; capabilities?: readonly Capability[] }, capabilities: readonly Capability[]): boolean {
    return capabilities.some((c) => can(subject, c));
}

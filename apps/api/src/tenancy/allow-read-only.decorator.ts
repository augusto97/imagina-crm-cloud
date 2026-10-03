import { SetMetadata } from '@nestjs/common';

export const ALLOW_READ_ONLY = 'allowReadOnly';

/**
 * v0.1.250 — La ruta muta pero se permite en solo-lectura (ADR-S09). Hoy sólo
 * PAGAR: una empresa vencida tiene que poder pagar para salir del
 * solo-lectura (antes el TenantGuard le rechazaba el checkout justamente por
 * estar vencida).
 */
export const AllowReadOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_READ_ONLY, true);

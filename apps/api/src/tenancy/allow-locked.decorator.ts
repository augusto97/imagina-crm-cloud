import { SetMetadata } from '@nestjs/common';

export const ALLOW_LOCKED = 'allowLocked';

/**
 * v0.1.338 (ADR-S87) — El endpoint sigue disponible con la empresa PAUSADA
 * (prueba terminada o plan vencido): lo que necesita la pantalla «cuenta
 * pausada» para elegir un plan, pagar y descargar los datos (ADR-S09: los
 * datos nunca se secuestran). Todo lo demás responde 403 `workspace_locked`.
 * Implica también permitirlo en solo-lectura.
 */
export const AllowLocked = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_LOCKED, true);

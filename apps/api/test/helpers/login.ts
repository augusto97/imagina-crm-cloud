import type { AuthSession, LoginInput } from '@imagina-base/shared';
import type { AuthService } from '../../src/auth/auth.service';

/**
 * `login()` devuelve la sesión O el desafío de 2FA (v0.1.120). Casi todos los
 * tests trabajan con cuentas SIN segundo factor: este helper estrecha el tipo y
 * falla ruidosamente si el desafío aparece donde no se lo espera.
 */
export async function loginOk(auth: AuthService, input: LoginInput): Promise<AuthSession> {
    const result = await auth.login(input);
    if ('mfa_required' in result) {
        throw new Error('login pidió segundo factor y el test no lo esperaba');
    }
    return result;
}

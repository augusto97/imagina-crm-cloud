import type { PlatformDomainKind } from '@imagina-base/shared';

/**
 * v0.1.246 — Correo al operador cuando una empresa activa o quita un dominio.
 *
 * Con el camino de ServerAvatar (alias por panel) un dominio verificado NO
 * funciona hasta que alguien lo agrega a mano en el servidor web, y uno que la
 * empresa dejó de usar hay que sacarlo: si queda en el certificado compartido
 * y deja de apuntar al servidor, la renovación de TODO el certificado falla.
 * Puro, para testearlo sin correo.
 */
export interface DomainOperatorEvent {
    type: 'verified' | 'removed';
    tenantId: number;
    tenantName: string;
    kind: PlatformDomainKind;
    /** v0.1.423 — el nombre de la tienda cuando `kind` es `shop`. */
    shopName?: string;
    domain: string;
    /** Host al que apunta el CNAME (el de la app). */
    target: string;
    /** Plataforma → Dominios. */
    consoleUrl: string;
}

export function domainOperatorNotice(e: DomainOperatorEvent): { subject: string; text: string } {
    const what =
        e.kind === 'portal' ? 'el portal de sus clientes' : e.kind === 'shop' ? `su tienda «${e.shopName ?? 'tienda'}»` : 'su equipo';
    if (e.type === 'verified') {
        return {
            subject: `Dominio para habilitar: ${e.domain} (${e.tenantName})`,
            text: [
                `${e.tenantName} verificó ${e.domain} como dominio para ${what}.`,
                '',
                'Todavía no funciona: falta habilitarlo en el servidor.',
                '',
                'En ServerAvatar:',
                `  1. En la aplicación de Imagina Base, agrega ${e.domain} como dominio adicional (alias).`,
                '  2. SSL → vuelve a emitir el certificado de Let\'s Encrypt incluyendo el alias.',
                '',
                `El DNS de ${e.domain} tiene que apuntar a ${e.target} (CNAME) antes de emitir el certificado.`,
                ...(e.kind === 'shop'
                    ? [
                          '',
                          'Es el dominio de una tienda: además, el servidor web tiene que mandarle a la app lo que no es un archivo',
                          '(un paso único por servidor; la consola dice si ya está hecho y cómo hacerlo).',
                      ]
                    : []),
                `En la consola ves si ya apunta y si ya responde: ${e.consoleUrl}`,
            ].join('\n'),
        };
    }
    return {
        subject: `Dominio para quitar del servidor: ${e.domain} (${e.tenantName})`,
        text: [
            `${e.tenantName} dejó de usar ${e.domain} (era el dominio de ${what}).`,
            '',
            'Sácalo del servidor para que no rompa la renovación del certificado:',
            `  En ServerAvatar, quita el alias ${e.domain} de la aplicación de Imagina Base y vuelve a emitir el SSL.`,
            '',
            `Después márcalo como hecho en la consola: ${e.consoleUrl}`,
        ].join('\n'),
    };
}

import type { GuestLevel } from '@imagina-base/shared';

import { foldText } from '@/lib/folderSections';

/**
 * v0.1.410 — Lo que ofrece el buscador de «Compartir → Personas»: un solo
 * cuadro para sumar a una persona de la empresa, a un equipo entero o a
 * alguien de afuera por su correo (como Google Docs o ClickUp). Puro, para
 * probarlo sin montar el diálogo.
 */
export type ShareOption =
    | { kind: 'member'; id: number; name: string; email: string; has: boolean }
    | { kind: 'team'; id: number; name: string; count: number; icon: string | null; color: string | null; has: boolean }
    | { kind: 'guest'; id: number; name: string; email: string; has: boolean }
    | { kind: 'email'; email: string };

export interface ShareSearchUser {
    id: number;
    /** El correo (el directorio lo manda en `login`). */
    login: string;
    display_name: string;
    is_guest?: boolean;
}

export interface ShareSearchTeam {
    id: number;
    name: string;
    member_count: number;
    icon: string | null;
    color: string | null;
}

export interface ShareCurrent {
    userIds: ReadonlySet<number>;
    teamIds: ReadonlySet<number>;
    guestIds: ReadonlySet<number>;
    guestEmails: ReadonlySet<string>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function looksLikeEmail(text: string): boolean {
    return EMAIL.test(text.trim());
}

/**
 * Las opciones en el orden en que se muestran: personas de la empresa,
 * equipos, personas de afuera que ya existen y, si lo escrito es un correo que
 * no es de nadie de la empresa, «Invitar a …».
 */
export function buildShareOptions(
    query: string,
    users: readonly ShareSearchUser[],
    teams: readonly ShareSearchTeam[],
    current: ShareCurrent,
    maxTeams = 5,
): ShareOption[] {
    const q = query.trim();
    if (q === '') return [];
    const fq = foldText(q);
    const out: ShareOption[] = [];

    for (const u of users) {
        if (u.is_guest) continue;
        out.push({ kind: 'member', id: u.id, name: u.display_name || u.login, email: u.login, has: current.userIds.has(u.id) });
    }

    let n = 0;
    for (const t of teams) {
        if (n >= maxTeams) break;
        if (!foldText(t.name).includes(fq)) continue;
        out.push({ kind: 'team', id: t.id, name: t.name, count: t.member_count, icon: t.icon, color: t.color, has: current.teamIds.has(t.id) });
        n++;
    }

    for (const u of users) {
        if (!u.is_guest) continue;
        out.push({ kind: 'guest', id: u.id, name: u.display_name || u.login, email: u.login, has: current.guestIds.has(u.id) });
    }

    if (looksLikeEmail(q)) {
        const email = q.toLowerCase();
        const known = users.some((u) => u.login.toLowerCase() === email) || current.guestEmails.has(email);
        if (!known) out.push({ kind: 'email', email });
    }
    return out;
}

/** ¿Se puede elegir? (Lo que ya tiene acceso se muestra, deshabilitado.) */
export function selectableOption(o: ShareOption): boolean {
    return o.kind === 'email' || !o.has;
}

/**
 * Con qué nivel entra alguien de afuera según el nivel elegido junto al
 * buscador. Los invitados tienen su propia escala (ver / comentar / editar,
 * nunca borran): «Colaborar» y «Control total» → puede editar; el resto,
 * sólo ver (lo más seguro). Se cambia después en su fila.
 */
export function guestLevelFor(accessLevel: string): GuestLevel {
    return accessLevel === 'collab' || accessLevel === 'full' ? 'edit' : 'view';
}

/** Las iniciales para el avatar redondo de una persona. */
export function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

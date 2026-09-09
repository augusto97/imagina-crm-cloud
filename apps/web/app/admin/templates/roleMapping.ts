import type { TemplateRoleField } from '@imagina-base/shared';

/** Lo mínimo de un campo para mapearlo a un rol. */
export interface MappableField {
    id: number;
    label: string;
    slug: string;
    type: string;
}

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** ¿El campo sirve para el rol? (sin tipos declarados vale cualquiera). */
export function fieldFitsRole(field: MappableField, role: TemplateRoleField): boolean {
    return role.types.length === 0 || role.types.includes(field.type as TemplateRoleField['types'][number]);
}

/**
 * Sugerencia automática rol → campo (v0.1.167). Puntúa cada campo compatible:
 * mismo slug que la key del rol (lo que pasa al re-aplicar una plantilla
 * guardada sobre una lista parecida) > la etiqueta contiene a la del rol o
 * al revés > mismo tipo a secas. Greedy en el orden de los roles y sin
 * repetir campo, así "Fecha de emisión" y "Vencimiento" no caen los dos en
 * el mismo campo de fecha.
 */
export function suggestRoleMapping(roles: TemplateRoleField[], fields: MappableField[]): Record<string, number> {
    const out: Record<string, number> = {};
    const used = new Set<number>();
    const scored = roles.map((role) => {
        const key = normalize(role.key);
        const label = normalize(role.label);
        const candidates = fields
            .filter((f) => fieldFitsRole(f, role))
            .map((f) => {
                const fslug = normalize(f.slug);
                const flabel = normalize(f.label);
                let score = 1;
                if (fslug === key || flabel === label) score = 4;
                else if (flabel.includes(label) || label.includes(flabel) || fslug.includes(key) || key.includes(fslug)) score = 3;
                else if (label.split(' ').some((w) => w.length > 3 && flabel.includes(w))) score = 2;
                return { id: f.id, score };
            })
            .sort((a, b) => b.score - a.score);
        return { role, candidates };
    });
    // Primero los que tienen una coincidencia fuerte, para que un rol débil
    // no se lleve el campo que otro rol quería por nombre.
    for (const min of [4, 3, 2, 1]) {
        for (const { role, candidates } of scored) {
            if (out[role.key] !== undefined) continue;
            const pick = candidates.find((c) => c.score >= min && !used.has(c.id));
            if (pick && pick.score >= min) {
                out[role.key] = pick.id;
                used.add(pick.id);
            }
        }
    }
    return out;
}

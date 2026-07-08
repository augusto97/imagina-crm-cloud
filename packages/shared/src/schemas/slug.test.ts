import { describe, expect, it } from 'vitest';
import {
    fieldSlugSchema,
    listSlugSchema,
    slugify,
    slugifyTenant,
    slugSchema,
    tenantSlugSchema,
} from './slug';

describe('slugSchema (CONTRACT.md §2)', () => {
    it('acepta snake_case que arranca con letra', () => {
        expect(slugSchema.safeParse('clientes').success).toBe(true);
        expect(slugSchema.safeParse('valor_total_2').success).toBe(true);
        expect(slugSchema.safeParse('a').success).toBe(true);
    });

    it('rechaza formatos inválidos', () => {
        expect(slugSchema.safeParse('2clientes').success).toBe(false);
        expect(slugSchema.safeParse('_privado').success).toBe(false);
        expect(slugSchema.safeParse('Clientes').success).toBe(false);
        expect(slugSchema.safeParse('con-guion').success).toBe(false);
        expect(slugSchema.safeParse('con espacio').success).toBe(false);
        expect(slugSchema.safeParse('').success).toBe(false);
        expect(slugSchema.safeParse('a'.repeat(64)).success).toBe(false);
    });

    it('acepta exactamente 63 caracteres', () => {
        expect(slugSchema.safeParse('a'.repeat(63)).success).toBe(true);
    });
});

describe('slugs reservados', () => {
    it('rechaza reservados de lista', () => {
        for (const reserved of ['lists', 'records', 'auth', 'slug_history', 'webhooks']) {
            expect(listSlugSchema.safeParse(reserved).success).toBe(false);
        }
    });

    it('rechaza columnas del sistema y reservadas de Postgres en campos', () => {
        for (const reserved of ['id', 'created_at', 'deleted_at', 'select', 'user', 'order', 'limit']) {
            expect(fieldSlugSchema.safeParse(reserved).success).toBe(false);
        }
    });

    it('un reservado de lista sí puede ser slug de campo (y viceversa)', () => {
        expect(fieldSlugSchema.safeParse('webhooks').success).toBe(true);
        expect(listSlugSchema.safeParse('created_at').success).toBe(true);
    });
});

describe('slugify', () => {
    it('genera snake_case desde labels con acentos y símbolos', () => {
        expect(slugify('Valor Total')).toBe('valor_total');
        expect(slugify('Teléfono (móvil)')).toBe('telefono_movil');
        expect(slugify('  ¿Está activo?  ')).toBe('esta_activo');
    });

    it('garantiza que arranque con letra', () => {
        expect(slugify('2024 ingresos')).toMatch(/^[a-z]/);
    });

    it('el resultado siempre pasa el schema base', () => {
        for (const label of ['Nombre', '123', 'É con acento', 'a'.repeat(200)]) {
            expect(slugSchema.safeParse(slugify(label)).success).toBe(true);
        }
    });
});

describe('slugs de tenant (subdominios)', () => {
    it('usa guiones, no underscores', () => {
        expect(slugifyTenant('Imagina WP')).toBe('imagina-wp');
        expect(tenantSlugSchema.safeParse('imagina-wp').success).toBe(true);
        expect(tenantSlugSchema.safeParse('imagina_wp').success).toBe(false);
    });

    it('siempre produce un slug válido', () => {
        for (const name of ['ACME S.A.S.', '42', '  ', 'Café Ñandú']) {
            expect(tenantSlugSchema.safeParse(slugifyTenant(name)).success).toBe(true);
        }
    });
});

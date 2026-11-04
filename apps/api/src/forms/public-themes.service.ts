import { randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    PUBLIC_THEMES_MAX,
    publicThemeFileIds,
    readSavedPublicThemes,
    sanitizePublicCss,
    type CreatePublicThemeInput,
    type PublicThemesDto,
    type SavedPublicTheme,
    type UpdatePublicThemeInput,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { tenants } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { FormsService, type FormActor } from './forms.service';

/**
 * v0.1.351 (ADR-S94) — «Mis temas»: los diseños que una empresa guarda para
 * reusar en todos sus formularios (y, en la entrega siguiente, en la agenda).
 * Viven en `tenants.settings.public_themes` (como los presets de estilo de
 * v0.1.94) y `public_theme_default` dice con cuál nacen los formularios
 * nuevos. Las mismas reglas que al guardar un formulario: el CSS propio sólo
 * lo escribe un admin y las imágenes tienen que ser de la empresa.
 */
@Injectable()
export class PublicThemesService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly forms: FormsService,
    ) {}

    async list(tenantId: number): Promise<PublicThemesDto> {
        const st = await this.settings(tenantId);
        return this.dto(st);
    }

    async create(tenantId: number, input: CreatePublicThemeInput, actor: FormActor): Promise<SavedPublicTheme> {
        await this.check(tenantId, input.theme, actor, '');
        return this.mutate(tenantId, (themes) => {
            if (themes.length >= PUBLIC_THEMES_MAX) {
                throw new BadRequestException({
                    code: 'too_many_themes',
                    message: `Puedes guardar hasta ${PUBLIC_THEMES_MAX} temas. Borra alguno para guardar otro.`,
                    data: { status: 400 },
                });
            }
            const theme: SavedPublicTheme = {
                id: randomBytes(9).toString('hex').slice(0, 12),
                name: input.name.trim(),
                theme: { ...input.theme, custom_css: sanitizePublicCss(input.theme.custom_css).css, preset: null },
                updated_at: new Date().toISOString(),
            };
            return { themes: [...themes, theme], result: theme };
        });
    }

    async update(tenantId: number, id: string, input: UpdatePublicThemeInput, actor: FormActor): Promise<SavedPublicTheme> {
        const current = readSavedPublicThemes((await this.settings(tenantId)).public_themes).find((t) => t.id === id);
        if (!current) throw notFound();
        if (input.theme) await this.check(tenantId, input.theme, actor, current.theme.custom_css);
        return this.mutate(tenantId, (themes) => {
            const idx = themes.findIndex((t) => t.id === id);
            if (idx < 0) throw notFound();
            const prev = themes[idx]!;
            const next: SavedPublicTheme = {
                ...prev,
                ...(input.name !== undefined ? { name: input.name.trim() } : {}),
                ...(input.theme ? { theme: { ...input.theme, custom_css: sanitizePublicCss(input.theme.custom_css).css, preset: null } } : {}),
                updated_at: new Date().toISOString(),
            };
            const out = themes.slice();
            out[idx] = next;
            return { themes: out, result: next };
        });
    }

    async remove(tenantId: number, id: string): Promise<{ ok: true }> {
        await this.mutate(tenantId, (themes, st) => {
            if (!themes.some((t) => t.id === id)) throw notFound();
            if (st.public_theme_default === id) st.public_theme_default = null;
            return { themes: themes.filter((t) => t.id !== id), result: null };
        });
        return { ok: true };
    }

    async setDefault(tenantId: number, id: string | null): Promise<PublicThemesDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1).for('update');
            const st = { ...((row?.settings ?? {}) as Record<string, unknown>) };
            const themes = readSavedPublicThemes(st.public_themes);
            if (id !== null && !themes.some((t) => t.id === id)) throw notFound();
            st.public_theme_default = id;
            await tx.update(tenants).set({ settings: st, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
            return this.dto(st);
        });
    }

    /** CSS propio sólo de admin; imágenes de la empresa. */
    private async check(tenantId: number, theme: SavedPublicTheme['theme'], actor: FormActor, previousCss: string): Promise<void> {
        const css = sanitizePublicCss(theme.custom_css).css;
        if (css !== '' && css !== sanitizePublicCss(previousCss).css && !actor.isAdmin) {
            throw new ForbiddenException({
                code: 'custom_css_admin_only',
                message: 'El CSS propio lo agrega un administrador de la empresa.',
                data: { status: 403 },
            });
        }
        await this.forms.assertImages(tenantId, publicThemeFileIds(theme));
    }

    private async settings(tenantId: number): Promise<Record<string, unknown>> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
        );
        return (row?.settings ?? {}) as Record<string, unknown>;
    }

    /** Lee y escribe la lista en UNA transacción con la fila bloqueada (dos guardados a la vez no se pisan). */
    private async mutate<T>(
        tenantId: number,
        fn: (themes: SavedPublicTheme[], st: Record<string, unknown>) => { themes: SavedPublicTheme[]; result: T },
    ): Promise<T> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1).for('update');
            const st = { ...((row?.settings ?? {}) as Record<string, unknown>) };
            const out = fn(readSavedPublicThemes(st.public_themes), st);
            st.public_themes = out.themes;
            await tx.update(tenants).set({ settings: st, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
            return out.result;
        });
    }

    private dto(st: Record<string, unknown>): PublicThemesDto {
        const themes = readSavedPublicThemes(st.public_themes);
        const def = typeof st.public_theme_default === 'string' ? st.public_theme_default : null;
        return { themes, default_id: def && themes.some((t) => t.id === def) ? def : null };
    }
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'not_found', message: 'Ese tema no existe', data: { status: 404 } });
}

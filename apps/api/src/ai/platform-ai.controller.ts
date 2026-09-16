import { Body, Controller, Get, Inject, Optional, Patch, Post, UseGuards } from '@nestjs/common';
import { updatePlatformAiSettingsSchema, type PlatformAiSettings, type UpdatePlatformAiSettingsInput } from '@imagina-base/shared';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AiSettingsService } from './ai-settings.service';
import { AI_CLIENT_FACTORY, defaultClientFactory, type AiClientFactory } from './assistant.service';

const testSchema = z.object({
    /** Probar ESTA clave (antes de guardarla). Vacío = la guardada / del env. */
    api_key: z.string().max(400).optional(),
});

export interface PlatformAiTestResult {
    ok: boolean;
    model: string;
    message: string;
}

/**
 * Consola de plataforma → Asistente IA (superadmin): interruptor general,
 * clave del proveedor, modelo por defecto y las dos políticas comerciales
 * (compartir la clave de la plataforma con cuota por plan / permitir
 * claves propias por empresa). La clave nunca sale en el GET.
 */
@Controller('platform/ai')
@UseGuards(SessionGuard, SuperadminGuard)
export class PlatformAiController {
    private readonly clientFactory: AiClientFactory;

    constructor(
        private readonly settings: AiSettingsService,
        @Optional() @Inject(AI_CLIENT_FACTORY) clientFactory?: AiClientFactory,
    ) {
        this.clientFactory = clientFactory ?? defaultClientFactory;
    }

    @Get()
    get(): Promise<PlatformAiSettings> {
        return this.settings.getPlatform();
    }

    @Patch()
    update(@Body(new ZodValidationPipe(updatePlatformAiSettingsSchema)) input: UpdatePlatformAiSettingsInput): Promise<PlatformAiSettings> {
        return this.settings.updatePlatform(input);
    }

    /** Llamada mínima al proveedor con la clave indicada (o la guardada) para comprobar que sirve. */
    @Post('test')
    async test(@Body(new ZodValidationPipe(testSchema)) input: z.infer<typeof testSchema>): Promise<PlatformAiTestResult> {
        const platform = await this.settings.getPlatform();
        const key = input.api_key?.trim() || (await this.settings.platformKey());
        if (!key) return { ok: false, model: platform.model, message: 'No hay ninguna clave para probar.' };
        try {
            const client = this.clientFactory(key);
            const res = await client.messages.create({
                model: platform.model,
                max_tokens: 16,
                messages: [{ role: 'user', content: 'Respondé sólo "ok".' }],
            });
            const text = res.content.find((b) => b.type === 'text');
            return { ok: true, model: res.model, message: `El proveedor respondió (${text && text.type === 'text' ? text.text.trim() : 'sin texto'}).` };
        } catch (err) {
            const status = (err as { status?: number }).status;
            const detail = err instanceof Error ? err.message : String(err);
            const message =
                status === 401
                    ? 'El proveedor rechazó la clave (401). Revisá que esté completa y vigente.'
                    : status === 404
                      ? `El modelo ${platform.model} no está disponible para esta clave (404).`
                      : `No se pudo hablar con el proveedor: ${detail}`;
            return { ok: false, model: platform.model, message };
        }
    }
}

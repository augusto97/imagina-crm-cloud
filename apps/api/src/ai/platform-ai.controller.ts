import { Body, Controller, Get, Inject, Optional, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
    updatePlatformAiSettingsSchema,
    type AiModelCatalog,
    type PlatformAiSettings,
    type UpdatePlatformAiSettingsInput,
} from '@imagina-base/shared';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { describeProviderError } from './ai-model-catalog.service';
import { AiSettingsService, AiUnavailableError } from './ai-settings.service';
import { AI_CLIENT_FACTORY, defaultClientFactory, type AiClientFactory } from './assistant.service';
import { effortParam } from './model-params';

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

    /**
     * v0.1.305 — los modelos que ve la clave de la plataforma, consultados al
     * proveedor (cache 12 h). `?refresh=1` vuelve a preguntar ahora.
     */
    @Get('models')
    models(@Query('refresh') refresh?: string): Promise<AiModelCatalog> {
        return this.settings.platformCatalog(refresh === '1' || refresh === 'true');
    }

    @Patch()
    update(@Body(new ZodValidationPipe(updatePlatformAiSettingsSchema)) input: UpdatePlatformAiSettingsInput): Promise<PlatformAiSettings> {
        return this.settings.updatePlatform(input);
    }

    /**
     * Prueba la clave indicada (o la guardada): consulta qué modelos ve y hace
     * una llamada mínima con el modelo elegido, ya resuelto.
     */
    @Post('test')
    async test(@Body(new ZodValidationPipe(testSchema)) input: z.infer<typeof testSchema>): Promise<PlatformAiTestResult> {
        const platform = await this.settings.getPlatform();
        const key = input.api_key?.trim() || (await this.settings.platformKey());
        if (!key) return { ok: false, model: platform.model, message: 'No hay ninguna clave para probar.' };
        const catalog = await this.settings.catalogFor(key, true);
        if (catalog.error && catalog.models.length === 0) return { ok: false, model: platform.model, message: catalog.error };
        let model;
        try {
            model = await this.settings.resolveModel(key, platform.model);
        } catch (err) {
            return { ok: false, model: platform.model, message: err instanceof AiUnavailableError ? err.message : describeProviderError(err) };
        }
        try {
            const client = this.clientFactory(key);
            const res = await client.messages.create({
                model: model.id,
                // Margen para el pensamiento (en algunos modelos no se puede apagar).
                max_tokens: 256,
                ...effortParam('low', model.caps),
                messages: [{ role: 'user', content: 'Responde sólo "ok".' }],
            });
            const text = res.content.find((b) => b.type === 'text');
            const seen = catalog.models.length > 0 ? ` La clave ve ${catalog.models.length} modelos.` : '';
            return {
                ok: true,
                model: res.model,
                message: `${model.name} respondió (${text && text.type === 'text' ? text.text.trim() : 'sin texto'}).${seen}`,
            };
        } catch (err) {
            const status = (err as { status?: number }).status;
            const message =
                status === 404 ? `El modelo ${model.name} no está disponible para esta clave (404).` : describeProviderError(err);
            return { ok: false, model: model.id, message };
        }
    }
}

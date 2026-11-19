import { Inject, Injectable, Optional } from '@nestjs/common';
import { AI_CLIENT_FACTORY, defaultClientFactory, type AiClientFactory } from './ai-client';
import { AiQuotaService } from './ai-quota.service';
import { AiSettingsService } from './ai-settings.service';
import { fieldModelParams } from './model-params';

export interface AutomationAskAiRequest {
    tenantId: number;
    system: string;
    user: string;
    /** `fast` = el más reciente de la familia económica; `assistant` = el modelo del asistente. */
    quality: 'fast' | 'assistant';
    /** Cuánto puede escribir la respuesta (sin contar el pensamiento). */
    answerTokens: number;
}

export interface AutomationAskAiReply {
    text: string;
    model: string;
    /** `refusal` / `max_tokens` (cortada): el paso falla con el motivo. */
    stopReason: string | null;
    usage: { input: number; output: number };
    /** La empresa usó la clave de la plataforma (cuenta para la cuota del plan). */
    metered: boolean;
}

/**
 * v0.1.460 — El pedido del paso «Preguntarle a la IA» de las automatizaciones.
 *
 * La MISMA resolución que el resto de la IA de la app (ADR-S21): la clave de
 * la plataforma contra la cuota del plan, o la clave propia de la empresa (sin
 * cuota), con el plan incluyendo el módulo de IA. El pedido se reserva ANTES
 * de llamar (atómico) y se devuelve si el proveedor no contesta.
 *
 * Vive en el módulo de IA (que ya importa al de automatizaciones); el motor lo
 * pide perezosamente por el ModuleRef: así no se arma un ciclo de módulos.
 */
@Injectable()
export class AutomationAskAiService {
    private readonly clientFactory: AiClientFactory;

    constructor(
        private readonly settings: AiSettingsService,
        private readonly quota: AiQuotaService,
        @Optional() @Inject(AI_CLIENT_FACTORY) clientFactory?: AiClientFactory,
    ) {
        this.clientFactory = clientFactory ?? defaultClientFactory;
    }

    async ask(req: AutomationAskAiRequest): Promise<AutomationAskAiReply> {
        // Lanza AiUnavailableError con el motivo (IA apagada, plan sin IA, sin clave…).
        const access = await this.settings.resolve(req.tenantId);
        const metered = access.source === 'platform';
        if (metered) await this.quota.reserve(req.tenantId);
        let res: Awaited<ReturnType<ReturnType<AiClientFactory>['messages']['create']>>;
        let modelId: string;
        try {
            const model = req.quality === 'assistant' ? { id: access.model, caps: access.caps } : await this.settings.fastModel(access.apiKey);
            modelId = model.id;
            const params = fieldModelParams(model.caps, req.answerTokens);
            res = await this.clientFactory(access.apiKey).messages.create({
                model: model.id,
                max_tokens: params.max_tokens,
                ...params.extra,
                system: req.system,
                messages: [{ role: 'user', content: req.user }],
            });
        } catch (err) {
            if (metered) await this.quota.settle(req.tenantId, { input: 0, output: 0 });
            throw err;
        }
        const usage = {
            input: res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0),
            output: res.usage.output_tokens,
        };
        if (metered) await this.quota.settle(req.tenantId, usage, { keep: true });
        const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
        return { text, model: modelId, stopReason: res.stop_reason ?? null, usage, metered };
    }
}

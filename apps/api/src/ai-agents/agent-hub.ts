import { Global, Injectable, Module } from '@nestjs/common';
import type { AutomationChain } from '../automations/automation-dispatcher.service';

/**
 * E6 — Lo que el motor de automatizaciones le pide a un agente de IA (la
 * acción «Pedirle a un agente»). El motor no conoce a los agentes ni a la IA:
 * llama a este hub, y el módulo de agentes se registra como quien atiende. Así
 * CUALQUIER disparador de automatización —los de hoy y los que vengan (un
 * correo que llega, un mensaje de WhatsApp)— le puede pedir trabajo a un
 * agente sin tocar este módulo. Mismo patrón que `IncidentHub` y `NotifyHub`.
 */
export interface AskAgentRequest {
    tenantId: number;
    agentId: number;
    listId: number;
    recordId: number | null;
    /** La automatización que lo pide (para el historial y el anti-bucle). */
    automation: { id: number; name: string } | null;
    /** El disparador de esa automatización (`record_created`, …), para el historial. */
    triggerType: string;
    /** Instrucción extra con sus variables ya resueltas (los valores, envueltos como dato). */
    instruction: string;
    /** La cadena de automatizaciones: lo que escriba el agente no vuelve a dispararla sin tope. */
    chain?: AutomationChain;
}

export interface AskAgentResult {
    /** `queued`: quedó en cola; `skipped`: no se le pidió (agente en pausa, lista fuera de su alcance); `failed`: no existe. */
    status: 'queued' | 'skipped' | 'failed';
    message: string;
    agentName: string | null;
    runId: number | null;
}

/** Lo que muestra «Probar» de una automatización (sin pedirle nada al agente). */
export interface AgentPreview {
    name: string;
    active: boolean;
    inScope: boolean;
    mode: 'propose' | 'act';
}

export interface AgentHandler {
    ask(req: AskAgentRequest): Promise<AskAgentResult>;
    preview(tenantId: number, agentId: number, listId: number): Promise<AgentPreview | null>;
}

@Injectable()
export class AgentHub {
    private handler: AgentHandler | null = null;

    setHandler(handler: AgentHandler): void {
        this.handler = handler;
    }

    async ask(req: AskAgentRequest): Promise<AskAgentResult> {
        if (!this.handler) {
            return { status: 'failed', message: 'Los agentes de IA no están disponibles en este servidor.', agentName: null, runId: null };
        }
        return this.handler.ask(req);
    }

    async preview(tenantId: number, agentId: number, listId: number): Promise<AgentPreview | null> {
        return this.handler ? this.handler.preview(tenantId, agentId, listId) : null;
    }
}

@Global()
@Module({ providers: [AgentHub], exports: [AgentHub] })
export class AgentHubModule {}

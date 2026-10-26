import type { AiProposal, Capability, Role } from '@imagina-base/shared';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AclExtras } from '../../lists/list-acl';
import { can, canAny } from '../../authz/can';
import type { AiProposalApplier } from '../proposals.store';

/**
 * Registro de herramientas del asistente (ADR-S21).
 *
 * UNA sola definición por herramienta, consumida por dos transportes: el
 * chat en la app (fase 1) y el servidor MCP (fase 3). Cada herramienta
 * declara la capability que exige — se valida ANTES de ejecutarla, con el
 * rol real de quien habla, así el modelo nunca puede hacer algo que la
 * persona no podría hacer a mano desde la interfaz.
 */

/** Quién habla: el mismo scope que un request normal de la app. */
export interface AiToolContext extends AclExtras {
    tenantId: number;
    userId: number;
    role: Role;
    /** Dónde está parada la persona (lista abierta), para no preguntar lo obvio. */
    listSlug?: string;
    /** Conversación que originó la propuesta (para reflejar el "aplicado" en el transcript). */
    conversationId?: string;
}

/** Resultado de una herramienta: lo que vuelve al modelo + la propuesta (si la creó). */
export interface AiToolResult {
    /** JSON que se le devuelve al modelo como `tool_result`. */
    content: unknown;
    /** Propuesta creada (las tools `propose_*`). La UI dibuja la tarjeta. */
    proposal?: AiProposal;
    /** Marcar el `tool_result` como error (el modelo corrige y reintenta). */
    isError?: boolean;
}

export interface AiToolDef<I = unknown> {
    name: string;
    /** Etiqueta corta para el indicador "Consultando…" de la UI. */
    label: string;
    description: string;
    /**
     * Capability que exige, o `null` si sólo lee lo que cualquier miembro ve.
     * Una lista = alcanza con CUALQUIERA (p. ej. editar todo o sólo lo suyo).
     */
    capability: Capability | readonly Capability[] | null;
    input: ZodTypeAny;
    run(ctx: AiToolContext, input: I): Promise<AiToolResult>;
}

/** Error de herramienta con mensaje para el MODELO (no para la persona). */
export class AiToolError extends Error {
    constructor(message: string) {
        super(message);
    }
}

/**
 * Quién usa las herramientas: un rol base (tests) o la persona con sus
 * capacidades EFECTIVAS (C2: rol propio).
 */
export type ToolSubject = Role | { role: Role; capabilities?: readonly Capability[] };

function subjectOf(who: ToolSubject): { role: Role; capabilities?: readonly Capability[] } {
    return typeof who === 'string' ? { role: who } : who;
}

/** ¿Puede usar una herramienta con esta exigencia? (`null` = cualquiera; lista = alguna). */
export function toolAllowed(who: ToolSubject, capability: Capability | readonly Capability[] | null): boolean {
    if (capability === null) return true;
    const subject = subjectOf(who);
    if (typeof capability === 'string') return can(subject, capability);
    return canAny(subject, capability);
}

/**
 * Lo que un módulo de afuera le suma a `get_list_schema` (E6: los agentes de
 * IA de la lista). Corre con quien habla; si falla, se omite.
 */
export type ListSchemaExtra = (ctx: AiToolContext, list: { id: number; slug: string }) => Promise<Record<string, unknown>>;

export class AiToolRegistry {
    private readonly tools = new Map<string, AiToolDef>();
    private readonly appliers = new Map<string, AiProposalApplier>();
    private readonly schemaExtras: ListSchemaExtra[] = [];

    /**
     * Quién aplica las propuestas de un `kind` que no vive en el asistente
     * (E6: `create_ai_agent`). Los de estructura, datos y aprobaciones siguen
     * resolviéndose en `ProposalsService`.
     */
    registerApplier(kinds: Iterable<string>, applier: AiProposalApplier): void {
        for (const k of kinds) this.appliers.set(k, applier);
    }

    applierFor(kind: string): AiProposalApplier | undefined {
        return this.appliers.get(kind);
    }

    addListSchemaExtra(fn: ListSchemaExtra): void {
        this.schemaExtras.push(fn);
    }

    /** Las extensiones de `get_list_schema`, juntas. Una que falla no rompe el esquema. */
    async listSchemaExtras(ctx: AiToolContext, list: { id: number; slug: string }): Promise<Record<string, unknown>> {
        const out: Record<string, unknown> = {};
        for (const fn of this.schemaExtras) {
            try {
                Object.assign(out, await fn(ctx, list));
            } catch {
                // Una extensión caída no le quita el esquema al modelo.
            }
        }
        return out;
    }

    register<I = unknown>(def: AiToolDef<I>): void {
        if (this.tools.has(def.name)) throw new Error(`Herramienta duplicada: ${def.name}`);
        this.tools.set(def.name, def as unknown as AiToolDef);
    }

    get(name: string): AiToolDef | undefined {
        return this.tools.get(name);
    }

    list(): AiToolDef[] {
        return [...this.tools.values()];
    }

    /** Herramientas que ESTE rol puede usar (las demás ni se le ofrecen al modelo). */
    listFor(who: ToolSubject): AiToolDef[] {
        return this.list().filter((t) => toolAllowed(who, t.capability));
    }

    /** Definiciones en el formato de la API de Anthropic (`input_schema` = JSON Schema). */
    toAnthropicTools(who: ToolSubject): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
        return this.listFor(who).map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: toInputSchema(t.input),
        }));
    }

    /**
     * Ejecuta una herramienta con validación de input y de capability. Los
     * errores esperables vuelven como `isError` para que el modelo corrija;
     * los inesperados se propagan.
     */
    async execute(ctx: AiToolContext, name: string, rawInput: unknown): Promise<AiToolResult> {
        const tool = this.tools.get(name);
        if (!tool) return { content: { error: `Herramienta desconocida: ${name}` }, isError: true };
        if (!toolAllowed(ctx, tool.capability)) {
            const needs = Array.isArray(tool.capability) ? tool.capability.join(' o ') : String(tool.capability);
            return {
                content: {
                    error: `Tu rol (${ctx.role}) no tiene permiso para esta acción (requiere ${needs}). Dile a la persona que un administrador puede hacerlo.`,
                },
                isError: true,
            };
        }
        const parsed = tool.input.safeParse(rawInput ?? {});
        if (!parsed.success) {
            return {
                content: {
                    error: 'Parámetros inválidos',
                    issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`),
                },
                isError: true,
            };
        }
        try {
            return await tool.run(ctx, parsed.data);
        } catch (err) {
            if (err instanceof AiToolError) return { content: { error: err.message }, isError: true };
            // Errores de dominio de los services (400/404/409 de Nest) también
            // son corregibles por el modelo: se le pasa el mensaje.
            const status = (err as { getStatus?: () => number }).getStatus?.();
            if (typeof status === 'number' && status < 500) {
                return { content: { error: describeHttpError(err) }, isError: true };
            }
            throw err;
        }
    }
}

function toInputSchema(schema: ZodTypeAny): Record<string, unknown> {
    // El tipo de retorno de la librería es un unión gigante que TypeScript
    // no llega a instanciar: aquí sólo importa que sea un objeto JSON.
    const convert = zodToJsonSchema as unknown as (s: ZodTypeAny, o: Record<string, unknown>) => Record<string, unknown>;
    const json = convert(schema, { $refStrategy: 'none', target: 'jsonSchema7' });
    // La API pide un objeto raíz sin `$schema`.
    delete json.$schema;
    if (json.type !== 'object') return { type: 'object', properties: {}, ...json };
    return json;
}

function describeHttpError(err: unknown): string {
    const resp = (err as { getResponse?: () => unknown }).getResponse?.();
    if (resp && typeof resp === 'object') {
        const r = resp as { message?: unknown; code?: unknown; data?: { errors?: Record<string, string> } };
        const parts: string[] = [];
        if (typeof r.message === 'string') parts.push(r.message);
        if (r.data?.errors) parts.push(Object.entries(r.data.errors).map(([k, v]) => `${k}: ${v}`).join('; '));
        if (parts.length > 0) return parts.join(' — ');
    }
    return err instanceof Error ? err.message : String(err);
}

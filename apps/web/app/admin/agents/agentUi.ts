import type { AiAgentRunStatus, AiAgentStepKind } from '@imagina-base/shared';

import { listIcon, type ListIconComponent } from '@/lib/listIcons';

import { __ } from '@/lib/i18n';

/** Icono de un agente: el elegido o el robot del catálogo. */
export function agentIcon(key: string | null | undefined): ListIconComponent {
    return listIcon(key) ?? listIcon('robot')!;
}

/** Color de un agente (hex) o el del tema. */
export function agentColor(color: string | null | undefined): string | undefined {
    return typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined;
}

/** Clase de color del chip de estado de una corrida. */
export function runStatusTone(status: AiAgentRunStatus): 'success' | 'warning' | 'destructive' | 'info' | 'secondary' {
    switch (status) {
        case 'success':
            return 'success';
        case 'failed':
            return 'destructive';
        case 'stopped':
        case 'skipped':
            return 'warning';
        case 'queued':
        case 'running':
            return 'info';
        default:
            return 'secondary';
    }
}

/** Qué fue cada paso, en una palabra. */
export function stepKindLabel(kind: AiAgentStepKind): string {
    switch (kind) {
        case 'read':
            return __('Leyó');
        case 'write':
            return __('Escribió');
        case 'proposed':
            return __('Propuso');
        case 'simulated':
            return __('Simulado');
        case 'blocked':
            return __('Bloqueado');
        case 'error':
            return __('Error');
    }
}

export function stepKindTone(kind: AiAgentStepKind): 'success' | 'warning' | 'destructive' | 'info' | 'secondary' {
    switch (kind) {
        case 'write':
            return 'success';
        case 'proposed':
        case 'simulated':
            return 'info';
        case 'blocked':
            return 'warning';
        case 'error':
            return 'destructive';
        default:
            return 'secondary';
    }
}

/** Tokens en forma corta: 1.234 → «1,2 mil», 2.000.000 → «2 M». */
export function shortTokens(n: number): string {
    if (n >= 1_000_000) return `${(Math.round(n / 100_000) / 10).toString().replace('.', ',')} M`;
    if (n >= 1_000) return `${(Math.round(n / 100) / 10).toString().replace('.', ',')} mil`;
    return String(n);
}

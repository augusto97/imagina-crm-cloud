import type { TemplateRoleField } from '@imagina-base/shared';

import type { Tone } from '@/admin/learn/content/types';

/**
 * Galería de ideas (v0.1.323, ADR-S76): casos de uso concretos que la persona
 * puede ACTIVAR sobre sus propias listas, no sólo leer. Cada idea es un DATO:
 * qué resuelve, cómo funciona en tres o cuatro pasos y qué crea al activarla.
 *
 * Hay cuatro formas de activar:
 *
 *   - `automations`: una o varias automatizaciones escritas con ROLES en vez de
 *     campos (la key del rol ocupa el lugar del slug, igual que las recetas de
 *     v0.1.167). Se elige la lista, se sugiere qué campo cumple cada rol y se
 *     contestan dos o tres preguntas con valores por defecto: con eso se GUARDAN
 *     activas, sin pasar por el editor (aunque siempre se puede abrir ahí).
 *   - `list`: crea listas desde una plantilla del sistema (con datos de ejemplo).
 *   - `dashboard`: arma un tablero desde una plantilla sobre una lista elegida.
 *   - `go`: lleva a la pantalla donde se configura (un formulario, la agenda, el
 *     portal…) — cosas que piden decisiones que no tienen un buen valor por
 *     defecto. Igual explican y muestran.
 */

export type IdeaCategory = 'ventas' | 'cobros' | 'clientes' | 'proyectos' | 'agenda' | 'tienda' | 'equipo' | 'conectar';

export interface IdeaCategoryMeta {
    id: IdeaCategory;
    label: string;
    description: string;
    icon: string;
    tone: Tone;
}

/**
 * Valor de una pregunta dentro del cuerpo de una automatización: el objeto
 * `{ $q: 'key' }` se reemplaza ENTERO por la respuesta (puede ser un número,
 * un texto, una lista…). Es el mismo truco de los tokens `{ $field }` de las
 * plantillas de lista: estructural, sin interpolar texto.
 */
export interface IdeaAnswerRef {
    $q: string;
}

interface QuestionBase {
    key: string;
    label: string;
    help?: string;
}

/**
 * Lo que la idea le pregunta a la persona. Todas traen un valor por defecto
 * razonable, así el caso común es UN clic en «Activar».
 */
export type IdeaQuestion =
    /**
     * Un correo. Por defecto el de la persona que activa (lo más útil para
     * avisos internos). Con `personRole`, si ese rol (un campo Persona) tiene
     * campo, se ofrece y se elige «Al responsable del registro».
     */
    | (QuestionBase & { kind: 'email'; personRole?: string })
    /**
     * Una opción del campo que cumple `role` (un select). `guess` son palabras
     * para adivinar la opción por su etiqueta («pend», «pagad»…). Con `multiple`,
     * la respuesta es una lista de valores.
     */
    | (QuestionBase & { kind: 'option'; role: string; guess: string[]; multiple?: boolean })
    /**
     * Una cantidad de días. La respuesta llega convertida: en minutos si
     * `unit: 'minutes'` (los `offset_minutes` de los disparadores), con signo
     * negativo si `before` (antes de la fecha).
     */
    | (QuestionBase & { kind: 'days'; default: number; unit: 'minutes' | 'days'; before?: boolean })
    /** Un texto libre (un mensaje, un asunto). */
    | (QuestionBase & { kind: 'text'; default: string; multiline?: boolean })
    /** Una dirección web (para un webhook). Sin valor por defecto: hay que pegarla. */
    | (QuestionBase & { kind: 'url'; placeholder: string })
    /** Una conexión de una de estas apps de la galería de integraciones. */
    | (QuestionBase & { kind: 'connection'; apps: string[] })
    /** Elegir entre opciones fijas. */
    | (QuestionBase & { kind: 'choice'; default: string; options: Array<{ value: string; label: string }> });

/**
 * Un paso de una automatización de la idea. Igual que una acción normal,
 * más una acción especial, `$message`, que se convierte en la acción de la
 * app de mensajería ELEGIDA (WhatsApp, Telegram o Slack piden datos con
 * nombres distintos: `recipient`/`message`, `chat_id`/`text`…).
 */
export interface IdeaAction {
    type: string;
    config: Record<string, unknown>;
    condition?: unknown;
}

export interface IdeaAutomation {
    name: string;
    description: string;
    trigger_type: string;
    trigger_config: Record<string, unknown>;
    actions: IdeaAction[];
}

export type IdeaPlan =
    | {
          kind: 'automations';
          roles: TemplateRoleField[];
          questions: IdeaQuestion[];
          automations: IdeaAutomation[];
      }
    | { kind: 'list'; template: string; listName?: string }
    | { kind: 'dashboard'; template: string; name: string }
    | { kind: 'go'; to: string; label: string; capability?: string };

export interface IdeaDef {
    id: string;
    category: IdeaCategory;
    title: string;
    /** Una línea: lo que gana la persona. */
    summary: string;
    /** El problema que resuelve, en una o dos oraciones. */
    problem: string;
    /** Cómo funciona, paso por paso (3-5). */
    steps: string[];
    /** Una ilustración del centro de aprendizaje (la clave de `illustrations/items`). */
    illustration: string;
    icon: string;
    tone: Tone;
    /** Palabras para sugerir en qué lista activarla («factura», «cobro»…). */
    listHints?: string[];
    /** Apps de la galería que hacen falta conectadas antes (claves de integración). */
    needsApps?: string[];
    /** Etiquetas para la búsqueda. */
    keywords?: string;
    /** Artículo del manual que lo explica a fondo: `modulo/articulo`. */
    learn?: string;
    /** Destacada en la portada de la galería. */
    featured?: boolean;
    plan: IdeaPlan;
}

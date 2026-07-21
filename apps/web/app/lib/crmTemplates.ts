import type { ComponentType } from 'react';
import {
    Briefcase,
    Building2,
    Calendar,
    CircleUser,
    Database,
    DollarSign,
    LifeBuoy,
    Mail,
    StickyNote,
    Tag,
    Target,
    User,
} from 'lucide-react';

import { pickPrimaryField } from '@/lib/recordCategorize';
import type { FieldEntity } from '@/types/field';

/**
 * Sistema de plantillas para el layout CRM panel.
 *
 * Una plantilla define **dónde va cada campo** en la ficha individual:
 * cuáles son status pills del header, cuáles son quick actions, en qué
 * grupo del sidebar aparece cada propiedad. Hasta ahora (0.31) el
 * `RecordCrmLayout` hardcodeaba la heurística — ahora la elige el
 * usuario por lista.
 *
 * **Modelo:** una plantilla expone una función `resolve(fields)` que
 * devuelve un `ResolvedLayout` — la estructura concreta con los
 * `FieldEntity` agrupados y ordenados. Los componentes (`RecordHeader`,
 * `PropertiesSidebar`) consumen `ResolvedLayout`, no `FieldEntity[]`.
 *
 * **Built-in templates (0.32.0):**
 *  - `auto` — la heurística conservadora original. Default.
 *  - `contact` — optimizada para personas/empresas (email/phone destacados).
 *  - `deal` — venta/oportunidad (monto + pipeline al frente).
 *  - `task` — tarea (fecha + estado + asignación).
 *  - `support` — ticket de soporte (cliente + prioridad).
 *
 * **Custom templates (0.34.0 — futuro):** el editor visual generará
 * un objeto serializable con slugs explícitos, que un resolver
 * convertirá al mismo `ResolvedLayout`. Misma capa de consumo, así
 * que esta arquitectura no se tira a la basura cuando llegue.
 */

export type IconName = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
export type ContactKind = 'email' | 'phone' | 'url';

export interface QuickActionEntry {
    field: FieldEntity;
    kind: ContactKind;
}

export interface SidebarGroup {
    id: string;
    label: string;
    icon: IconName;
    fields: FieldEntity[];
    collapsedByDefault: boolean;
}

/**
 * Bloques del right rail (Phase B 0.33.0). Cada plantilla declara qué
 * bloques quiere renderear; los componentes que renderean el rail
 * tipan exhaustivamente el `kind`.
 */
export type RightRailBlock =
    | { id: string; kind: 'stats' }
    | { id: string; kind: 'related'; field: FieldEntity };

export interface ResolvedLayout {
    /** Campo cuyo valor es el título grande del header. */
    titleField: FieldEntity | null;
    /** Campos que aparecen como "subtítulo" debajo del título (ej. empresa, rol). */
    subtitleFields: FieldEntity[];
    /** Status pills en el header (auto-rendereados como Badge con color de la option si tiene). */
    statusFields: FieldEntity[];
    /** Botones de acción rápida (mailto, tel, abrir url). */
    quickActions: QuickActionEntry[];
    /** Cards colapsables del sidebar izquierdo. Vacíos no se renderean. */
    sidebarGroups: SidebarGroup[];
    /** Bloques del right rail (stats, related records). */
    rightRail: RightRailBlock[];
    /** Fields que NO entraron en ningún slot. Renderea como "Otros" colapsado. */
    leftover: FieldEntity[];
}

export interface CrmTemplate {
    id: string;
    name: string;
    description: string;
    /** V1 resolver (legacy, kept para migración de V1 customs viejos). */
    resolve: (fields: FieldEntity[]) => ResolvedLayout;
    /** V2 resolver: produce el grid layout específico de esta plantilla.
     *  Las built-ins definen layouts visiblemente distintos (cols, posiciones,
     *  tamaños) — no son idénticas pasando por la misma migración genérica.
     *  Si no se define, cae a `migrateV1toV2(layoutToV1Config(resolve(...)))`. */
    resolveV2?: (fields: FieldEntity[]) => CustomTemplateConfigV2;
}

// --- helpers compartidos -----------------------------------------------------

const PHONE_PATTERNS = [/\b(phone|tel|telefono|teléfono|celular|movil|móvil|whatsapp|wsp|sms|fax)\b/i];
const ADDRESS_PATTERNS = [/\b(address|direccion|dirección|calle|street|ciudad|city|pais|país|country)\b/i];
const COMPANY_PATTERNS = [/\b(company|empresa|organization|organizacion|organización|business|cliente)\b/i];
const ROLE_PATTERNS = [/\b(role|rol|cargo|position|puesto|title|job)\b/i];
const STAGE_PATTERNS = [/\b(stage|etapa|pipeline|fase)\b/i];
const PRIORITY_PATTERNS = [/\b(priority|prioridad|urgency|urgencia)\b/i];
const TICKET_PATTERNS = [/\b(ticket|case|caso|incident|incidente)\b/i];

function matches(field: FieldEntity, patterns: RegExp[]): boolean {
    const haystack = field.slug + ' ' + field.label;
    return patterns.some((re) => re.test(haystack));
}

function isStatusLike(field: FieldEntity): boolean {
    if (field.type === 'checkbox') return true;
    if (field.type !== 'select' && field.type !== 'multi_select') return false;
    const opts = (field.config as { options?: unknown[] }).options;
    return Array.isArray(opts) && opts.length > 0 && opts.length <= 8;
}

function isPhoneLike(f: FieldEntity): boolean {
    return f.type === 'text' && matches(f, PHONE_PATTERNS);
}

function isContactKind(f: FieldEntity): ContactKind | null {
    if (f.type === 'email') return 'email';
    if (f.type === 'url') return 'url';
    if (isPhoneLike(f)) return 'phone';
    return null;
}

/**
 * Helper para construir un `ResolvedLayout` consumiendo fields uno a uno
 * sin duplicar. Cada `pick*` llama y marca los fields como usados.
 */
class LayoutBuilder {
    private used = new Set<number>();

    constructor(private readonly fields: FieldEntity[]) {}

    private take(field: FieldEntity): void {
        this.used.add(field.id);
    }

    private isAvailable(field: FieldEntity): boolean {
        return ! this.used.has(field.id) && field.type !== 'relation';
    }

    pickTitle(): FieldEntity | null {
        const title = pickPrimaryField(this.fields);
        if (title) this.take(title);
        return title;
    }

    /** Toma los fields que matcheen el predicate y los devuelve. */
    pickAll(predicate: (f: FieldEntity) => boolean, limit?: number): FieldEntity[] {
        const out: FieldEntity[] = [];
        for (const f of [...this.fields].sort((a, b) => a.position - b.position)) {
            if (! this.isAvailable(f)) continue;
            if (! predicate(f)) continue;
            out.push(f);
            this.take(f);
            if (limit !== undefined && out.length >= limit) break;
        }
        return out;
    }

    /** Quick actions: email/phone/url presentes (todos), preserva orden de declaración. */
    pickQuickActions(): QuickActionEntry[] {
        const out: QuickActionEntry[] = [];
        for (const f of [...this.fields].sort((a, b) => a.position - b.position)) {
            if (! this.isAvailable(f)) continue;
            const kind = isContactKind(f);
            if (kind === null) continue;
            out.push({ field: f, kind });
            this.take(f);
        }
        return out;
    }

    pickStatusFields(): FieldEntity[] {
        return this.pickAll(isStatusLike);
    }

    /** Devuelve un `SidebarGroup` solo si hay fields para mostrar; sino devuelve null. */
    group(
        id: string,
        label: string,
        icon: IconName,
        predicate: (f: FieldEntity) => boolean,
        opts: { collapsedByDefault?: boolean } = {},
    ): SidebarGroup | null {
        const picked = this.pickAll(predicate);
        if (picked.length === 0) return null;
        return {
            id,
            label,
            icon,
            fields: picked,
            collapsedByDefault: opts.collapsedByDefault ?? false,
        };
    }

    leftover(): FieldEntity[] {
        return this.fields
            .filter((f) => this.isAvailable(f))
            .sort((a, b) => a.position - b.position);
    }

    /**
     * Construye el array de right rail blocks según una receta básica:
     *   - 1 block de stats (siempre, cuando `withStats=true`).
     *   - 1 block "related" por cada `relation` field del list.
     *
     * Las plantillas pueden invocar este helper o componer los blocks
     * a mano si necesitan algo distinto.
     */
    buildRightRail(opts: { withStats?: boolean } = {}): RightRailBlock[] {
        const { withStats = true } = opts;
        const blocks: RightRailBlock[] = [];
        if (withStats) {
            blocks.push({ id: 'stats', kind: 'stats' });
        }
        for (const f of this.fields) {
            if (f.type === 'relation') {
                blocks.push({ id: `related-${f.id}`, kind: 'related', field: f });
            }
        }
        return blocks;
    }
}

// --- V2 builder helpers ------------------------------------------------------

/**
 * Cells declarables para `V2Builder.row()`. Cada cell tiene `weight`
 * (peso relativo dentro del row, ~12 sumando si querés ocupar todo)
 * y opcionalmente `height` (filas verticales — default = altura del
 * row).
 *
 * Si una cell no se materializa (ej. `group` con 0 fields), se omite
 * y el resto de cells redistribuyen su weight para llenar el row sin
 * dejar gaps en col 0.
 *
 * `height` per-cell evita que bloques cortos (stats, notes, groups
 * con pocos fields) hereden una altura grande del row solo porque
 * comparten fila con un bloque alto (timeline). Cuando los cells
 * tienen alturas mixtas, `currentY` avanza al MAX de (y + h) de las
 * cells presentes — la row siguiente arranca recién cuando termina
 * el cell más alto.
 */
export type RowCellSpec =
    | { kind: 'group'; id: string; label: string; iconKey: string; weight: number; height?: number;
        predicate: (f: FieldEntity) => boolean; collapsedByDefault?: boolean }
    | { kind: 'leftover-group'; id: string; label: string; iconKey: string; weight: number; height?: number;
        collapsedByDefault?: boolean }
    | { kind: 'stats'; weight: number; height?: number }
    | { kind: 'timeline'; weight: number; height?: number }
    | { kind: 'notes'; id?: string; weight: number; height?: number; title: string; content: string }
    | { kind: 'related'; weight: number; height?: number; fieldSlug: string };

/**
 * Mini-DSL para construir un `CustomTemplateConfigV2` desde una
 * plantilla built-in. Evita repetir el boilerplate de pickear
 * fields, marcar como usados, generar header + blocks. Cada
 * built-in lo usa dentro de su `resolveV2`.
 */
class V2Builder {
    private used = new Set<number>();
    private blocks: V2Block[] = [];
    /** Cursor Y para `row()` y `autoRelatedRows()` — auto-incrementa. */
    private currentY = 0;
    private headerSpec: CustomTemplateConfigV2['header'] = {
        subtitle_field_slugs: [],
        status_field_slugs: [],
        quick_action_field_slugs: [],
    };

    constructor(private readonly fields: FieldEntity[]) {}

    private isAvail(f: FieldEntity): boolean {
        return ! this.used.has(f.id) && f.type !== 'relation';
    }

    private take(f: FieldEntity): FieldEntity {
        this.used.add(f.id);
        return f;
    }

    /** Pick title (primary or first text). */
    setAutoTitle(): this {
        const f = pickPrimaryField(this.fields);
        if (f) {
            this.headerSpec.title_field_slug = this.take(f).slug;
        }
        return this;
    }

    /** Subtitle: hasta `limit` fields que matcheen el predicado. */
    addSubtitleByPattern(predicate: (f: FieldEntity) => boolean, limit = 1): this {
        for (const f of this.fields) {
            if (! this.isAvail(f) || ! predicate(f)) continue;
            this.headerSpec.subtitle_field_slugs.push(this.take(f).slug);
            if (this.headerSpec.subtitle_field_slugs.length >= limit) break;
        }
        return this;
    }

    /** Status pills: select-likes con ≤8 opciones. */
    autoStatus(): this {
        for (const f of [...this.fields].sort((a, b) => a.position - b.position)) {
            if (! this.isAvail(f) || ! isStatusLike(f)) continue;
            this.headerSpec.status_field_slugs.push(this.take(f).slug);
        }
        return this;
    }

    /** Quick actions: email/url/phone-like. */
    autoQuickActions(): this {
        for (const f of [...this.fields].sort((a, b) => a.position - b.position)) {
            if (! this.isAvail(f)) continue;
            if (f.type === 'email' || f.type === 'url' || isPhoneLike(f)) {
                this.headerSpec.quick_action_field_slugs.push(this.take(f).slug);
            }
        }
        return this;
    }

    /**
     * Pushea un block de tipo `properties_group`. Toma todos los
     * fields availables que matcheen el predicado y los mete en el
     * grupo (los marca como usados para que no se repitan).
     */
    propertiesGroup(spec: {
        id: string;
        label: string;
        iconKey: string;
        x: number; y: number; w: number; h: number;
        predicate: (f: FieldEntity) => boolean;
        collapsedByDefault?: boolean;
    }): this {
        const fieldSlugs: string[] = [];
        for (const f of [...this.fields].sort((a, b) => a.position - b.position)) {
            if (! this.isAvail(f)) continue;
            if (! spec.predicate(f)) continue;
            fieldSlugs.push(this.take(f).slug);
        }
        // Solo agregamos el grupo si tiene fields — sino el grid
        // muestra cards vacías que confunden.
        if (fieldSlugs.length === 0) return this;
        this.blocks.push({
            id: spec.id,
            type: 'properties_group',
            x: spec.x, y: spec.y, w: spec.w, h: spec.h,
            config: {
                label: spec.label,
                icon_key: spec.iconKey,
                field_slugs: fieldSlugs,
                collapsed_by_default: spec.collapsedByDefault ?? false,
            },
        });
        return this;
    }

    /**
     * Como propertiesGroup pero acepta los campos sobrantes (que no
     * fueron tomados por nadie). Útil para una "catch-all" group al
     * final del layout para no perder fields.
     */
    leftoverGroup(spec: {
        id: string;
        label: string;
        iconKey: string;
        x: number; y: number; w: number; h: number;
        collapsedByDefault?: boolean;
    }): this {
        return this.propertiesGroup({
            ...spec,
            predicate: () => true,
        });
    }

    timeline(spec: { x: number; y: number; w: number; h: number }): this {
        this.blocks.push({
            id: 'timeline', type: 'timeline',
            x: spec.x, y: spec.y, w: spec.w, h: spec.h,
            config: {},
        });
        return this;
    }

    stats(spec: { x: number; y: number; w: number; h: number }): this {
        this.blocks.push({
            id: 'stats', type: 'stats',
            x: spec.x, y: spec.y, w: spec.w, h: spec.h,
            config: {},
        });
        return this;
    }

    /** Un bloque `related` por cada relation field, en columna+y secuencial. */
    autoRelated(spec: { x: number; startY: number; w: number; h: number }): this {
        let y = spec.startY;
        for (const f of this.fields) {
            if (f.type !== 'relation') continue;
            this.blocks.push({
                id: `related-${f.id}`, type: 'related',
                x: spec.x, y, w: spec.w, h: spec.h,
                config: { field_slug: f.slug },
            });
            y += spec.h;
        }
        return this;
    }

    notes(spec: {
        id?: string;
        title: string;
        content: string;
        x: number; y: number; w: number; h: number;
    }): this {
        this.blocks.push({
            id: spec.id ?? 'notes',
            type: 'notes',
            x: spec.x, y: spec.y, w: spec.w, h: spec.h,
            config: { title: spec.title, content: spec.content },
        });
        return this;
    }

    /**
     * Row-based placement (0.35.3+): declarás cells con `weight`
     * (relativo, normalmente sumando ~12). El builder:
     *   1. Materializa cada cell — si una `group` no tiene fields
     *      disponibles, SE OMITE.
     *   2. Calcula widths proporcionales SOLO entre las cells
     *      presentes — sin huecos en col 0.
     *   3. Asigna y/h del row, x secuencial, w proporcional.
     *
     * Esto reemplaza el modelo de "posiciones fijas" que dejaba
     * columnas vacías cuando un grupo del template no aplicaba a la
     * lista del user.
     */
    row(spec: { height: number; cells: RowCellSpec[] }): this {
        const placed: Array<{ block: V2Block; weight: number; height: number }> = [];
        for (const cell of spec.cells) {
            const block = this.materializeCell(cell);
            if (block !== null) {
                placed.push({
                    block,
                    weight: Math.max(1, cell.weight),
                    // Per-cell height fallback al row's height. Ej.
                    // stats con h=4 dentro de row con h=12 (timeline)
                    // → stats solo ocupa 4 verticales; timeline 12.
                    height: cell.height ?? spec.height,
                });
            }
        }
        if (placed.length === 0) return this;

        const totalWeight = placed.reduce((s, p) => s + p.weight, 0);
        let x = 0;
        let maxBottom = this.currentY;
        for (let i = 0; i < placed.length; i++) {
            const { block, weight, height } = placed[i]!;
            const isLast = i === placed.length - 1;
            // Min width: 3 cols. Última cell absorbe leftover/deficit
            // del rounding para que el row siempre llene los 12 cols.
            let w = Math.max(3, Math.round((weight / totalWeight) * 12));
            if (isLast) {
                w = Math.max(3, 12 - x);
            } else if (x + w > 12 - 3 * (placed.length - 1 - i)) {
                w = 12 - x - 3 * (placed.length - 1 - i);
            }
            block.x = x;
            block.y = this.currentY;
            block.w = w;
            block.h = height;
            this.blocks.push(block);
            x += w;
            maxBottom = Math.max(maxBottom, this.currentY + height);
        }
        // El próximo row empieza donde termina el cell más alto, no
        // donde termina el row "intended". Esto compacta verticalmente
        // cuando todas las cells son cortas.
        this.currentY = maxBottom;
        return this;
    }

    /**
     * **Column-based placement (0.36.2+)**: cada column tiene un
     * `width` fijo (cols 1-12) y blocks apilados verticalmente.
     * Cuando una column tiene blocks cortos junto a una con un
     * block alto (ej. Timeline), los cortos se apilan en su columna
     * sin dejar gap vertical hasta el final del alto.
     *
     * Ej. Soporte: col izq apila [Detalles, Runbook]; col centro
     * tiene [Cliente, Timeline]; col der apila [Asignación, Fechas,
     * Métricas]. Con esto, el gap bajo Detalles se llena con
     * Runbook automáticamente, no queda espacio vacío.
     *
     * Si un block dentro de una columna no se materializa (predicate
     * vacío), se omite y los siguientes en esa misma columna se
     * suben verticalmente para llenar.
     *
     * Anchos de columnas no proporcionales — cada uno declara su
     * width literal en cols. Si la suma > 12, se trunca.
     */
    columns(specs: Array<{
        width: number;
        blocks: Array<RowCellSpec & { height: number }>;
    }>): this {
        // Pass 1: materializar todos los blocks por columna. Si una
        // columna no produce ningún block (todos los predicados
        // vacíos), se omite — su width NO cuenta para el reparto.
        // Esto evita "columnas vacías" cuando la lista del user no
        // tiene fields que matcheen los grupos de esa columna.
        const cols = specs.map((col) => {
            const blocks: Array<{ block: V2Block; height: number }> = [];
            for (const blockSpec of col.blocks) {
                const block = this.materializeCell(blockSpec);
                if (! block) continue;
                blocks.push({ block, height: blockSpec.height });
            }
            return { declaredWidth: col.width, blocks };
        });

        const present = cols.filter((c) => c.blocks.length > 0);
        if (present.length === 0) return this;

        // Pass 2: redistribuir 12 cols proporcionalmente al
        // declaredWidth de las columnas presentes (mismo enfoque que
        // row() con weight). Min 3 cols por columna; última absorbe
        // leftover/deficit del rounding.
        const totalDeclared = present.reduce((s, c) => s + c.declaredWidth, 0);
        let xCursor = 0;
        let maxBottom = this.currentY;
        for (let i = 0; i < present.length; i++) {
            const col = present[i]!;
            const isLast = i === present.length - 1;
            let w = Math.max(3, Math.round((col.declaredWidth / totalDeclared) * 12));
            if (isLast) {
                w = Math.max(3, 12 - xCursor);
            } else if (xCursor + w > 12 - 3 * (present.length - 1 - i)) {
                w = 12 - xCursor - 3 * (present.length - 1 - i);
            }
            let yCursor = this.currentY;
            for (const { block, height } of col.blocks) {
                block.x = xCursor;
                block.y = yCursor;
                block.w = w;
                block.h = height;
                this.blocks.push(block);
                yCursor += height;
            }
            maxBottom = Math.max(maxBottom, yCursor);
            xCursor += w;
        }
        this.currentY = maxBottom;
        return this;
    }

    /**
     * Helper para placement vertical de relacionados (1 block por
     * relation field). Se llama después de los `row()`s — ocupa
     * la zona inferior con un ancho fijo. Si querés relacionados
     * inline en una row, usá `cell.kind === 'related'`.
     */
    autoRelatedRows(spec: { width: number; height: number }): this {
        for (const f of this.fields) {
            if (f.type !== 'relation') continue;
            const w = Math.min(12, Math.max(3, spec.width));
            this.blocks.push({
                id: `related-${f.id}`,
                type: 'related',
                x: 0, y: this.currentY, w, h: spec.height,
                config: { field_slug: f.slug },
            });
            this.currentY += spec.height;
        }
        return this;
    }

    private materializeCell(cell: RowCellSpec): V2Block | null {
        if (cell.kind === 'group') {
            const fieldSlugs: string[] = [];
            for (const f of [...this.fields].sort((a, b) => a.position - b.position)) {
                if (! this.isAvail(f) || ! cell.predicate(f)) continue;
                fieldSlugs.push(this.take(f).slug);
            }
            if (fieldSlugs.length === 0) return null;
            return {
                id: cell.id,
                type: 'properties_group',
                x: 0, y: 0, w: 0, h: 0,
                config: {
                    label: cell.label,
                    icon_key: cell.iconKey,
                    field_slugs: fieldSlugs,
                    collapsed_by_default: cell.collapsedByDefault ?? false,
                },
            };
        }
        if (cell.kind === 'leftover-group') {
            const fieldSlugs: string[] = [];
            for (const f of [...this.fields].sort((a, b) => a.position - b.position)) {
                if (! this.isAvail(f)) continue;
                fieldSlugs.push(this.take(f).slug);
            }
            if (fieldSlugs.length === 0) return null;
            return {
                id: cell.id,
                type: 'properties_group',
                x: 0, y: 0, w: 0, h: 0,
                config: {
                    label: cell.label,
                    icon_key: cell.iconKey,
                    field_slugs: fieldSlugs,
                    collapsed_by_default: cell.collapsedByDefault ?? true,
                },
            };
        }
        if (cell.kind === 'stats') {
            return { id: 'stats', type: 'stats', x: 0, y: 0, w: 0, h: 0, config: {} };
        }
        if (cell.kind === 'timeline') {
            return { id: 'timeline', type: 'timeline', x: 0, y: 0, w: 0, h: 0, config: {} };
        }
        if (cell.kind === 'notes') {
            return {
                id: cell.id ?? 'notes',
                type: 'notes',
                x: 0, y: 0, w: 0, h: 0,
                config: { title: cell.title, content: cell.content },
            };
        }
        if (cell.kind === 'related') {
            const f = this.fields.find((x) => x.slug === cell.fieldSlug);
            if (! f || f.type !== 'relation') return null;
            return {
                id: `related-${f.id}`,
                type: 'related',
                x: 0, y: 0, w: 0, h: 0,
                config: { field_slug: f.slug },
            };
        }
        return null;
    }

    build(): CustomTemplateConfigV2 {
        return {
            v: 2,
            header: this.headerSpec,
            blocks: this.blocks,
        };
    }
}

// --- built-in templates -------------------------------------------------------

const autoTemplate: CrmTemplate = {
    id: 'auto',
    name: 'Automática',
    description: 'Categorización conservadora por tipo de campo. 3 columnas balanceadas.',
    resolve: (fields) => {
        const b = new LayoutBuilder(fields);
        const titleField = b.pickTitle();
        const statusFields = b.pickStatusFields();
        const quickActions = b.pickQuickActions();

        const groups: SidebarGroup[] = [];
        const contact = b.group('contact', 'Contacto', Mail, (f) =>
            f.type === 'email' || f.type === 'url' || isPhoneLike(f) || matches(f, ADDRESS_PATTERNS),
        );
        const keyData = b.group('key_data', 'Datos clave', Briefcase, (f) =>
            f.type === 'currency' || f.type === 'number' || f.type === 'date' || f.type === 'datetime',
        );
        const assignment = b.group('assignment', 'Asignación', CircleUser, (f) => f.type === 'user');
        const otherStatus = b.group('status_other', 'Estado adicional', Tag, isStatusLike);

        if (contact) groups.push(contact);
        if (otherStatus) groups.push(otherStatus);
        if (keyData) groups.push(keyData);
        if (assignment) groups.push(assignment);

        return {
            titleField,
            subtitleFields: [],
            statusFields,
            quickActions,
            sidebarGroups: groups,
            rightRail: b.buildRightRail(),
            leftover: b.leftover(),
        };
    },
    /**
     * V2 layout (row-based): timeline + stats arriba; abajo grupos.
     * Cuando un grupo no aplica (ej. lista sin user fields →
     * Asignación vacío), las cells presentes redistribuyen el row
     * para no dejar gaps en col 0.
     */
    resolveV2: (fields) => new V2Builder(fields)
        .setAutoTitle()
        .autoStatus()
        .autoQuickActions()
        // 3 columnas balanceadas verticalmente (cada col suma h=12).
        // Bloques cortos (stats, contacto, asignación) se apilan en
        // sus columnas mientras Timeline ocupa la altura central.
        // El last block de cada col incluye un filler (notes/leftover)
        // para que ninguna columna quede más corta que las otras.
        .columns([
            {
                width: 4,
                blocks: [
                    {
                        kind: 'group', id: 'g-key-data', label: 'Datos clave', iconKey: 'briefcase',
                        weight: 1, height: 5,
                        predicate: (f) =>
                            f.type === 'currency' || f.type === 'number'
                            || f.type === 'date' || f.type === 'datetime',
                    },
                    {
                        kind: 'group', id: 'g-contact', label: 'Contacto', iconKey: 'mail',
                        weight: 1, height: 4,
                        predicate: (f) => f.type === 'email' || f.type === 'url' || isPhoneLike(f),
                    },
                    {
                        kind: 'group', id: 'g-assignment', label: 'Asignación', iconKey: 'circle_user',
                        weight: 1, height: 3,
                        predicate: (f) => f.type === 'user',
                    },
                ],
            },
            {
                width: 5,
                blocks: [
                    { kind: 'timeline', weight: 1, height: 12 },
                ],
            },
            {
                width: 3,
                blocks: [
                    { kind: 'stats', weight: 1, height: 4 },
                    {
                        kind: 'notes', id: 'notes-default', weight: 1, height: 8,
                        title: 'Notas',
                        content: 'Notas internas sobre este registro. Editá el bloque para personalizar.',
                    },
                ],
            },
        ])
        .autoRelatedRows({ width: 12, height: 4 })
        .row({
            height: 4,
            cells: [
                {
                    kind: 'leftover-group',
                    id: 'g-other',
                    label: 'Otros',
                    iconKey: 'database',
                    weight: 12,
                    collapsedByDefault: true,
                },
            ],
        })
        .build(),
};

const contactTemplate: CrmTemplate = {
    id: 'contact',
    name: 'Contacto',
    description: 'Personas y empresas. Email/teléfono al frente, empresa y rol en su propio grupo.',
    resolve: (fields) => {
        const b = new LayoutBuilder(fields);
        const titleField = b.pickTitle();

        // Subtitle: empresa + rol si existen, en ese orden.
        const subtitleFields = [
            ...b.pickAll((f) => f.type === 'text' && matches(f, COMPANY_PATTERNS), 1),
            ...b.pickAll((f) => f.type === 'text' && matches(f, ROLE_PATTERNS), 1),
        ];

        const statusFields = b.pickStatusFields();
        const quickActions = b.pickQuickActions();

        const groups: SidebarGroup[] = [];
        const contact = b.group('contact', 'Contacto', Mail, (f) =>
            f.type === 'email' || f.type === 'url' || isPhoneLike(f) || matches(f, ADDRESS_PATTERNS),
        );
        const company = b.group('company', 'Empresa y rol', Building2, (f) =>
            f.type === 'text' && (matches(f, COMPANY_PATTERNS) || matches(f, ROLE_PATTERNS)),
        );
        const dates = b.group('dates', 'Fechas', Calendar, (f) =>
            f.type === 'date' || f.type === 'datetime',
        );
        const numeric = b.group('numbers', 'Datos numéricos', DollarSign, (f) =>
            f.type === 'number' || f.type === 'currency',
        );
        const assignment = b.group('assignment', 'Asignación', CircleUser, (f) => f.type === 'user');

        if (contact) groups.push(contact);
        if (company) groups.push(company);
        if (dates) groups.push(dates);
        if (numeric) groups.push(numeric);
        if (assignment) groups.push(assignment);

        return {
            titleField,
            subtitleFields,
            statusFields,
            quickActions,
            sidebarGroups: groups,
            rightRail: b.buildRightRail(),
            leftover: b.leftover(),
        };
    },
    /**
     * V2 layout (row-based):
     *  - Row 1 (h=5): Contacto + Empresa-rol + Stats.
     *  - Row 2 (h=10): Asignación + Timeline + Notes recordatorios.
     *  - Row 3+: relacionados (1 por row).
     *  - Row N: Otros (catch-all colapsado).
     */
    resolveV2: (fields) => new V2Builder(fields)
        .setAutoTitle()
        .addSubtitleByPattern((f) => f.type === 'text' && matches(f, COMPANY_PATTERNS), 1)
        .addSubtitleByPattern((f) => f.type === 'text' && matches(f, ROLE_PATTERNS), 1)
        .autoStatus()
        .autoQuickActions()
        // 3 cols balanceadas (cada una suma h=12).
        .columns([
            {
                width: 4,
                blocks: [
                    {
                        kind: 'group', id: 'g-contact', label: 'Contacto', iconKey: 'mail',
                        weight: 1, height: 5,
                        predicate: (f) =>
                            f.type === 'email' || f.type === 'url' || isPhoneLike(f) || matches(f, ADDRESS_PATTERNS),
                    },
                    {
                        kind: 'group', id: 'g-company', label: 'Empresa y rol', iconKey: 'building',
                        weight: 1, height: 4,
                        predicate: (f) =>
                            f.type === 'text' && (matches(f, COMPANY_PATTERNS) || matches(f, ROLE_PATTERNS)),
                    },
                    {
                        kind: 'group', id: 'g-assignment', label: 'Asignación', iconKey: 'circle_user',
                        weight: 1, height: 3,
                        predicate: (f) => f.type === 'user',
                    },
                ],
            },
            {
                width: 5,
                blocks: [
                    { kind: 'timeline', weight: 1, height: 12 },
                ],
            },
            {
                width: 3,
                blocks: [
                    { kind: 'stats', weight: 1, height: 4 },
                    {
                        kind: 'notes', id: 'notes-recordatorios', weight: 1, height: 4,
                        title: 'Recordatorios',
                        content: 'Notas internas sobre este contacto. Editá el bloque para personalizar.',
                    },
                    {
                        kind: 'notes', id: 'notes-proximos', weight: 1, height: 4,
                        title: 'Próximos pasos',
                        content: 'Acciones a seguir con este contacto.',
                    },
                ],
            },
        ])
        .autoRelatedRows({ width: 12, height: 4 })
        .row({
            height: 4,
            cells: [
                {
                    kind: 'leftover-group',
                    id: 'g-other',
                    label: 'Otros campos',
                    iconKey: 'database',
                    weight: 12,
                    collapsedByDefault: true,
                },
            ],
        })
        .build(),
};

const dealTemplate: CrmTemplate = {
    id: 'deal',
    name: 'Venta / Oportunidad',
    description: 'Pipeline al frente: monto destacado, etapa y prioridad como pills, contacto del cliente.',
    resolve: (fields) => {
        const b = new LayoutBuilder(fields);
        const titleField = b.pickTitle();

        // Status: stage + priority + otros status-like.
        const statusFields: FieldEntity[] = [
            ...b.pickAll((f) => isStatusLike(f) && matches(f, STAGE_PATTERNS), 1),
            ...b.pickAll((f) => isStatusLike(f) && matches(f, PRIORITY_PATTERNS), 1),
            ...b.pickStatusFields(),
        ];

        const quickActions = b.pickQuickActions();

        const groups: SidebarGroup[] = [];
        const monto = b.group('monto', 'Monto y métricas', DollarSign, (f) =>
            f.type === 'currency' || f.type === 'number',
        );
        const cliente = b.group('cliente', 'Cliente', User, (f) =>
            f.type === 'email' || f.type === 'url' || isPhoneLike(f) || matches(f, COMPANY_PATTERNS),
        );
        const fechas = b.group('fechas', 'Fechas clave', Calendar, (f) =>
            f.type === 'date' || f.type === 'datetime',
        );
        const assignment = b.group('assignment', 'Asignación', CircleUser, (f) => f.type === 'user');

        if (monto) groups.push(monto);
        if (cliente) groups.push(cliente);
        if (fechas) groups.push(fechas);
        if (assignment) groups.push(assignment);

        return {
            titleField,
            subtitleFields: [],
            statusFields,
            quickActions,
            sidebarGroups: groups,
            rightRail: b.buildRightRail(),
            leftover: b.leftover(),
        };
    },
    /**
     * V2 layout (row-based):
     *  - Row 1 (h=4): Monto (peso grande) + Stats.
     *  - Row 2 (h=10): Cliente + Timeline + Fechas.
     *  - Row 3 (h=4): Asignación.
     *  - Row 4+: relacionados.
     *  - Row N: Otros.
     */
    resolveV2: (fields) => new V2Builder(fields)
        .setAutoTitle()
        .autoStatus()
        .autoQuickActions()
        // Top row: Monto destacado + Stats
        .row({
            height: 4,
            cells: [
                {
                    kind: 'group', id: 'g-monto', label: 'Monto y métricas', iconKey: 'dollar',
                    weight: 8, height: 4,
                    predicate: (f) => f.type === 'currency' || f.type === 'number',
                },
                { kind: 'stats', weight: 4, height: 4 },
            ],
        })
        // Main grid: 3 cols balanceadas (cada una suma h=12).
        .columns([
            {
                width: 3,
                blocks: [
                    {
                        kind: 'group', id: 'g-cliente', label: 'Cliente', iconKey: 'user',
                        weight: 1, height: 5,
                        predicate: (f) =>
                            f.type === 'email' || f.type === 'url' || isPhoneLike(f) || matches(f, COMPANY_PATTERNS),
                    },
                    {
                        kind: 'group', id: 'g-assignment', label: 'Asignación', iconKey: 'circle_user',
                        weight: 1, height: 3,
                        predicate: (f) => f.type === 'user',
                    },
                    {
                        kind: 'notes', id: 'notes-historial', weight: 1, height: 4,
                        title: 'Historial',
                        content: 'Interacciones previas con este cliente.',
                    },
                ],
            },
            {
                width: 6,
                blocks: [
                    { kind: 'timeline', weight: 1, height: 12 },
                ],
            },
            {
                width: 3,
                blocks: [
                    {
                        kind: 'group', id: 'g-fechas', label: 'Fechas clave', iconKey: 'calendar',
                        weight: 1, height: 5,
                        predicate: (f) => f.type === 'date' || f.type === 'datetime',
                    },
                    {
                        kind: 'notes', id: 'notes-deal', weight: 1, height: 4,
                        title: 'Próximos pasos',
                        content: 'Acciones a seguir para avanzar esta venta. Editá el bloque para personalizar.',
                    },
                    {
                        kind: 'notes', id: 'notes-objeciones', weight: 1, height: 3,
                        title: 'Objeciones',
                        content: 'Puntos que el cliente ha mencionado como bloqueos.',
                    },
                ],
            },
        ])
        .autoRelatedRows({ width: 12, height: 4 })
        .row({
            height: 4,
            cells: [
                {
                    kind: 'leftover-group',
                    id: 'g-other',
                    label: 'Otros',
                    iconKey: 'database',
                    weight: 12,
                    collapsedByDefault: true,
                },
            ],
        })
        .build(),
};

const taskTemplate: CrmTemplate = {
    id: 'task',
    name: 'Tarea',
    description: 'Fecha de vencimiento prominente, estado + prioridad, asignación.',
    resolve: (fields) => {
        const b = new LayoutBuilder(fields);
        const titleField = b.pickTitle();

        // Subtitle: la primera fecha (típicamente "due_date").
        const subtitleFields = b.pickAll(
            (f) => (f.type === 'date' || f.type === 'datetime'),
            1,
        );

        const statusFields = b.pickStatusFields();
        const quickActions = b.pickQuickActions();

        const groups: SidebarGroup[] = [];
        const programacion = b.group('programacion', 'Programación', Calendar, (f) =>
            f.type === 'date' || f.type === 'datetime',
        );
        const assignment = b.group('assignment', 'Asignación', CircleUser, (f) => f.type === 'user');
        const numeric = b.group('numbers', 'Datos', Briefcase, (f) =>
            f.type === 'number' || f.type === 'currency',
        );
        const notas = b.group('notas', 'Notas', StickyNote, (f) => f.type === 'long_text', {
            collapsedByDefault: false,
        });

        if (programacion) groups.push(programacion);
        if (assignment) groups.push(assignment);
        if (numeric) groups.push(numeric);
        if (notas) groups.push(notas);

        return {
            titleField,
            subtitleFields,
            statusFields,
            quickActions,
            sidebarGroups: groups,
            rightRail: b.buildRightRail(),
            leftover: b.leftover(),
        };
    },
    /**
     * V2 layout (row-based):
     *  - Row 1 (h=4): Programación + Asignación.
     *  - Row 2 (h=10): Datos + Timeline + Checklist (notes).
     *  - Row 3 (h=4): Stats.
     *  - Row 4+: relacionados.
     *  - Row N: Otros.
     */
    resolveV2: (fields) => new V2Builder(fields)
        .setAutoTitle()
        .addSubtitleByPattern((f) => f.type === 'date' || f.type === 'datetime', 1)
        .autoStatus()
        .autoQuickActions()
        // Top row: Programación + Asignación
        .row({
            height: 4,
            cells: [
                {
                    kind: 'group', id: 'g-programacion', label: 'Programación', iconKey: 'calendar',
                    weight: 8, height: 4,
                    predicate: (f) => f.type === 'date' || f.type === 'datetime',
                },
                {
                    kind: 'group', id: 'g-assignment', label: 'Asignación', iconKey: 'circle_user',
                    weight: 4, height: 4,
                    predicate: (f) => f.type === 'user',
                },
            ],
        })
        // Main grid: 3 cols balanceadas (cada una suma h=12).
        .columns([
            {
                width: 3,
                blocks: [
                    {
                        kind: 'group', id: 'g-numbers', label: 'Datos', iconKey: 'briefcase',
                        weight: 1, height: 4,
                        predicate: (f) => f.type === 'number' || f.type === 'currency',
                    },
                    { kind: 'stats', weight: 1, height: 4 },
                    {
                        kind: 'notes', id: 'notes-contexto', weight: 1, height: 4,
                        title: 'Contexto',
                        content: 'Background relevante para esta tarea.',
                    },
                ],
            },
            {
                width: 6,
                blocks: [
                    { kind: 'timeline', weight: 1, height: 12 },
                ],
            },
            {
                width: 3,
                blocks: [
                    {
                        kind: 'notes', id: 'notes-checklist', weight: 1, height: 6,
                        title: 'Checklist',
                        content: '- [ ] Sub-tarea 1\n- [ ] Sub-tarea 2\n- [ ] Sub-tarea 3\n\nEditá el bloque para personalizar.',
                    },
                    {
                        kind: 'notes', id: 'notes-bloqueos', weight: 1, height: 6,
                        title: 'Bloqueos',
                        content: 'Cualquier impedimento o dependencia. Editá el bloque para personalizar.',
                    },
                ],
            },
        ])
        .autoRelatedRows({ width: 12, height: 4 })
        .row({
            height: 4,
            cells: [
                {
                    kind: 'leftover-group',
                    id: 'g-other',
                    label: 'Otros',
                    iconKey: 'database',
                    weight: 12,
                    collapsedByDefault: true,
                },
            ],
        })
        .build(),
};

const supportTemplate: CrmTemplate = {
    id: 'support',
    name: 'Soporte',
    description: 'Ticket: prioridad y estado prominentes, datos del cliente, fechas y SLA.',
    resolve: (fields) => {
        const b = new LayoutBuilder(fields);
        const titleField = b.pickTitle();

        // Subtitle: ticket id (campo number con slug "ticket"|"case").
        const subtitleFields = b.pickAll(
            (f) => (f.type === 'number' || f.type === 'text') && matches(f, TICKET_PATTERNS),
            1,
        );

        const statusFields: FieldEntity[] = [
            ...b.pickAll((f) => isStatusLike(f) && matches(f, PRIORITY_PATTERNS), 1),
            ...b.pickStatusFields(),
        ];

        const quickActions = b.pickQuickActions();

        const groups: SidebarGroup[] = [];
        const cliente = b.group('cliente', 'Cliente', User, (f) =>
            f.type === 'email' || f.type === 'url' || isPhoneLike(f) || matches(f, COMPANY_PATTERNS),
        );
        const detalles = b.group('detalles', 'Detalles', LifeBuoy, (f) =>
            f.type === 'long_text' || f.type === 'file',
        );
        const fechas = b.group('fechas', 'Fechas', Calendar, (f) =>
            f.type === 'date' || f.type === 'datetime',
        );
        const numeric = b.group('numbers', 'Métricas', Target, (f) =>
            f.type === 'number' || f.type === 'currency',
        );
        const assignment = b.group('assignment', 'Asignación', CircleUser, (f) => f.type === 'user');

        if (cliente) groups.push(cliente);
        if (detalles) groups.push(detalles);
        if (fechas) groups.push(fechas);
        if (numeric) groups.push(numeric);
        if (assignment) groups.push(assignment);

        return {
            titleField,
            subtitleFields,
            statusFields,
            quickActions,
            sidebarGroups: groups,
            rightRail: b.buildRightRail(),
            leftover: b.leftover(),
        };
    },
    /**
     * V2 layout (row-based):
     *  - Row 1 (h=4): Stats (SLA) + Cliente + Asignación.
     *  - Row 2 (h=10): Detalles + Timeline + Fechas.
     *  - Row 3 (h=5): Runbook (notes) + Métricas.
     *  - Row 4+: relacionados.
     *  - Row N: Otros.
     */
    resolveV2: (fields) => new V2Builder(fields)
        .setAutoTitle()
        .addSubtitleByPattern(
            (f) => (f.type === 'number' || f.type === 'text') && matches(f, TICKET_PATTERNS),
            1,
        )
        .autoStatus()
        .autoQuickActions()
        // Top row: Stats SLA + Cliente + Asignación
        .row({
            height: 4,
            cells: [
                { kind: 'stats', weight: 3, height: 4 },
                {
                    kind: 'group', id: 'g-cliente', label: 'Cliente', iconKey: 'user',
                    weight: 5, height: 4,
                    predicate: (f) =>
                        f.type === 'email' || f.type === 'url' || isPhoneLike(f) || matches(f, COMPANY_PATTERNS),
                },
                {
                    kind: 'group', id: 'g-assignment', label: 'Asignación', iconKey: 'circle_user',
                    weight: 4, height: 4,
                    predicate: (f) => f.type === 'user',
                },
            ],
        })
        // Main: Detalles+Runbook stacked | Timeline | Fechas+Métricas stacked
        // Esto evita gaps verticales bajo Detalles y Fechas — los Notes y
        // Métricas llenan la altura libre mientras Timeline ocupa los 12.
        .columns([
            {
                width: 3,
                blocks: [
                    {
                        kind: 'group', id: 'g-detalles', label: 'Detalles', iconKey: 'lifebuoy',
                        weight: 1, height: 5,
                        predicate: (f) => f.type === 'long_text' || f.type === 'file',
                    },
                    {
                        kind: 'notes', id: 'notes-runbook', weight: 1, height: 7,
                        title: 'Runbook',
                        content: 'Pasos a seguir para este tipo de ticket.\n\n1. Confirmar con el cliente.\n2. Reproducir el problema.\n3. Documentar en la timeline.',
                    },
                ],
            },
            {
                width: 6,
                blocks: [
                    { kind: 'timeline', weight: 1, height: 12 },
                ],
            },
            {
                width: 3,
                blocks: [
                    {
                        kind: 'group', id: 'g-fechas', label: 'Fechas', iconKey: 'calendar',
                        weight: 1, height: 5,
                        predicate: (f) => f.type === 'date' || f.type === 'datetime',
                    },
                    {
                        kind: 'group', id: 'g-numbers', label: 'Métricas', iconKey: 'target',
                        weight: 1, height: 7,
                        predicate: (f) => f.type === 'number' || f.type === 'currency',
                    },
                ],
            },
        ])
        .autoRelatedRows({ width: 12, height: 4 })
        .row({
            height: 4,
            cells: [
                {
                    kind: 'leftover-group',
                    id: 'g-other',
                    label: 'Otros',
                    iconKey: 'database',
                    weight: 12,
                    collapsedByDefault: true,
                },
            ],
        })
        .build(),
};

// --- registry ----------------------------------------------------------------

export const CRM_TEMPLATES: CrmTemplate[] = [
    autoTemplate,
    contactTemplate,
    dealTemplate,
    taskTemplate,
    supportTemplate,
];

export const DEFAULT_TEMPLATE_ID = 'auto';
export const CUSTOM_TEMPLATE_ID  = 'custom';

export function getTemplate(id: string | undefined): CrmTemplate {
    return CRM_TEMPLATES.find((t) => t.id === id) ?? autoTemplate;
}

/** Icon helper para el sidebar "Otros" (siempre fallback al final). */
export const OTHER_GROUP_ICON: IconName = Database;

// --- Custom templates (0.34.0): editor visual --------------------------------

/**
 * Catálogo de iconos disponibles en el editor visual. Cada slot del
 * sidebar puede elegir uno. Mantenemos una lista corta y curada para
 * que el editor sea finite y serializable — nada de free-form lucide
 * names que cambian entre versiones.
 */
export const SIDEBAR_ICON_OPTIONS: Array<{ key: string; icon: IconName; label: string }> = [
    { key: 'mail', icon: Mail, label: 'Contacto' },
    { key: 'building', icon: Building2, label: 'Empresa' },
    { key: 'tag', icon: Tag, label: 'Etiqueta' },
    { key: 'briefcase', icon: Briefcase, label: 'Trabajo' },
    { key: 'dollar', icon: DollarSign, label: 'Dinero' },
    { key: 'calendar', icon: Calendar, label: 'Fechas' },
    { key: 'user', icon: User, label: 'Persona' },
    { key: 'circle_user', icon: CircleUser, label: 'Asignación' },
    { key: 'sticky_note', icon: StickyNote, label: 'Notas' },
    { key: 'target', icon: Target, label: 'Métricas' },
    { key: 'lifebuoy', icon: LifeBuoy, label: 'Soporte' },
    { key: 'database', icon: Database, label: 'Otros' },
];

export function iconForKey(key: string): IconName {
    return SIDEBAR_ICON_OPTIONS.find((o) => o.key === key)?.icon ?? Database;
}

/**
 * Configuración serializable del template "Personalizada", producida
 * por el editor visual (0.34.0+) y persistida en
 * `list.settings.crm_template_custom`.
 *
 * Toda referencia a campos es por **slug** (que el SlugManager garantiza
 * único + tolerante a renames vía slug_history). Slugs faltantes se
 * skipean silenciosamente al resolver — sin esto, borrar un campo
 * dejaría la plantilla rota.
 */
export interface CustomSidebarGroupConfig {
    id: string;
    label: string;
    icon_key: string;
    field_slugs: string[];
    collapsed_by_default: boolean;
}

export interface CustomTemplateConfig {
    title_field_slug?: string;
    subtitle_field_slugs: string[];
    status_field_slugs: string[];
    quick_action_field_slugs: string[];
    sidebar_groups: CustomSidebarGroupConfig[];
    show_stats: boolean;
    related_field_slugs: string[];
}

export function emptyCustomConfig(): CustomTemplateConfig {
    return {
        subtitle_field_slugs: [],
        status_field_slugs: [],
        quick_action_field_slugs: [],
        sidebar_groups: [],
        show_stats: true,
        related_field_slugs: [],
    };
}

/**
 * Convierte el resultado del resolver de una plantilla built-in en un
 * `CustomTemplateConfig` serializable. Útil para "duplicar y editar" —
 * el user empieza desde una plantilla curada y la modifica.
 */
export function customConfigFromBuiltin(
    builtinId: string,
    fields: FieldEntity[],
): CustomTemplateConfig {
    const layout = getTemplate(builtinId).resolve(fields);
    return {
        title_field_slug: layout.titleField?.slug,
        subtitle_field_slugs: layout.subtitleFields.map((f) => f.slug),
        status_field_slugs: layout.statusFields.map((f) => f.slug),
        quick_action_field_slugs: layout.quickActions.map((q) => q.field.slug),
        sidebar_groups: layout.sidebarGroups.map((g, i) => ({
            id: g.id || `group-${i}`,
            label: g.label,
            icon_key: matchIconKey(g.icon),
            field_slugs: g.fields.map((f) => f.slug),
            collapsed_by_default: g.collapsedByDefault,
        })),
        show_stats: layout.rightRail.some((b) => b.kind === 'stats'),
        related_field_slugs: layout.rightRail
            .filter((b): b is { id: string; kind: 'related'; field: FieldEntity } => b.kind === 'related')
            .map((b) => b.field.slug),
    };
}

function matchIconKey(icon: IconName): string {
    const found = SIDEBAR_ICON_OPTIONS.find((o) => o.icon === icon);
    return found?.key ?? 'database';
}

/**
 * Resuelve un `CustomTemplateConfig` contra los fields actuales de la
 * lista. Tolerante a slugs faltantes (si el user borró un campo, lo
 * skipeamos), tolerante a kinds no-aplicables (un slug que apunta a un
 * field tipo `relation` no debería estar en `quick_action_field_slugs`,
 * pero si sucede lo ignoramos sin crashear).
 */
export function resolveCustomTemplate(
    config: CustomTemplateConfig,
    fields: FieldEntity[],
): ResolvedLayout {
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const used = new Set<number>();

    const lookup = (slug: string): FieldEntity | null => {
        const f = bySlug.get(slug);
        if (! f || used.has(f.id)) return null;
        used.add(f.id);
        return f;
    };

    const titleField = config.title_field_slug ? lookup(config.title_field_slug) : null;
    const subtitleFields = config.subtitle_field_slugs
        .map((s) => lookup(s))
        .filter((f): f is FieldEntity => f !== null);
    const statusFields = config.status_field_slugs
        .map((s) => lookup(s))
        .filter((f): f is FieldEntity => f !== null);

    const quickActions: QuickActionEntry[] = [];
    for (const slug of config.quick_action_field_slugs) {
        const f = lookup(slug);
        if (! f) continue;
        const kind = f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'phone';
        quickActions.push({ field: f, kind });
    }

    const sidebarGroups: SidebarGroup[] = config.sidebar_groups.map((g) => ({
        id: g.id,
        label: g.label,
        icon: iconForKey(g.icon_key),
        fields: g.field_slugs
            .map((s) => lookup(s))
            .filter((f): f is FieldEntity => f !== null),
        collapsedByDefault: g.collapsed_by_default,
    }));

    const rightRail: RightRailBlock[] = [];
    if (config.show_stats) {
        rightRail.push({ id: 'stats', kind: 'stats' });
    }
    for (const slug of config.related_field_slugs) {
        const f = bySlug.get(slug);
        if (f && f.type === 'relation') {
            rightRail.push({ id: `related-${f.id}`, kind: 'related', field: f });
        }
    }

    const leftover = fields
        .filter((f) => ! used.has(f.id) && f.type !== 'relation')
        .sort((a, b) => a.position - b.position);

    return {
        titleField,
        subtitleFields,
        statusFields,
        quickActions,
        sidebarGroups,
        rightRail,
        leftover,
    };
}

/**
 * Resolver unificado consumido por `RecordCrmLayout` y la preview del
 * editor. Si la lista tiene `crm_template_id === 'custom'` y un
 * `crm_template_custom` válido, usa ese; sino cae a la built-in.
 */
export function getResolvedLayout(
    settings: { crm_template_id?: string; crm_template_custom?: unknown },
    fields: FieldEntity[],
): ResolvedLayout {
    if (settings.crm_template_id === CUSTOM_TEMPLATE_ID && isCustomConfig(settings.crm_template_custom)) {
        return resolveCustomTemplate(settings.crm_template_custom, fields);
    }
    return getTemplate(settings.crm_template_id).resolve(fields);
}

// --- Custom templates v2: grid-based editor (0.35.0) -------------------------

/**
 * V2 schema (0.35.0): grid de bloques drag-resize-able. Reemplaza el
 * V1 form-based donde el sidebar/right-rail tenían posición fija.
 *
 * Idea: el header sigue fijo arriba (full-width). Debajo, un grid de
 * 12 columnas donde cada bloque tiene `{x, y, w, h}` y un `type`
 * que decide qué se rendera adentro. El user puede arrastrar
 * cualquier bloque a cualquier posición y resizearlo entre 1-12
 * columnas. Misma capa de render para el editor (drag-mode) y la
 * ficha del registro (static-mode). Los datos persistidos también
 * se usan en static — visual perfectamente igual a la edición.
 */

export type V2BlockType =
    | 'header'
    | 'properties_group'
    | 'timeline'
    | 'stats'
    | 'related'
    | 'notes'
    | 'kpi'
    | 'chart'
    | 'files'
    | 'embed'
    | 'action_button'
    | 'markdown'
    | 'divider'
    | 'heading'
    | 'comments_thread'
    // 0.57.29 — sub-sección con N columnas anidadas (1 nivel)
    | 'nested_section'
    // v0.1.93 — imagen (upload propio o URL externa)
    | 'image'
    // v0.1.94 — espaciador y galería
    | 'spacer'
    | 'gallery';

interface V2BlockBase {
    id: string;
    /** Índice de columna dentro de la fila (0, 1, 2...). */
    x: number;
    /** Índice de fila (0, 1, 2...). */
    y: number;
    /** Ancho de la columna en cols de 12. */
    w: number;
    /** [Legacy] Altura — ignorado desde 0.57.22. */
    h: number;
    /**
     * Posición vertical dentro de la columna (0, 1, 2...). Permite
     * apilar varios bloques en la misma columna. Default 0.
     */
    pos?: number;
    /**
     * Spacing CSS de la sección/columna que contiene este bloque.
     * Consistente entre bloques que comparten sección o columna.
     */
    secPadding?: string;
    secMargin?: string;
    colPadding?: string;
    colMargin?: string;
    /** v0.1.93 — fondo (hex) de la sección/columna contenedora. */
    secBg?: string;
    colBg?: string;
}

/**
 * Bloque de cabecera del registro. Antes era un componente fijo
 * renderizado fuera del grid (`<RecordHeader>` en `RecordCrmLayout`).
 * Desde 0.49.0 vive en el grid como cualquier otro bloque: el usuario
 * puede redimensionarlo, moverlo, cambiarle estilo, e incluso eliminarlo
 * (aunque sin él pierde el acceso a los botones Guardar/Eliminar).
 *
 * Los datos (qué campo es título, subtítulos, status pills, quick actions)
 * siguen siendo template-level — vienen del `headerSpec` del template
 * resuelto. El bloque solo controla la APARIENCIA.
 *
 * Backward-compat: si una plantilla V2 serializada no tiene `header`
 * block, el resolver inyecta uno sintético al tope (x=0,y=0,w=12,h=4)
 * con defaults seguros — el render es idéntico al hardcoded previo.
 */
export interface V2HeaderBlock extends V2BlockBase {
    type: 'header';
    config: {
        /**
         * Variante visual:
         *  - `hero` (default) — avatar grande 16×16, banda decorativa de
         *    gradient arriba, layout horizontal estándar. Es lo que se
         *    renderea hoy.
         *  - `compact` — una sola fila, avatar pequeño (10×10), título
         *    inline con badges al lado, sin banda decorativa. Ideal
         *    para fichas con mucho contenido abajo.
         *  - `minimal` — sin avatar, solo título grande + #id + acciones.
         *    Layout más limpio, casi sin chrome.
         *  - `banner` — avatar y título centrados, layout vertical
         *    estilo página de perfil. Acciones abajo del status strip.
         */
        variant: 'hero' | 'compact' | 'minimal' | 'banner';
        show_avatar: boolean;
        show_id_badge: boolean;
        show_subtitle: boolean;
        show_created_at: boolean;
        show_status_strip: boolean;
        show_actions: boolean;
        /**
         * Override del color del avatar/banda. Si es null, se calcula
         * a partir del título (hash → HSL). Acepta hex tipo `#5a3fcc`.
         */
        accent_color: string | null;
    };
}

export interface V2PropertiesGroupBlock extends V2BlockBase {
    type: 'properties_group';
    config: {
        label: string;
        icon_key: string;
        field_slugs: string[];
        collapsed_by_default: boolean;
        /**
         * Densidad visual. `compact` (default) muestra cada campo como
         * fila label-izquierda / valor-derecha de ~32-40px con edit
         * on-click. `comfortable` apila label sobre input al estilo
         * formulario clásico (más espacio, mejor para grupos con
         * inputs complejos o pocos campos).
         */
        density?: 'compact' | 'comfortable';
        /**
         * Variante visual. `card` (default) envuelve el grupo en una
         * card con header colapsable. `inline` omite el header y el
         * border — ideal cuando el grupo tiene 1-2 campos clave que
         * queremos mostrar prominentemente sin marco visual.
         */
        variant?: 'card' | 'inline';
    };
}

export interface V2TimelineBlock extends V2BlockBase {
    type: 'timeline';
    config: Record<string, never>;
}

export interface V2StatsBlock extends V2BlockBase {
    type: 'stats';
    config: {
        /**
         * `auto` (default, backward-compat) muestra las 4 métricas
         * automáticas (días en sistema / sin cambios / comentarios /
         * cambios).
         *
         * `custom` muestra exactamente los items definidos en `items`
         * — pueden ser auto-metrics curados o valores de campos del
         * record. Útil para fichas tipo "cliente" donde lo importante
         * es el balance, próxima factura, etc., no las métricas de
         * actividad del CRM.
         */
        mode?: 'auto' | 'custom';
        items?: Array<
            | { kind: 'auto'; metric: 'days_in_system' | 'days_since_changes' | 'comments' | 'changes' }
            | { kind: 'field'; field_slug: string; label?: string }
        >;
    };
}

export interface V2RelatedBlock extends V2BlockBase {
    type: 'related';
    config: { field_slug: string };
}

/**
 * Bloque de notas. Dos modos:
 *  - `literal` (default, backward-compat) — texto static, igual para
 *    todos los records de la lista. Útil para "recordatorios al
 *    operador" tipo "siempre confirmar referencia antes de cerrar".
 *  - `field` — lee el contenido de un campo del record. Útil para
 *    notas internas por-registro (ej. "observaciones del cliente"
 *    que viven en un long_text field).
 */
export interface V2NotesBlock extends V2BlockBase {
    type: 'notes';
    config: {
        title: string;
        source?: 'literal' | 'field';
        content: string;         // cuando source === 'literal' (default)
        field_slug?: string;     // cuando source === 'field'
    };
}

/**
 * KPI: número grande con label opcional. Ideal para destacar
 * monto, count, ranking, etc. Soporta formato (number/currency/
 * percent), prefix/suffix custom, y opcional `goal_value` que
 * renderea una barra de progreso debajo del número.
 */
export interface V2KpiBlock extends V2BlockBase {
    type: 'kpi';
    config: {
        field_slug: string;
        label?: string;
        format?: 'number' | 'currency' | 'percent';
        prefix?: string;
        suffix?: string;
        goal_value?: number;
    };
}

/**
 * Chart inline: distribución de records relacionados agrupados por
 * un field en la lista destino. Ej. "Tareas por estado" cuando el
 * record es un cliente y hay relation field a Tareas.
 */
export interface V2ChartBlock extends V2BlockBase {
    type: 'chart';
    config: {
        relation_field_slug: string;
        group_by_field_slug: string;
        title?: string;
    };
}

/**
 * Files: muestra los archivos vinculados al record. Si
 * `file_field_slugs` está vacío, muestra todos los `file` fields
 * disponibles. Soporta thumbnail (cuando es imagen) o icono
 * genérico para otros tipos.
 */
export interface V2FilesBlock extends V2BlockBase {
    type: 'files';
    config: {
        file_field_slugs: string[];
        title?: string;
    };
}

/**
 * Embed externo (iframe). El URL puede ser literal o resolverse
 * desde un field tipo `url` del record. Embeds restringidos a
 * sources whitelist (Google Maps, YouTube, Vimeo, Loom, Figma,
 * Calendly) por seguridad — sandbox al iframe.
 */
export interface V2EmbedBlock extends V2BlockBase {
    type: 'embed';
    config: {
        source: 'literal' | 'field';
        url?: string;            // cuando source === 'literal'
        field_slug?: string;     // cuando source === 'field'
        title?: string;
    };
}

/**
 * Botón de acción: dispara una URL externa, mailto, tel, o copia un
 * valor. El **target** puede ser literal (mismo para todos los records)
 * o dinámico desde un campo del record — útil para "Email al contacto"
 * donde cada cliente tiene su propio email.
 */
export interface V2ActionButtonBlock extends V2BlockBase {
    type: 'action_button';
    config: {
        label: string;
        action_type: 'url' | 'mailto' | 'tel' | 'copy';
        target_source?: 'literal' | 'field';   // default 'literal'
        target: string;                         // cuando target_source === 'literal'
        target_field_slug?: string;             // cuando target_source === 'field'
        variant?: 'default' | 'outline' | 'destructive';
    };
}

/**
 * Markdown rich text: como `notes` pero renderea markdown ligero
 * (headings #, bullet -, números, negrita **x**, itálica *x*,
 * inline `code`, links [text](url)). Soporta los mismos modos
 * `literal` / `field` que notes.
 */
export interface V2MarkdownBlock extends V2BlockBase {
    type: 'markdown';
    config: {
        title: string;
        source?: 'literal' | 'field';
        content: string;
        field_slug?: string;
    };
}

/**
 * Divisor visual horizontal con label opcional centrado. Útil para
 * separar secciones del panel sin generar contenido. Si `label`
 * está vacío se renderea como `<hr>` simple. (Fase 11.F)
 */
export interface V2DividerBlock extends V2BlockBase {
    type: 'divider';
    config: {
        label?: string;
    };
}

/**
 * Título de sección. Texto + nivel jerárquico h2/h3/h4. Diferente
 * de `notes` y `markdown` porque ocupa una sola línea sin chrome
 * de tarjeta — útil para agrupar visualmente bloques relacionados.
 * (Fase 11.F)
 */
export interface V2HeadingBlock extends V2BlockBase {
    type: 'heading';
    config: {
        text: string;
        level: 2 | 3 | 4;
    };
}

/**
 * Hilo de comentarios del record actual. Renderea el `CommentsPanel`
 * normal que ya alimenta `/lists/{list}/records/{record}/comments`.
 * En el editor visual queda no-interactivo por el wrapper
 * `pointer-events-none` del GridEditor — en RecordCrmLayout es
 * interactivo. (Fase 11.F)
 */
export interface V2CommentsThreadBlock extends V2BlockBase {
    type: 'comments_thread';
    config: {
        title?: string;
    };
}

/**
 * Sub-sección con N columnas anidadas (1 nivel de profundidad).
 * Cada sub-columna contiene sub-bloques apilados verticalmente. Los
 * sub-bloques son `V2Block` normales — el editor restringe a NO
 * permitir `nested_section` adentro de otro `nested_section`.
 */
export interface V2NestedSectionBlock extends V2BlockBase {
    type: 'nested_section';
    config: {
        columns: Array<{
            id: string;
            width: number;
            blocks: V2Block[];
            /** CSS padding aplicado a la sub-columna. */
            padding?: string;
            /** CSS margin aplicado a la sub-columna. */
            margin?: string;
        }>;
        /** CSS padding aplicado al wrapper del nested_section. */
        padding?: string;
        /** CSS margin aplicado al wrapper del nested_section. */
        margin?: string;
    };
}

/**
 * v0.1.93 — Imagen: subida al módulo de archivos (`image_file_id`,
 * servida por el download con sesión — mismo camino que los covers de
 * tarjetas) o URL externa. Alto fijo opcional, ajuste cover/contain y
 * enlace al hacer click.
 */
export interface V2ImageBlock extends V2BlockBase {
    type: 'image';
    config: {
        url?: string;
        image_file_id?: number;
        alt?: string;
        height?: number;
        fit?: 'cover' | 'contain';
        link_url?: string;
    };
}

/** v0.1.94 — espacio vertical fijo. */
export interface V2SpacerBlock extends V2BlockBase {
    type: 'spacer';
    config: { height?: number };
}

/** v0.1.94 — galería de imágenes en grilla (subidas o por URL). */
export interface V2GalleryBlock extends V2BlockBase {
    type: 'gallery';
    config: {
        images?: Array<{ url?: string; image_file_id?: number; alt?: string }>;
        columns?: number;
        height?: number;
    };
}

export type V2Block =
    | V2HeaderBlock
    | V2PropertiesGroupBlock
    | V2TimelineBlock
    | V2StatsBlock
    | V2RelatedBlock
    | V2NotesBlock
    | V2KpiBlock
    | V2ChartBlock
    | V2FilesBlock
    | V2EmbedBlock
    | V2ActionButtonBlock
    | V2MarkdownBlock
    | V2DividerBlock
    | V2HeadingBlock
    | V2CommentsThreadBlock
    | V2NestedSectionBlock
    | V2ImageBlock
    | V2SpacerBlock
    | V2GalleryBlock;

export interface CustomTemplateConfigV2 {
    v: 2;
    header: {
        title_field_slug?: string;
        subtitle_field_slugs: string[];
        status_field_slugs: string[];
        quick_action_field_slugs: string[];
    };
    blocks: V2Block[];
}

export function emptyCustomConfigV2(): CustomTemplateConfigV2 {
    return {
        v: 2,
        header: {
            subtitle_field_slugs: [],
            status_field_slugs: [],
            quick_action_field_slugs: [],
        },
        blocks: [],
    };
}

/**
 * Migra un V1 (sidebar groups + right rail flags) a V2 (grid de
 * bloques). Layout default después de migrar:
 *   - Columna izquierda (cols 0-3, w=4): sidebar groups apilados.
 *   - Columna central (cols 4-8, w=5): timeline.
 *   - Columna derecha (cols 9-11, w=3): stats arriba + related debajo.
 *
 * El user puede después arrastrar cualquier bloque a otro lado, pero
 * empieza con un layout familiar.
 */
export function migrateV1toV2(v1: CustomTemplateConfig): CustomTemplateConfigV2 {
    const blocks: V2Block[] = [];

    // Columna izquierda: properties groups apilados.
    let leftY = 0;
    for (const g of v1.sidebar_groups) {
        const fieldCount = g.field_slugs.length;
        // Altura estimada: 1 fila para el header + 1.5 filas por field
        // (visualmente un input mediano). Min 3.
        const h = Math.max(3, Math.ceil(1 + fieldCount * 1.5));
        blocks.push({
            id: g.id || `group-${blocks.length}`,
            type: 'properties_group',
            x: 0,
            y: leftY,
            w: 4,
            h,
            config: {
                label: g.label,
                icon_key: g.icon_key,
                field_slugs: g.field_slugs,
                collapsed_by_default: g.collapsed_by_default,
            },
        });
        leftY += h;
    }

    // Columna central: timeline (alta).
    blocks.push({
        id: 'timeline',
        type: 'timeline',
        x: 4,
        y: 0,
        w: 5,
        h: Math.max(leftY, 12),
        config: {},
    });

    // Columna derecha: stats arriba + related debajo.
    let rightY = 0;
    if (v1.show_stats) {
        blocks.push({
            id: 'stats',
            type: 'stats',
            x: 9,
            y: rightY,
            w: 3,
            h: 4,
            config: {},
        });
        rightY += 4;
    }
    for (const slug of v1.related_field_slugs) {
        blocks.push({
            id: `related-${slug}`,
            type: 'related',
            x: 9,
            y: rightY,
            w: 3,
            h: 4,
            config: { field_slug: slug },
        });
        rightY += 4;
    }

    return {
        v: 2,
        header: {
            title_field_slug: v1.title_field_slug,
            subtitle_field_slugs: v1.subtitle_field_slugs,
            status_field_slugs: v1.status_field_slugs,
            quick_action_field_slugs: v1.quick_action_field_slugs,
        },
        blocks,
    };
}

/**
 * Construye un V2 desde una built-in. Si la plantilla declara un
 * `resolveV2` propio (todas las built-ins ahora lo hacen), lo usa
 * directo — así cada plantilla genera un grid visiblemente distinto
 * (Contacto ≠ Venta ≠ Tarea ≠ Soporte). Fallback a la migración V1
 * genérica solo si una plantilla custom legacy no implementa V2.
 */
export function customConfigV2FromBuiltin(
    builtinId: string,
    fields: FieldEntity[],
): CustomTemplateConfigV2 {
    const tpl = getTemplate(builtinId);
    const raw = tpl.resolveV2
        ? tpl.resolveV2(fields)
        : migrateV1toV2(customConfigFromBuiltin(builtinId, fields));
    // Las built-ins no emiten header block (su `V2Builder` no lo conoce);
    // lo agregamos acá una sola vez para que el editor lo vea como un
    // bloque real y el render sea consistente con custom configs.
    return ensureHeaderBlock(raw);
}

function isCustomConfig(v: unknown): v is CustomTemplateConfig {
    return Boolean(
        v
            && typeof v === 'object'
            && Array.isArray((v as CustomTemplateConfig).subtitle_field_slugs)
            && Array.isArray((v as CustomTemplateConfig).sidebar_groups),
    );
}

function isV2Config(v: unknown): v is CustomTemplateConfigV2 {
    return Boolean(
        v
            && typeof v === 'object'
            && (v as CustomTemplateConfigV2).v === 2
            && Array.isArray((v as CustomTemplateConfigV2).blocks),
    );
}

/**
 * Asegura que el config esté en V2. Acepta V1 (legacy del 0.34.x) y
 * lo migra silenciosamente. Si no es ninguno de los dos, devuelve
 * un V2 vacío (defensivo — no crashea).
 */
export function ensureV2(config: unknown): CustomTemplateConfigV2 {
    if (isV2Config(config)) return ensureHeaderBlock(config);
    if (isCustomConfig(config)) return ensureHeaderBlock(migrateV1toV2(config));
    return ensureHeaderBlock(emptyCustomConfigV2());
}

/**
 * Garantiza que el config tenga un header block al tope. Si no lo
 * tiene, prepende uno con defaults y desplaza los demás 4 filas hacia
 * abajo — espejando la lógica de `getResolvedV2` para mantener el
 * shape persistido en sincro con el render.
 *
 * Usado al cargar el editor — así el usuario ve el header como un
 * bloque real desde el primer momento (puede clickearlo y configurarlo
 * en lugar de tener que agregarlo manualmente desde la palette).
 */
function ensureHeaderBlock(config: CustomTemplateConfigV2): CustomTemplateConfigV2 {
    if (config.blocks.some((b) => b.type === 'header')) return config;
    const shifted = config.blocks.map((b) => ({ ...b, y: b.y + 4 }));
    return {
        ...config,
        blocks: [
            {
                id: 'header',
                x: 0, y: 0, w: 12, h: 4,
                type: 'header',
                config: defaultHeaderBlockConfig(),
            },
            ...shifted,
        ],
    };
}

/**
 * Resuelve un V2 contra los fields actuales de la lista en una shape
 * que el RecordCrmLayout puede consumir directamente: el header
 * resuelto + array de bloques (ya con FieldEntity inflados, no slugs).
 */
export interface ResolvedV2 {
    header: {
        titleField: FieldEntity | null;
        subtitleFields: FieldEntity[];
        statusFields: FieldEntity[];
        quickActions: QuickActionEntry[];
    };
    blocks: ResolvedV2Block[];
}

interface ResolvedBase {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    pos?: number;
    secPadding?: string;
    secMargin?: string;
    colPadding?: string;
    colMargin?: string;
    /** v0.1.93 — fondo de la sección/columna contenedora (hex). */
    secBg?: string;
    colBg?: string;
    /** v0.1.93 — estilo del bloque (`config.style` crudo, lo lee blockStyle). */
    style?: Record<string, unknown>;
}

export type ResolvedV2Block =
    | (ResolvedBase & { type: 'header';
        config: {
            variant: 'hero' | 'compact' | 'minimal' | 'banner';
            showAvatar: boolean;
            showIdBadge: boolean;
            showSubtitle: boolean;
            showCreatedAt: boolean;
            showStatusStrip: boolean;
            showActions: boolean;
            accentColor: string | null;
        } })
    | (ResolvedBase & { type: 'properties_group';
        config: {
            label: string;
            icon: IconName;
            fields: FieldEntity[];
            collapsedByDefault: boolean;
            density: 'compact' | 'comfortable';
            variant: 'card' | 'inline';
        } })
    | (ResolvedBase & { type: 'timeline' })
    | (ResolvedBase & { type: 'stats';
        config: {
            mode: 'auto' | 'custom';
            items: Array<
                | { kind: 'auto'; metric: 'days_in_system' | 'days_since_changes' | 'comments' | 'changes' }
                | { kind: 'field'; field: FieldEntity; label?: string }
            >;
        } })
    | (ResolvedBase & { type: 'related'; config: { field: FieldEntity } })
    | (ResolvedBase & { type: 'notes';
        config: {
            title: string;
            source: 'literal' | 'field';
            content: string;
            field: FieldEntity | null;
        } })
    | (ResolvedBase & { type: 'kpi';
        config: {
            field: FieldEntity | null;
            label?: string;
            format?: 'number' | 'currency' | 'percent';
            prefix?: string;
            suffix?: string;
            goalValue?: number;
        } })
    | (ResolvedBase & { type: 'chart';
        config: {
            relationField: FieldEntity | null;
            groupByFieldSlug: string;
            title?: string;
        } })
    | (ResolvedBase & { type: 'files';
        config: { fileFields: FieldEntity[]; title?: string } })
    | (ResolvedBase & { type: 'embed';
        config: {
            source: 'literal' | 'field';
            url?: string;          // literal URL
            fieldSlug?: string;    // slug de field tipo url para resolver al render
            title?: string;
        } })
    | (ResolvedBase & { type: 'action_button';
        config: {
            label: string;
            actionType: 'url' | 'mailto' | 'tel' | 'copy';
            targetSource: 'literal' | 'field';
            target: string;                       // literal
            targetField: FieldEntity | null;      // field-based
            variant?: 'default' | 'outline' | 'destructive';
        } })
    | (ResolvedBase & { type: 'markdown';
        config: {
            title: string;
            source: 'literal' | 'field';
            content: string;
            field: FieldEntity | null;
        } })
    | (ResolvedBase & { type: 'divider'; config: { label?: string } })
    | (ResolvedBase & { type: 'heading'; config: { text: string; level: 2 | 3 | 4 } })
    | (ResolvedBase & { type: 'comments_thread'; config: { title?: string } })
    | (ResolvedBase & {
        type: 'nested_section';
        config: {
            columns: Array<{
                id: string;
                width: number;
                blocks: ResolvedV2Block[];
                padding?: string;
                margin?: string;
            }>;
            padding?: string;
            margin?: string;
        };
    })
    | (ResolvedBase & {
        type: 'image';
        config: {
            url?: string;
            imageFileId?: number;
            alt?: string;
            height?: number;
            fit?: 'cover' | 'contain';
            linkUrl?: string;
        };
    })
    | (ResolvedBase & { type: 'spacer'; config: { height?: number } })
    | (ResolvedBase & {
        type: 'gallery';
        config: {
            images: Array<{ url?: string; image_file_id?: number; alt?: string }>;
            columns?: number;
            height?: number;
        };
    });

/**
 * Resuelve los sub-bloques de un `nested_section`. Soporta TODOS los
 * tipos de bloque (excepto `nested_section` que es 1 nivel max).
 * Mismas reglas de inflación de fields que el resolver principal.
 */
function resolveNestedSubBlocks(
    subBlocks: V2Block[],
    fields: FieldEntity[],
): ResolvedV2Block[] {
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const lookupMany = (slugs: string[]): FieldEntity[] =>
        slugs.map((s) => bySlug.get(s)).filter((f): f is FieldEntity => f !== undefined);

    const resolved: ResolvedV2Block[] = [];
    for (const b of subBlocks) {
        if (b.type === 'nested_section') continue;
        const base = {
            id: b.id, x: b.x, y: b.y, w: b.w, h: b.h,
            pos: b.pos,
            secPadding: b.secPadding, secMargin: b.secMargin,
            colPadding: b.colPadding, colMargin: b.colMargin,
            secBg: b.secBg, colBg: b.colBg,
            // El estilo del bloque viaja crudo — lo interpreta blockStyle
            // en el render (mismo criterio que el editor y el portal).
            style: (b.config as { style?: Record<string, unknown> } | undefined)?.style,
        };

        if (b.type === 'header') {
            resolved.push({ ...base, type: 'header', config: {
                variant: b.config.variant,
                showAvatar: b.config.show_avatar,
                showIdBadge: b.config.show_id_badge,
                showSubtitle: b.config.show_subtitle,
                showCreatedAt: b.config.show_created_at,
                showStatusStrip: b.config.show_status_strip,
                showActions: b.config.show_actions,
                accentColor: b.config.accent_color,
            } });
        } else if (b.type === 'properties_group') {
            resolved.push({ ...base, type: 'properties_group', config: {
                label: b.config.label,
                icon: iconForKey(b.config.icon_key),
                fields: lookupMany(b.config.field_slugs),
                collapsedByDefault: b.config.collapsed_by_default,
                density: b.config.density ?? 'compact',
                variant: b.config.variant ?? 'card',
            } });
        } else if (b.type === 'timeline') {
            resolved.push({ ...base, type: 'timeline' });
        } else if (b.type === 'stats') {
            const mode = b.config.mode ?? 'auto';
            const items = (b.config.items ?? []).map((it) => {
                if (it.kind === 'field') {
                    const f = bySlug.get(it.field_slug);
                    if (! f) return null;
                    return { kind: 'field' as const, field: f, label: it.label };
                }
                return it;
            }).filter((x): x is NonNullable<typeof x> => x !== null);
            resolved.push({ ...base, type: 'stats', config: { mode, items } });
        } else if (b.type === 'related') {
            const f = bySlug.get(b.config.field_slug);
            if (f && f.type === 'relation') {
                resolved.push({ ...base, type: 'related', config: { field: f } });
            }
        } else if (b.type === 'notes') {
            resolved.push({ ...base, type: 'notes', config: {
                title: b.config.title,
                source: b.config.source ?? 'literal',
                content: b.config.content,
                field: b.config.field_slug ? bySlug.get(b.config.field_slug) ?? null : null,
            } });
        } else if (b.type === 'kpi') {
            resolved.push({ ...base, type: 'kpi', config: {
                field: bySlug.get(b.config.field_slug) ?? null,
                label: b.config.label,
                format: b.config.format,
                prefix: b.config.prefix,
                suffix: b.config.suffix,
                goalValue: b.config.goal_value,
            } });
        } else if (b.type === 'chart') {
            const rel = bySlug.get(b.config.relation_field_slug);
            resolved.push({ ...base, type: 'chart', config: {
                relationField: rel && rel.type === 'relation' ? rel : null,
                groupByFieldSlug: b.config.group_by_field_slug,
                title: b.config.title,
            } });
        } else if (b.type === 'files') {
            const fileFields = b.config.file_field_slugs.length > 0
                ? lookupMany(b.config.file_field_slugs).filter((f) => f.type === 'file')
                : fields.filter((f) => f.type === 'file');
            resolved.push({ ...base, type: 'files', config: {
                fileFields, title: b.config.title,
            } });
        } else if (b.type === 'embed') {
            resolved.push({ ...base, type: 'embed', config: {
                source: b.config.source,
                url: b.config.url,
                fieldSlug: b.config.field_slug,
                title: b.config.title,
            } });
        } else if (b.type === 'action_button') {
            resolved.push({ ...base, type: 'action_button', config: {
                label: b.config.label,
                actionType: b.config.action_type,
                targetSource: b.config.target_source ?? 'literal',
                target: b.config.target,
                targetField: b.config.target_field_slug
                    ? bySlug.get(b.config.target_field_slug) ?? null
                    : null,
                variant: b.config.variant,
            } });
        } else if (b.type === 'markdown') {
            resolved.push({ ...base, type: 'markdown', config: {
                title: b.config.title,
                source: b.config.source ?? 'literal',
                content: b.config.content,
                field: b.config.field_slug ? bySlug.get(b.config.field_slug) ?? null : null,
            } });
        } else if (b.type === 'divider') {
            resolved.push({ ...base, type: 'divider', config: { label: b.config.label } });
        } else if (b.type === 'heading') {
            resolved.push({ ...base, type: 'heading', config: { text: b.config.text, level: b.config.level } });
        } else if (b.type === 'comments_thread') {
            resolved.push({ ...base, type: 'comments_thread', config: { title: b.config.title } });
        } else if (b.type === 'image') {
            resolved.push({ ...base, type: 'image', config: {
                url: b.config.url,
                imageFileId: b.config.image_file_id,
                alt: b.config.alt,
                height: b.config.height,
                fit: b.config.fit,
                linkUrl: b.config.link_url,
            } });
        } else if (b.type === 'spacer') {
            resolved.push({ ...base, type: 'spacer', config: { height: b.config.height } });
        } else if (b.type === 'gallery') {
            resolved.push({ ...base, type: 'gallery', config: {
                images: Array.isArray(b.config.images) ? b.config.images : [],
                columns: b.config.columns,
                height: b.config.height,
            } });
        }
    }
    return resolved;
}

export function resolveV2(
    config: CustomTemplateConfigV2,
    fields: FieldEntity[],
): ResolvedV2 {
    const bySlug = new Map(fields.map((f) => [f.slug, f]));
    const lookupOne = (slug: string | undefined): FieldEntity | null =>
        slug ? bySlug.get(slug) ?? null : null;
    const lookupMany = (slugs: string[]): FieldEntity[] =>
        slugs.map((s) => bySlug.get(s)).filter((f): f is FieldEntity => f !== undefined);

    const blocks: ResolvedV2Block[] = [];
    let hasHeader = false;
    for (const b of config.blocks) {
        const base = {
            id: b.id, x: b.x, y: b.y, w: b.w, h: b.h,
            pos: b.pos,
            secPadding: b.secPadding, secMargin: b.secMargin,
            colPadding: b.colPadding, colMargin: b.colMargin,
            secBg: b.secBg, colBg: b.colBg,
            // El estilo del bloque viaja crudo — lo interpreta blockStyle
            // en el render (mismo criterio que el editor y el portal).
            style: (b.config as { style?: Record<string, unknown> } | undefined)?.style,
        };
        if (b.type === 'header') {
            hasHeader = true;
            blocks.push({
                ...base,
                type: 'header',
                config: {
                    variant: b.config.variant,
                    showAvatar: b.config.show_avatar,
                    showIdBadge: b.config.show_id_badge,
                    showSubtitle: b.config.show_subtitle,
                    showCreatedAt: b.config.show_created_at,
                    showStatusStrip: b.config.show_status_strip,
                    showActions: b.config.show_actions,
                    accentColor: b.config.accent_color,
                },
            });
        } else if (b.type === 'properties_group') {
            blocks.push({
                ...base,
                type: 'properties_group',
                config: {
                    label: b.config.label,
                    icon: iconForKey(b.config.icon_key),
                    fields: lookupMany(b.config.field_slugs),
                    collapsedByDefault: b.config.collapsed_by_default,
                    // Defaults: compact + card. Plantillas viejas que no
                    // tengan estos keys siguen renderizándose como antes
                    // pero con la mejora de densidad activa.
                    density: b.config.density ?? 'compact',
                    variant: b.config.variant ?? 'card',
                },
            });
        } else if (b.type === 'timeline') {
            blocks.push({ ...base, type: 'timeline' });
        } else if (b.type === 'stats') {
            const mode = b.config.mode ?? 'auto';
            const items = (b.config.items ?? []).map((it) => {
                if (it.kind === 'field') {
                    const f = bySlug.get(it.field_slug);
                    if (! f) return null;
                    return { kind: 'field' as const, field: f, label: it.label };
                }
                return it;
            }).filter((x): x is NonNullable<typeof x> => x !== null);
            blocks.push({
                ...base,
                type: 'stats',
                config: { mode, items },
            });
        } else if (b.type === 'related') {
            const f = bySlug.get(b.config.field_slug);
            if (f && f.type === 'relation') {
                blocks.push({ ...base, type: 'related', config: { field: f } });
            }
        } else if (b.type === 'notes') {
            blocks.push({
                ...base,
                type: 'notes',
                config: {
                    title: b.config.title,
                    source: b.config.source ?? 'literal',
                    content: b.config.content,
                    field: b.config.field_slug ? bySlug.get(b.config.field_slug) ?? null : null,
                },
            });
        } else if (b.type === 'kpi') {
            blocks.push({
                ...base,
                type: 'kpi',
                config: {
                    field: bySlug.get(b.config.field_slug) ?? null,
                    label: b.config.label,
                    format: b.config.format,
                    prefix: b.config.prefix,
                    suffix: b.config.suffix,
                    goalValue: b.config.goal_value,
                },
            });
        } else if (b.type === 'chart') {
            const rel = bySlug.get(b.config.relation_field_slug);
            blocks.push({
                ...base,
                type: 'chart',
                config: {
                    relationField: rel && rel.type === 'relation' ? rel : null,
                    groupByFieldSlug: b.config.group_by_field_slug,
                    title: b.config.title,
                },
            });
        } else if (b.type === 'files') {
            // file_field_slugs vacío = todos los fields tipo `file`.
            const fileFields = b.config.file_field_slugs.length > 0
                ? lookupMany(b.config.file_field_slugs).filter((f) => f.type === 'file')
                : fields.filter((f) => f.type === 'file');
            blocks.push({
                ...base,
                type: 'files',
                config: { fileFields, title: b.config.title },
            });
        } else if (b.type === 'embed') {
            blocks.push({
                ...base,
                type: 'embed',
                config: {
                    source: b.config.source,
                    url: b.config.url,
                    fieldSlug: b.config.field_slug,
                    title: b.config.title,
                },
            });
        } else if (b.type === 'action_button') {
            blocks.push({
                ...base,
                type: 'action_button',
                config: {
                    label: b.config.label,
                    actionType: b.config.action_type,
                    targetSource: b.config.target_source ?? 'literal',
                    target: b.config.target,
                    targetField: b.config.target_field_slug
                        ? bySlug.get(b.config.target_field_slug) ?? null
                        : null,
                    variant: b.config.variant,
                },
            });
        } else if (b.type === 'markdown') {
            blocks.push({
                ...base,
                type: 'markdown',
                config: {
                    title: b.config.title,
                    source: b.config.source ?? 'literal',
                    content: b.config.content,
                    field: b.config.field_slug ? bySlug.get(b.config.field_slug) ?? null : null,
                },
            });
        } else if (b.type === 'divider') {
            blocks.push({
                ...base,
                type: 'divider',
                config: { label: b.config.label },
            });
        } else if (b.type === 'heading') {
            blocks.push({
                ...base,
                type: 'heading',
                config: { text: b.config.text, level: b.config.level },
            });
        } else if (b.type === 'comments_thread') {
            blocks.push({
                ...base,
                type: 'comments_thread',
                config: { title: b.config.title },
            });
        } else if (b.type === 'image') {
            blocks.push({
                ...base,
                type: 'image',
                config: {
                    url: b.config.url,
                    imageFileId: b.config.image_file_id,
                    alt: b.config.alt,
                    height: b.config.height,
                    fit: b.config.fit,
                    linkUrl: b.config.link_url,
                },
            });
        } else if (b.type === 'spacer') {
            blocks.push({ ...base, type: 'spacer', config: { height: b.config.height } });
        } else if (b.type === 'gallery') {
            blocks.push({
                ...base,
                type: 'gallery',
                config: {
                    images: Array.isArray(b.config.images) ? b.config.images : [],
                    columns: b.config.columns,
                    height: b.config.height,
                },
            });
        } else if (b.type === 'nested_section') {
            // Resolver recursivo: cada sub-bloque pasa por el mismo
            // pipeline (resolveV2 mini) usando los mismos `fields` y
            // helpers de inflación. Los sub-bloques NO pueden ser
            // otro `nested_section` (1 nivel), así que invocamos un
            // mini-resolver inline que respeta esa restricción.
            const resolvedColumns = b.config.columns.map((col) => ({
                id: col.id,
                width: col.width,
                padding: col.padding,
                margin: col.margin,
                blocks: resolveNestedSubBlocks(col.blocks, fields),
            }));
            blocks.push({
                ...base,
                type: 'nested_section',
                config: {
                    columns: resolvedColumns,
                    padding: b.config.padding,
                    margin: b.config.margin,
                },
            });
        }
    }

    const quickActions: QuickActionEntry[] = [];
    for (const slug of config.header.quick_action_field_slugs) {
        const f = bySlug.get(slug);
        if (! f) continue;
        const kind = f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'phone';
        quickActions.push({ field: f, kind });
    }

    // Backward-compat: plantillas V2 serializadas antes de 0.49.0 (y
    // todas las built-in resueltas por V2Builder, que no emite header
    // block) no tienen header. Inyectamos uno sintético al tope.
    //
    // 0.57.23 — En el modelo por filas, `y` es índice de fila. Para
    // insertar header al tope shifteamos los y existentes +1 (no +4
    // como en el modelo legacy de rowHeight).
    if (! hasHeader) {
        for (const b of blocks) {
            b.y += 1;
        }
        blocks.unshift({
            id: '__synthetic_header__',
            x: 0, y: 0, w: 12, h: 0,
            type: 'header',
            config: defaultHeaderResolvedConfig(),
        });
    }

    return {
        header: {
            titleField: lookupOne(config.header.title_field_slug),
            subtitleFields: lookupMany(config.header.subtitle_field_slugs),
            statusFields: lookupMany(config.header.status_field_slugs),
            quickActions,
        },
        blocks,
    };
}

/**
 * Defaults para un header block — usado tanto por la inyección
 * sintética en `getResolvedV2` (backward-compat) como por la palette
 * del editor cuando el user agrega un header block desde cero.
 */
export function defaultHeaderResolvedConfig(): {
    variant: 'hero' | 'compact' | 'minimal' | 'banner';
    showAvatar: boolean;
    showIdBadge: boolean;
    showSubtitle: boolean;
    showCreatedAt: boolean;
    showStatusStrip: boolean;
    showActions: boolean;
    accentColor: string | null;
} {
    return {
        variant: 'hero',
        showAvatar: true,
        showIdBadge: true,
        showSubtitle: true,
        showCreatedAt: true,
        showStatusStrip: true,
        // 0.57.34 — mismo razonamiento que `defaultHeaderBlockConfig`.
        showActions: false,
        accentColor: null,
    };
}

/**
 * Versión serializable (snake_case) del header config — para construir
 * el bloque desde la palette del editor.
 */
export function defaultHeaderBlockConfig(): V2HeaderBlock['config'] {
    return {
        variant: 'hero',
        show_avatar: true,
        show_id_badge: true,
        show_subtitle: true,
        show_created_at: true,
        show_status_strip: true,
        // 0.57.34 — `show_actions` default `false`. Los botones
        // Guardar/Eliminar duplicaban funcionalidad disponible en
        // otros lados (drawer, página standalone) y rompían el
        // layout cuando el header convivía con bloques de altura
        // limitada. Si el user los quiere, los activa desde el
        // inspector. Para templates EXISTENTES con `true` explícito
        // (persisted), se respeta el valor — solo aplica a nuevos.
        show_actions: false,
        accent_color: null,
    };
}

/**
 * Helper para que el RecordCrmLayout decida entre V2 custom o
 * built-in (que se renderea con el grid default migrando V1→V2 al
 * vuelo). Devuelve `null` cuando la lista no está en modo CRM o
 * cuando no se puede resolver (e.g. fields aún cargando).
 */
export function getResolvedV2(
    settings: { crm_template_id?: string; crm_template_custom?: unknown },
    fields: FieldEntity[],
): ResolvedV2 {
    if (settings.crm_template_id === CUSTOM_TEMPLATE_ID) {
        return resolveV2(ensureV2(settings.crm_template_custom), fields);
    }
    // Built-in: cada plantilla declara su propio `resolveV2` que
    // produce un grid visiblemente distinto. Sin esto, todas las
    // built-ins migraban por el mismo `migrateV1toV2` genérico y
    // terminaban viéndose casi iguales — el switch entre ellas no
    // cambiaba nada perceptible.
    const tpl = getTemplate(settings.crm_template_id);
    const v2Config = tpl.resolveV2
        ? tpl.resolveV2(fields)
        : migrateV1toV2(layoutToV1Config(tpl.resolve(fields)));
    return resolveV2(v2Config, fields);
}

/**
 * Convierte un `ResolvedLayout` (V1 builtin) a `CustomTemplateConfig`
 * V1 — para luego pasarlo a migrateV1toV2. Es la pieza que hace que
 * los built-ins también pasen por el sistema de grid.
 */
function layoutToV1Config(layout: ResolvedLayout): CustomTemplateConfig {
    return {
        title_field_slug: layout.titleField?.slug,
        subtitle_field_slugs: layout.subtitleFields.map((f) => f.slug),
        status_field_slugs: layout.statusFields.map((f) => f.slug),
        quick_action_field_slugs: layout.quickActions.map((q) => q.field.slug),
        sidebar_groups: layout.sidebarGroups.map((g, i) => ({
            id: g.id || `group-${i}`,
            label: g.label,
            icon_key: matchIconKey(g.icon),
            field_slugs: g.fields.map((f) => f.slug),
            collapsed_by_default: g.collapsedByDefault,
        })),
        show_stats: layout.rightRail.some((b) => b.kind === 'stats'),
        related_field_slugs: layout.rightRail
            .filter((b): b is { id: string; kind: 'related'; field: FieldEntity } => b.kind === 'related')
            .map((b) => b.field.slug),
    };
}

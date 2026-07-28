export interface ListSummary {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    settings: Record<string, unknown>;
    position: number;
    /** Carpeta del menú, o null = cuelga de la raíz (v0.1.130). */
    group_id: number | null;
    created_by: number;
    created_at: string;
    updated_at: string;
    table_suffix?: string;
}

export interface CreateListInput {
    name: string;
    slug?: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    settings?: Record<string, unknown>;
}

export interface UpdateListInput {
    name?: string;
    slug?: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    settings?: Record<string, unknown>;
    position?: number;
    /** `null` saca la lista de su carpeta. */
    group_id?: number | null;
}

/** Carpeta del menú de listas (v0.1.130). */
export interface ListGroup {
    id: number;
    name: string;
    position: number;
}

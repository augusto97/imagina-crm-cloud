export interface ListSummary {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    settings: Record<string, unknown>;
    position: number;
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
}

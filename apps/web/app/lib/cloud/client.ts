import {
    activitySchema,
    aggregateResultSchema,
    apiErrorSchema,
    authSessionSchema,
    automationSchema,
    automationRunSchema,
    billingSummarySchema,
    bootstrapSchema,
    brandingResponseSchema,
    commentSchema,
    consumeMagicLinkSchema,
    createAutomationSchema,
    createCommentSchema,
    createFieldSchema,
    createListSchema,
    createRecordSchema,
    createViewSchema,
    exportBundleSchema,
    fieldSchema,
    importResultSchema,
    importRowsSchema,
    issueMagicLinkSchema,
    listSchema,
    loginInputSchema,
    addMemberSchema,
    checkoutResultSchema,
    createCheckoutSchema,
    magicLinkResultSchema,
    paginated,
    paymentConfigSchema,
    portalBootSchema,
    recordSchema,
    updateMemberRoleSchema,
    updateStatusSchema,
    workspaceMemberSchema,
    registerInputSchema,
    slugCheckResultSchema,
    smtpConfigSchema,
    smtpConfigPublicSchema,
    updateAutomationSchema,
    updateBrandingSchema,
    updateCommentSchema,
    updateFieldSchema,
    updateListSchema,
    updateRecordSchema,
    updateViewSchema,
    viewSchema,
    type ActivityDto,
    type AggregateRequest,
    type AggregateResult,
    type AuthSession,
    type Automation,
    type AutomationRun,
    type BillingSummary,
    type Bootstrap,
    type BrandingResponse,
    type CommentDto,
    type CreateAutomationInput,
    type CreateCommentInput,
    type CreateFieldInput,
    type CreateListInput,
    type CreateRecordInput,
    type CreateViewInput,
    type ExportBundle,
    type Field,
    type ImportResult,
    type ImportRowsInput,
    type IssueMagicLinkInput,
    type List,
    type ListRecordsQuery,
    type LoginInput,
    type AddMemberInput,
    type CheckoutResult,
    type CreateCheckoutInput,
    type MagicLinkResult,
    type PaymentConfig,
    type PortalBoot,
    type RecordDto,
    type UpdateMemberRoleInput,
    type UpdateStatus,
    type WorkspaceMember,
    type RegisterInput,
    type SlugCheckQuery,
    type SlugCheckResult,
    type SmtpConfig,
    type SmtpConfigPublic,
    type UpdateAutomationInput,
    type UpdateBrandingInput,
    type UpdateCommentInput,
    type UpdateFieldInput,
    type UpdateListInput,
    type UpdateRecordInput,
    type UpdateViewInput,
    type View,
} from '@imagina-base/shared';
import { z } from 'zod';

/**
 * Cliente del API de Imagina Base (reemplaza al transporte wp-json/nonce del
 * fork — HANDOFF §5 / STANDALONE §6). Auth por cookie de sesión httpOnly +
 * header `X-Tenant-Id`. Tipado y VALIDADO con los MISMOS schemas Zod que usa
 * el backend (`@imagina-base/shared`): un shape, una definición, cero drift.
 */

/** Error tipado con el shape del contrato: `{ code, message, data:{status,errors} }`. */
export class CloudApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code: string,
        readonly errors: Record<string, string> = {},
    ) {
        super(message);
        this.name = 'CloudApiError';
    }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CloudClientOptions {
    /** Base del API. Default `/api/v1`; en dev apuntá al backend con VITE_API_URL. */
    baseUrl?: string;
    /** Tenant activo (workspace). Se envía como header `X-Tenant-Id`. */
    getTenantId?: () => number | string | null;
}

function readEnvBaseUrl(): string {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_API_URL?.replace(/\/$/, '') ?? '/api/v1';
}

export class CloudClient {
    private readonly baseUrl: string;
    private readonly getTenantId: () => number | string | null;

    constructor(options: CloudClientOptions = {}) {
        this.baseUrl = (options.baseUrl ?? readEnvBaseUrl()).replace(/\/$/, '');
        this.getTenantId = options.getTenantId ?? (() => null);
    }

    // --- auth ---
    register(input: RegisterInput): Promise<AuthSession> {
        return this.request('POST', '/auth/register', {
            body: registerInputSchema.parse(input),
            schema: authSessionSchema,
        });
    }
    login(input: LoginInput): Promise<AuthSession> {
        return this.request('POST', '/auth/login', {
            body: loginInputSchema.parse(input),
            schema: authSessionSchema,
        });
    }
    logout(): Promise<void> {
        return this.request('POST', '/auth/logout', {});
    }
    me(): Promise<AuthSession> {
        return this.request('GET', '/auth/me', { schema: authSessionSchema });
    }
    forgotPassword(email: string): Promise<void> {
        return this.request('POST', '/auth/forgot-password', { body: { email } });
    }
    resetPassword(token: string, password: string): Promise<void> {
        return this.request('POST', '/auth/reset-password', { body: { token, password } });
    }

    // --- bootstrap (primer paint, 1 round-trip) ---
    bootstrap(): Promise<Bootstrap> {
        return this.request('GET', '/bootstrap', { schema: bootstrapSchema });
    }

    // --- lists ---
    listLists(): Promise<List[]> {
        return this.unwrap(this.request('GET', '/lists', { schema: dataArray(listSchema) }));
    }
    getList(idOrSlug: string | number): Promise<List> {
        return this.request('GET', `/lists/${idOrSlug}`, { schema: listSchema });
    }
    createList(input: CreateListInput): Promise<List> {
        return this.request('POST', '/lists', { body: createListSchema.parse(input), schema: listSchema });
    }
    updateList(idOrSlug: string | number, patch: UpdateListInput): Promise<List> {
        return this.request('PATCH', `/lists/${idOrSlug}`, {
            body: updateListSchema.parse(patch),
            schema: listSchema,
        });
    }
    deleteList(idOrSlug: string | number): Promise<void> {
        return this.request('DELETE', `/lists/${idOrSlug}`, {});
    }

    // --- fields ---
    listFields(list: string | number): Promise<Field[]> {
        return this.unwrap(this.request('GET', `/lists/${list}/fields`, { schema: dataArray(fieldSchema) }));
    }
    createField(list: string | number, input: CreateFieldInput): Promise<Field> {
        return this.request('POST', `/lists/${list}/fields`, {
            body: createFieldSchema.parse(input),
            schema: fieldSchema,
        });
    }
    updateField(list: string | number, field: string | number, patch: UpdateFieldInput): Promise<Field> {
        return this.request('PATCH', `/lists/${list}/fields/${field}`, {
            body: updateFieldSchema.parse(patch),
            schema: fieldSchema,
        });
    }
    deleteField(list: string | number, field: string | number): Promise<void> {
        return this.request('DELETE', `/lists/${list}/fields/${field}`, {});
    }

    // --- records ---
    listRecords(
        list: string | number,
        query: Partial<ListRecordsQuery> = {},
    ): Promise<{ data: RecordDto[]; meta: { next_cursor: string | null } }> {
        const q: Record<string, unknown> = {};
        if (query.cursor !== undefined) q.cursor = query.cursor;
        if (query.limit !== undefined) q.limit = query.limit;
        if (query.sort_dir !== undefined) q.sort_dir = query.sort_dir;
        if (query.filter_tree !== undefined) q.filter = JSON.stringify(query.filter_tree);
        return this.request('GET', `/lists/${list}/records`, {
            query: q,
            schema: paginated(recordSchema),
        });
    }
    createRecord(list: string | number, input: CreateRecordInput): Promise<RecordDto> {
        return this.request('POST', `/lists/${list}/records`, {
            body: createRecordSchema.parse(input),
            schema: recordSchema,
        });
    }
    updateRecord(list: string | number, id: number, input: UpdateRecordInput): Promise<RecordDto> {
        return this.request('PATCH', `/lists/${list}/records/${id}`, {
            body: updateRecordSchema.parse(input),
            schema: recordSchema,
        });
    }
    deleteRecord(list: string | number, id: number): Promise<void> {
        return this.request('DELETE', `/lists/${list}/records/${id}`, {});
    }

    // --- views ---
    listViews(list: string | number): Promise<View[]> {
        return this.unwrap(this.request('GET', `/lists/${list}/views`, { schema: dataArray(viewSchema) }));
    }
    createView(list: string | number, input: CreateViewInput): Promise<View> {
        return this.request('POST', `/lists/${list}/views`, {
            body: createViewSchema.parse(input),
            schema: viewSchema,
        });
    }
    updateView(list: string | number, id: number, patch: UpdateViewInput): Promise<View> {
        return this.request('PATCH', `/lists/${list}/views/${id}`, {
            body: updateViewSchema.parse(patch),
            schema: viewSchema,
        });
    }
    deleteView(list: string | number, id: number): Promise<void> {
        return this.request('DELETE', `/lists/${list}/views/${id}`, {});
    }

    // --- slugs ---
    checkSlug(query: SlugCheckQuery): Promise<SlugCheckResult> {
        return this.request('GET', '/slugs/check', {
            query: { ...query },
            schema: slugCheckResultSchema,
        });
    }

    // --- comments ---
    listComments(list: string | number, recordId: number): Promise<CommentDto[]> {
        return this.unwrap(
            this.request('GET', `/lists/${list}/records/${recordId}/comments`, {
                schema: dataArray(commentSchema),
            }),
        );
    }
    createComment(list: string | number, recordId: number, input: CreateCommentInput): Promise<CommentDto> {
        return this.request('POST', `/lists/${list}/records/${recordId}/comments`, {
            body: createCommentSchema.parse(input),
            schema: commentSchema,
        });
    }
    updateComment(
        list: string | number,
        recordId: number,
        id: number,
        patch: UpdateCommentInput,
    ): Promise<CommentDto> {
        return this.request('PATCH', `/lists/${list}/records/${recordId}/comments/${id}`, {
            body: updateCommentSchema.parse(patch),
            schema: commentSchema,
        });
    }
    deleteComment(list: string | number, recordId: number, id: number): Promise<void> {
        return this.request('DELETE', `/lists/${list}/records/${recordId}/comments/${id}`, {});
    }

    // --- activity ---
    recordActivity(list: string | number, recordId: number): Promise<ActivityDto[]> {
        return this.request('GET', `/lists/${list}/records/${recordId}/activity`, {
            schema: paginated(activitySchema),
        }).then((r) => r.data);
    }

    // --- aggregate ---
    aggregate(list: string | number, req: AggregateRequest): Promise<AggregateResult> {
        return this.request('POST', `/lists/${list}/aggregate`, {
            body: req,
            schema: aggregateResultSchema,
        });
    }

    // --- automations ---
    listAutomations(list: string | number): Promise<Automation[]> {
        return this.unwrap(
            this.request('GET', `/lists/${list}/automations`, { schema: dataArray(automationSchema) }),
        );
    }
    createAutomation(list: string | number, input: CreateAutomationInput): Promise<Automation> {
        return this.request('POST', `/lists/${list}/automations`, {
            body: createAutomationSchema.parse(input),
            schema: automationSchema,
        });
    }
    updateAutomation(list: string | number, id: number, patch: UpdateAutomationInput): Promise<Automation> {
        return this.request('PATCH', `/lists/${list}/automations/${id}`, {
            body: updateAutomationSchema.parse(patch),
            schema: automationSchema,
        });
    }
    deleteAutomation(list: string | number, id: number): Promise<void> {
        return this.request('DELETE', `/lists/${list}/automations/${id}`, {});
    }
    automationRuns(id: number): Promise<AutomationRun[]> {
        return this.request('GET', `/automations/${id}/runs`, {
            schema: paginated(automationRunSchema),
        }).then((r) => r.data);
    }

    // --- members (panel admin) ---
    listMembers(): Promise<WorkspaceMember[]> {
        return this.unwrap(
            this.request('GET', '/workspaces/current/members', {
                schema: dataArray(workspaceMemberSchema),
            }),
        );
    }
    addMember(input: AddMemberInput): Promise<WorkspaceMember> {
        return this.request('POST', '/workspaces/current/members', {
            body: addMemberSchema.parse(input),
            schema: workspaceMemberSchema,
        });
    }
    updateMemberRole(userId: number, input: UpdateMemberRoleInput): Promise<WorkspaceMember> {
        return this.request('PATCH', `/workspaces/current/members/${userId}`, {
            body: updateMemberRoleSchema.parse(input),
            schema: workspaceMemberSchema,
        });
    }
    removeMember(userId: number): Promise<void> {
        return this.request('DELETE', `/workspaces/current/members/${userId}`, {});
    }

    // --- branding white-label del workspace ---
    getBranding(): Promise<BrandingResponse> {
        return this.request('GET', '/workspaces/current/branding', { schema: brandingResponseSchema });
    }
    updateBranding(patch: UpdateBrandingInput): Promise<BrandingResponse> {
        return this.request('PATCH', '/workspaces/current/branding', {
            body: updateBrandingSchema.parse(patch),
            schema: brandingResponseSchema,
        });
    }

    // --- SMTP propio del workspace (white-label de correo, sólo admin) ---
    tenantSmtpGet(): Promise<SmtpConfigPublic> {
        return this.request('GET', '/workspaces/current/smtp', { schema: smtpConfigPublicSchema });
    }
    tenantSmtpSet(input: SmtpConfig): Promise<SmtpConfigPublic> {
        return this.request('PATCH', '/workspaces/current/smtp', {
            body: smtpConfigSchema.parse(input),
            schema: smtpConfigPublicSchema,
        });
    }
    /** Vuelve al correo de la plataforma (borra la config propia). */
    tenantSmtpClear(): Promise<void> {
        return this.request('DELETE', '/workspaces/current/smtp', {});
    }
    /** Envía un correo de prueba al email del propio admin (sin cola). */
    tenantSmtpTest(): Promise<{ ok: boolean; error?: string }> {
        return this.request('POST', '/workspaces/current/smtp/test', {
            schema: z.object({ ok: z.boolean(), error: z.string().optional() }),
        });
    }
    /**
     * Sube un archivo al módulo de archivos (ADR-S16, `POST /files` multipart
     * campo `file`). Sin `Content-Type` manual: el browser arma el boundary.
     */
    async uploadFile(file: File): Promise<{ id: number }> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        const tenantId = this.getTenantId();
        if (tenantId !== null && tenantId !== undefined) headers['X-Tenant-Id'] = String(tenantId);
        const form = new FormData();
        form.append('file', file);
        const response = await fetch(`${this.baseUrl}/files`, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: form,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw toApiError(payload, response.status);
        return z.object({ id: z.number().int().positive() }).parse(payload);
    }

    // --- billing ---
    billing(): Promise<BillingSummary> {
        return this.request('GET', '/billing', { schema: billingSummarySchema });
    }

    // --- auto-actualización (ADR-S13, sólo superadmin) ---
    updateStatus(): Promise<UpdateStatus> {
        return this.request('GET', '/system/update/status', { schema: updateStatusSchema });
    }
    updateCheck(): Promise<UpdateStatus> {
        return this.request('POST', '/system/update/check', { schema: updateStatusSchema });
    }
    updateRun(): Promise<{ queued: boolean; message: string }> {
        return this.request('POST', '/system/update/run', {
            schema: z.object({ queued: z.boolean(), message: z.string() }),
        });
    }
    updateRollback(): Promise<{ ok: boolean; message: string }> {
        return this.request('POST', '/system/update/rollback', {
            schema: z.object({ ok: z.boolean(), message: z.string() }),
        });
    }

    // --- SMTP de plataforma (ADR-S11, sólo superadmin) ---
    smtpGet(): Promise<SmtpConfigPublic> {
        return this.request('GET', '/system/smtp', { schema: smtpConfigPublicSchema });
    }
    smtpSet(input: SmtpConfig): Promise<void> {
        return this.request('PUT', '/system/smtp', { body: smtpConfigSchema.parse(input) });
    }
    smtpTest(to: string): Promise<void> {
        return this.request('POST', '/system/smtp/test', { body: { to } });
    }

    // --- payments (ADR-S12) ---
    paymentsConfig(): Promise<PaymentConfig> {
        return this.request('GET', '/billing/payments/config', { schema: paymentConfigSchema });
    }
    createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult> {
        return this.request('POST', '/billing/checkout', {
            body: createCheckoutSchema.parse(input),
            schema: checkoutResultSchema,
        });
    }

    // --- export / import ---
    exportList(list: string | number): Promise<ExportBundle> {
        return this.request('GET', `/lists/${list}/export`, { schema: exportBundleSchema });
    }
    importRows(list: string | number, input: ImportRowsInput): Promise<ImportResult> {
        return this.request('POST', `/lists/${list}/import`, {
            body: importRowsSchema.parse(input),
            schema: importResultSchema,
        });
    }

    // --- portal ---
    issueMagicLink(list: string | number, input: IssueMagicLinkInput): Promise<MagicLinkResult> {
        return this.request('POST', `/lists/${list}/portal/magic-link`, {
            body: issueMagicLinkSchema.parse(input),
            schema: magicLinkResultSchema,
        });
    }
    /** Portal público: canjea el token de un solo uso y abre la sesión client. */
    consumePortal(token: string): Promise<void> {
        return this.request('POST', '/portal/consume', {
            body: consumeMagicLinkSchema.parse({ token }),
        });
    }
    /** Boot del portal para el client autenticado (record + campos + template). */
    portalMe(): Promise<PortalBoot> {
        return this.request('GET', '/portal/me', { schema: portalBootSchema });
    }

    private async unwrap<T>(p: Promise<{ data: T }>): Promise<T> {
        return (await p).data;
    }

    private async request<S extends z.ZodTypeAny>(
        method: Method,
        path: string,
        opts: { query?: Record<string, unknown>; body?: unknown; schema: S },
    ): Promise<z.output<S>>;
    private async request(
        method: Method,
        path: string,
        opts: { query?: Record<string, unknown>; body?: unknown; schema?: undefined },
    ): Promise<void>;
    private async request(
        method: Method,
        path: string,
        opts: { query?: Record<string, unknown>; body?: unknown; schema?: z.ZodTypeAny },
    ): Promise<unknown> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        const tenantId = this.getTenantId();
        if (tenantId !== null && tenantId !== undefined) headers['X-Tenant-Id'] = String(tenantId);
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

        const response = await fetch(buildUrl(this.baseUrl, path, opts.query), {
            method,
            headers,
            credentials: 'include',
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });

        if (response.status === 204 || response.headers.get('content-length') === '0') {
            return undefined;
        }

        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            throw toApiError(payload, response.status);
        }
        return opts.schema ? opts.schema.parse(payload) : payload;
    }
}

function dataArray<T extends z.ZodTypeAny>(item: T) {
    return z.object({ data: z.array(item) });
}

function buildUrl(base: string, path: string, query?: Record<string, unknown>): string {
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    if (!query) return url;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) params.append(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
}

function toApiError(payload: unknown, status: number): CloudApiError {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
        return new CloudApiError(
            parsed.data.message,
            parsed.data.data.status,
            parsed.data.code,
            parsed.data.data.errors ?? {},
        );
    }
    return new CloudApiError('Error de red o respuesta inesperada', status, 'network_error');
}

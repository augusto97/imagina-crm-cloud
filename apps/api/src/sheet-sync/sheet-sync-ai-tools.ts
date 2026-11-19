import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { SHEET_DIRECTION_LABELS, describeSheetInterval, spreadsheetUrl } from '@imagina-base/shared';
import { AiToolRegistry, toolAllowed, type AiToolContext } from '../ai/tools/registry';
import { SheetSyncService } from './sheet-sync.service';

/**
 * v0.1.459 (G3) — `get_list_schema` cuenta si la lista se sincroniza con una
 * hoja de Google Sheets: qué planilla y pestaña, en qué sentido, qué columna
 * es la clave y qué columnas van a qué campos. Sin secretos (la conexión es
 * OAuth: el token nunca sale). Sólo para quien administra listas, como en la
 * app: la sincronización se configura en Integraciones.
 */
@Injectable()
export class SheetSyncAiTools implements OnModuleInit {
    constructor(
        private readonly syncs: SheetSyncService,
        @Optional() private readonly registry?: AiToolRegistry,
    ) {}

    onModuleInit(): void {
        this.registry?.addListSchemaExtra((ctx, list) => this.schemaExtra(ctx, list));
    }

    async schemaExtra(ctx: AiToolContext, list: { id: number }): Promise<Record<string, unknown>> {
        if (!toolAllowed({ role: ctx.role, capabilities: ctx.capabilities }, 'manage_lists')) return {};
        const rows = await this.syncs.forList(ctx.tenantId, list.id);
        if (rows.length === 0) return {};
        return {
            google_sheets: {
                _nota:
                    'Esta lista se sincroniza con una hoja de Google Sheets. Lo que se cambia en la lista viaja a la hoja (y al revés) según el sentido. ' +
                    'Si la misma celda cambió en los dos lados, gana la app. Se configura en Ajustes → Integraciones → Google Sheets → Sincronizar con una hoja.',
                items: rows.map(({ row, settings }) => {
                    const st = (row.state ?? {}) as Record<string, unknown>;
                    return {
                        id: row.id,
                        name: row.name,
                        enabled: row.enabled,
                        spreadsheet: settings.spreadsheet_title || settings.spreadsheet_id,
                        sheet: settings.sheet_title,
                        url: spreadsheetUrl(settings.spreadsheet_id, settings.sheet_gid),
                        direction: settings.direction,
                        direction_label: SHEET_DIRECTION_LABELS[settings.direction],
                        key:
                            settings.key.mode === 'app_id'
                                ? { column: settings.key.column, is: 'número del registro (lo escribe la app)' }
                                : { column: settings.key.column, field_id: settings.key.field_id },
                        columns: settings.columns.map((c) => ({ column: c.column, field_id: c.field_id })),
                        every: describeSheetInterval(settings.interval_minutes),
                        last_run_at: typeof st.last_run_at === 'string' ? st.last_run_at : null,
                        last_error: typeof st.last_error === 'string' ? st.last_error : null,
                    };
                }),
            },
        };
    }
}

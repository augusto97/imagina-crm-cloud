import {
    BadRequestException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    jsonbKeyForField,
    validateFieldValue,
    type Field,
    type RecurrenceDto,
    type RecurrenceUpsertInput,
} from '@imagina-base/shared';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository } from '../records/records.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { comparableDate, hasTimeComponent, nextOccurrence, nowUtc } from './date-roller';
import { RecurrencesRepository, type RecurrenceRow } from './recurrences.repository';

/** Resultado interno de un fire (para emitir realtime/automations tras el tx). */
interface FireOutcome {
    kind: 'created' | 'updated';
    recordId: number;
    before?: Record<string, unknown>;
    after: Record<string, unknown>;
}

/**
 * Casos de uso de recurrencias (port de `RecurrenceService` +
 * `RecurrenceRunner` del plugin): validar/persistir la config, y "disparar"
 * la rotación — avanzar la fecha del campo vía DateRoller y, según
 * `action_type`, actualizar el record actual o clonarlo.
 *
 * IMPORTANTE (anti-circularidad): NO inyecta RecordsService — el update/clone
 * se hace a bajo nivel (tx + RecordsRepository + ActivityService +
 * RealtimeService + AutomationDispatcher), espejando lo que hace
 * records.service.ts en sus mutaciones. Así RecordsService puede a su vez
 * inyectar este service (hook post-update) sin ciclo.
 */
@Injectable()
export class RecurrencesService {
    private readonly logger = new Logger(RecurrencesService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: RecurrencesRepository,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly automations: AutomationDispatcher,
        /**
         * Conexión base (owner) SOLO para que el tick global enumere las
         * recurrencias trigger=schedule cross-tenant (un job de plataforma no
         * tiene tenant). Optional: los specs que instancian services a mano
         * sin tick no la necesitan.
         */
        @Optional() @Inject(DRIZZLE) private readonly db?: Db,
    ) {}

    /**
     * Upsert por (record, campo de fecha) — validaciones exactas del plugin
     * (`RecurrenceService::upsert`): el campo de fecha debe ser date/datetime
     * de la lista; con trigger status_change el campo de estado debe ser
     * select/checkbox de la lista y debe venir el valor target; un campo de
     * reset (update_status) inválido se ignora en silencio.
     */
    async upsert(
        tenantId: number,
        listIdOrSlug: string,
        recordId: number,
        input: RecurrenceUpsertInput,
    ): Promise<RecurrenceDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);

        const dateField = fields.find((f) => f.id === input.date_field_id);
        if (!dateField || (dateField.type !== 'date' && dateField.type !== 'datetime')) {
            throw validationFailed({ date_field_id: 'Campo de fecha inválido.' });
        }

        const intervalN = Math.max(1, input.interval_n);
        // monthly_pattern sólo aplica a frequency=monthly (default same_day).
        const monthlyPattern =
            input.frequency === 'monthly' ? (input.monthly_pattern ?? 'same_day') : null;

        let triggerStatusFieldId: number | null = null;
        let triggerStatusValue: string | null = null;
        if (input.trigger_type === 'status_change') {
            const sf = fields.find((f) => f.id === (input.trigger_status_field_id ?? 0));
            if (!sf || (sf.type !== 'select' && sf.type !== 'checkbox')) {
                throw validationFailed({
                    trigger_status_field_id: 'Campo de estado inválido para el trigger.',
                });
            }
            if (input.trigger_status_value === undefined || input.trigger_status_value === null) {
                throw validationFailed({
                    trigger_status_value: 'Falta el valor de estado que dispara la recurrencia.',
                });
            }
            triggerStatusFieldId = sf.id;
            triggerStatusValue = String(input.trigger_status_value);
        }

        let updateStatusFieldId: number | null = null;
        let updateStatusValue: string | null = null;
        if (input.update_status_field_id != null && input.update_status_field_id > 0) {
            const us = fields.find((f) => f.id === input.update_status_field_id);
            // Paridad con el plugin: un campo de reset inválido NO falla — se ignora.
            if (us && (us.type === 'select' || us.type === 'checkbox')) {
                updateStatusFieldId = us.id;
                updateStatusValue = String(input.update_status_value ?? '');
            }
        }

        const repeatUntil =
            input.repeat_until != null && input.repeat_until.trim() !== ''
                ? input.repeat_until.trim()
                : null;

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // El record debe existir vivo en la lista (si no, el FK daría 500).
            const record = await this.recordsRepo.findById(tx, tenantId, list.id, recordId);
            if (!record) throw recordNotFound(recordId);
            return this.repo.upsert(tx, {
                tenantId,
                listId: list.id,
                recordId,
                dateFieldId: dateField.id,
                frequency: input.frequency,
                intervalN,
                monthlyPattern,
                triggerType: input.trigger_type,
                triggerStatusFieldId,
                triggerStatusValue,
                actionType: input.action_type,
                updateStatusFieldId,
                updateStatusValue,
                repeatUntil,
            });
        });
        return toDto(row);
    }

    async listForRecord(
        tenantId: number,
        listIdOrSlug: string,
        recordId: number,
    ): Promise<RecurrenceDto[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listForRecord(tx, tenantId, recordId),
        );
        return rows.filter((r) => r.listId === list.id).map(toDto);
    }

    /**
     * Batch para las celdas de fecha de una página de records
     * (`GET /lists/:l/recurrences?ids=…`): `record_id → Recurrence[]` en UNA
     * query. Prefill con `[]` para cada id pedido (la UI indexa sin chequear).
     */
    async batchByRecords(
        tenantId: number,
        listIdOrSlug: string,
        recordIds: number[],
    ): Promise<Record<string, RecurrenceDto[]>> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.batchForRecords(tx, tenantId, list.id, recordIds),
        );
        const out: Record<string, RecurrenceDto[]> = {};
        for (const id of recordIds) out[String(id)] = [];
        for (const row of rows) {
            (out[String(row.recordId)] ??= []).push(toDto(row));
        }
        return out;
    }

    async delete(
        tenantId: number,
        listIdOrSlug: string,
        recordId: number,
        id: number,
    ): Promise<void> {
        await this.lists.get(tenantId, listIdOrSlug);
        const deleted = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.delete(tx, tenantId, recordId, id),
        );
        if (!deleted) {
            throw new NotFoundException({
                code: 'recurrence_not_found',
                message: `Recurrencia ${id} no encontrada`,
                data: { status: 404 },
            });
        }
    }

    /**
     * Dispara la recurrencia (port exacto de `RecurrenceService::fire`):
     * avanza la fecha del campo y ejecuta la acción (update o clone).
     * No-op si el record/campo no existen, si ya se disparó para la fecha
     * actual (idempotencia por last_fired_at) o si pasó repeat_until.
     */
    async fire(rec: RecurrenceRow): Promise<void> {
        const tenantId = rec.tenantId;
        const outcome = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.fireInTx(tx, rec),
        );
        if (!outcome) return;
        this.realtime.records(tenantId, rec.listId);
        this.automations.dispatch({
            tenantId,
            listId: rec.listId,
            recordId: outcome.recordId,
            trigger: outcome.kind === 'created' ? 'record_created' : 'record_updated',
            after: outcome.after,
            before: outcome.before,
        });
    }

    private async fireInTx(tx: Tx, rec: RecurrenceRow): Promise<FireOutcome | null> {
        const tenantId = rec.tenantId;
        const record = await this.recordsRepo.findById(tx, tenantId, rec.listId, rec.recordId);
        if (!record) return null;
        const fields = await this.fields.listByListIdWithinTx(tx, tenantId, rec.listId);
        const dateField = fields.find((f) => f.id === rec.dateFieldId);
        if (!dateField) return null;

        const dateKey = jsonbKeyForField(dateField.id);
        const currentValue = (record.data as Record<string, unknown>)[dateKey];
        if (typeof currentValue !== 'string' || currentValue === '') return null;

        // Idempotencia: si la fecha ya está rodada respecto al last_fired_at,
        // no rodarla de nuevo (comparación de strings, semántica del plugin).
        if (
            rec.lastFiredAt !== null &&
            comparableDate(rec.lastFiredAt) > comparableDate(currentValue)
        ) {
            return null;
        }

        // Para `days_after` ("N días tras la finalización") el seed es el
        // momento del trigger (now UTC), no la fecha actual del campo.
        // Preservamos el estilo del valor (con/sin hora, T/espacio).
        let seed = currentValue;
        if (rec.frequency === 'days_after') {
            seed = hasTimeComponent(currentValue)
                ? currentValue.includes('T')
                    ? new Date().toISOString().replace(/\.\d+Z$/, 'Z')
                    : nowUtc()
                : nowUtc().slice(0, 10);
        }

        const nextDate = nextOccurrence(seed, {
            frequency: rec.frequency,
            intervalN: rec.intervalN,
            monthlyPattern: rec.monthlyPattern,
        });

        // Si pasó repeat_until, no disparar más.
        if (
            rec.repeatUntil !== null &&
            comparableDate(nextDate) > comparableDate(rec.repeatUntil)
        ) {
            return null;
        }

        const statusPatch = this.statusPatch(fields, rec);
        const firedAt = nowUtc();

        if (rec.actionType === 'clone') {
            // Clone: record nuevo con el data completo del original + fecha
            // rodada (+ reset de estado si está configurado).
            const data = { ...(record.data as Record<string, unknown>), [dateKey]: nextDate, ...statusPatch };
            const inserted = await this.recordsRepo.insert(tx, {
                tenantId,
                listId: rec.listId,
                data,
                createdBy: record.createdBy,
            });
            await this.activity.logInTx(tx, {
                tenantId,
                listId: rec.listId,
                recordId: inserted.id,
                userId: null,
                action: 'record_created',
                diff: computeDiff({}, inserted.data),
            });
            await this.repo.markFired(tx, tenantId, rec.id, firedAt);
            // La recurrencia se re-ancla al clon: es el que tiene la fecha
            // rodada, así la serie sigue disparando mes a mes. El original
            // queda como histórico (su fecha vieja, sin recurrencia).
            await this.repo.moveToRecord(tx, tenantId, rec.id, inserted.id);
            return { kind: 'created', recordId: inserted.id, after: inserted.data };
        }

        // Update: patch del campo fecha (+ reset de estado) sobre el record.
        const merged = { ...(record.data as Record<string, unknown>), [dateKey]: nextDate, ...statusPatch };
        const updated = await this.recordsRepo.updateData(tx, tenantId, rec.listId, rec.recordId, merged);
        if (!updated) return null;
        await this.activity.logInTx(tx, {
            tenantId,
            listId: rec.listId,
            recordId: rec.recordId,
            userId: null,
            action: 'record_updated',
            diff: computeDiff(record.data, merged),
        });
        await this.repo.markFired(tx, tenantId, rec.id, firedAt);
        return { kind: 'updated', recordId: rec.recordId, before: record.data, after: updated.data };
    }

    /**
     * Patch opcional de "reset de estado" al disparar (update_status_*). El
     * valor pasa por el validador compartido del campo (así un checkbox recibe
     * boolean y un select una opción válida); si no valida, se omite el reset
     * (el roll de fecha ocurre igual — paridad con la tolerancia del plugin).
     */
    private statusPatch(fields: Field[], rec: RecurrenceRow): Record<string, unknown> {
        if (rec.updateStatusFieldId === null || rec.updateStatusValue === null) return {};
        const statusField = fields.find((f) => f.id === rec.updateStatusFieldId);
        if (!statusField || (statusField.type !== 'select' && statusField.type !== 'checkbox')) {
            return {};
        }
        const result = validateFieldValue(
            { type: statusField.type, config: statusField.config, is_required: statusField.is_required },
            rec.updateStatusValue,
        );
        if (!result.ok || result.value === null) return {};
        return { [jsonbKeyForField(statusField.id)]: result.value };
    }

    /**
     * Hook llamado por RecordsService tras un update (fire-and-forget):
     * para cada recurrencia del record con trigger status_change, si el campo
     * de estado cambió entre before/after Y el valor nuevo es el target,
     * dispara. (Port de `RecurrenceRunner::onRecordUpdated`.)
     */
    async onRecordUpdated(
        tenantId: number,
        listId: number,
        recordId: number,
        before: Record<string, unknown>,
        after: Record<string, unknown>,
    ): Promise<void> {
        const recs = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listForRecord(tx, tenantId, recordId),
        );
        for (const rec of recs) {
            if (rec.listId !== listId) continue;
            if (rec.triggerType !== 'status_change') continue;
            if (rec.triggerStatusFieldId === null || rec.triggerStatusValue === null) continue;

            const key = jsonbKeyForField(rec.triggerStatusFieldId);
            const newVal = after[key] ?? null;
            const oldVal = before[key] ?? null;
            if (JSON.stringify(newVal) === JSON.stringify(oldVal)) continue;

            // Transición al valor target (comparación como strings): dispara.
            const newStr = newVal === null ? '' : String(newVal);
            if (newStr === String(rec.triggerStatusValue)) {
                await this.fire(rec);
            }
        }
    }

    /**
     * Barrido periódico (port de `RecurrenceService::tick`): para cada
     * recurrencia trigger=schedule, si la fecha del campo ya pasó
     * (`valor <= now`, comparación de strings naive UTC), dispara.
     *
     * OJO RLS: la enumeración cross-tenant usa la conexión base (sólo lee la
     * tabla recurrences); toda lectura/mutación de records va SIEMPRE dentro
     * de `withTenant(rec.tenantId)`.
     */
    async tick(): Promise<void> {
        if (!this.db) return;
        const recs = await this.repo.allScheduled(this.db);
        if (recs.length === 0) return;
        const now = comparableDate(nowUtc());

        for (const rec of recs) {
            try {
                const currentValue = await this.tenantDb.withTenant(rec.tenantId, async (tx) => {
                    const record = await this.recordsRepo.findById(
                        tx,
                        rec.tenantId,
                        rec.listId,
                        rec.recordId,
                    );
                    const v = record
                        ? (record.data as Record<string, unknown>)[jsonbKeyForField(rec.dateFieldId)]
                        : null;
                    return typeof v === 'string' && v !== '' ? v : null;
                });
                if (currentValue !== null && comparableDate(currentValue) <= now) {
                    await this.fire(rec);
                }
            } catch (err) {
                this.logger.error(
                    `Tick de recurrencia ${rec.id} (tenant ${rec.tenantId}) falló: ${String(err)}`,
                );
            }
        }
    }
}

function toDto(row: RecurrenceRow): RecurrenceDto {
    return {
        id: row.id,
        list_id: row.listId,
        record_id: row.recordId,
        date_field_id: row.dateFieldId,
        frequency: row.frequency as RecurrenceDto['frequency'],
        interval_n: row.intervalN,
        monthly_pattern: row.monthlyPattern as RecurrenceDto['monthly_pattern'],
        trigger_type: row.triggerType as RecurrenceDto['trigger_type'],
        trigger_status_field_id: row.triggerStatusFieldId,
        trigger_status_value: row.triggerStatusValue,
        action_type: row.actionType as RecurrenceDto['action_type'],
        update_status_field_id: row.updateStatusFieldId,
        update_status_value: row.updateStatusValue,
        repeat_until: row.repeatUntil,
        last_fired_at: row.lastFiredAt,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function validationFailed(errors: Record<string, string>): BadRequestException {
    return new BadRequestException({
        code: 'validation_failed',
        message: 'Recurrencia inválida',
        data: { status: 400, errors },
    });
}

function recordNotFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'record_not_found',
        message: `Registro ${id} no encontrado`,
        data: { status: 404 },
    });
}

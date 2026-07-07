<?php
declare(strict_types=1);

namespace ImaginaCRM\Exports;

/**
 * Snapshot inmutable de un job de export async (Fase 17.A).
 *
 * Tabla: `wp_imcrm_export_jobs`. Status enum:
 *  - `pending`: creado, esperando Action Scheduler.
 *  - `running`: el worker está procesando.
 *  - `ready`: archivo listo en `file_path`, download disponible.
 *  - `failed`: el worker capturó un error (en `error`).
 *
 * Los params del request original viven en `params` (JSON) — el
 * worker los re-aplica al `CsvExporter` para reconstruir el CSV.
 *
 * Trade-off `LONGTEXT $params`: aunque el shape esperado es
 * acotado (~1-2 KB), un `filter_tree` complejo puede crecer.
 * LONGTEXT no penaliza si las rows reales son chicas.
 */
final class ExportJobEntity
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_RUNNING = 'running';
    public const STATUS_READY   = 'ready';
    public const STATUS_FAILED  = 'failed';

    /**
     * @param array<string, mixed> $params
     */
    public function __construct(
        public readonly int $id,
        public readonly int $listId,
        public readonly int $userId,
        public readonly string $status,
        public readonly array $params,
        public readonly ?int $rowCount,
        public readonly ?string $filePath,
        public readonly ?string $error,
        public readonly string $createdAt,
        public readonly ?string $completedAt,
    ) {
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function fromRow(array $row): self
    {
        $paramsRaw = $row['params'] ?? null;
        $params = [];
        if (is_string($paramsRaw) && $paramsRaw !== '') {
            $decoded = json_decode($paramsRaw, true);
            if (is_array($decoded)) {
                $params = $decoded;
            }
        }
        return new self(
            id:          (int) ($row['id'] ?? 0),
            listId:      (int) ($row['list_id'] ?? 0),
            userId:      (int) ($row['user_id'] ?? 0),
            status:      (string) ($row['status'] ?? self::STATUS_PENDING),
            params:      $params,
            rowCount:    isset($row['row_count']) ? (int) $row['row_count'] : null,
            filePath:    isset($row['file_path']) ? (string) $row['file_path'] : null,
            error:       isset($row['error']) ? (string) $row['error'] : null,
            createdAt:   (string) ($row['created_at'] ?? ''),
            completedAt: isset($row['completed_at']) ? (string) $row['completed_at'] : null,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'id'           => $this->id,
            'list_id'      => $this->listId,
            'user_id'      => $this->userId,
            'status'       => $this->status,
            'row_count'    => $this->rowCount,
            'error'        => $this->error,
            'created_at'   => $this->createdAt,
            'completed_at' => $this->completedAt,
            // file_path y params son internos; NO se serializan al
            // cliente para evitar exfiltrar paths del filesystem.
        ];
    }
}

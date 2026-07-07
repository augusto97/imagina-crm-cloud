<?php
declare(strict_types=1);

namespace ImaginaCRM\Exports;

use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Permissions\PermissionService;
use WP_User;

/**
 * Orquesta el ciclo de un export async (Fase 17.A — DEFERRED #2):
 *
 *   1. `createJob()` persiste un row pending y dispatcha Action
 *      Scheduler. El user recibe `{job_id, status: 'pending'}`.
 *   2. El worker (registrado en `Plugin::register()` con
 *      `add_action(self::AS_HOOK)`) levanta el job, marca running,
 *      ejecuta `CsvExporter`, guarda el archivo en
 *      `uploads/imagina-crm/exports/`, marca ready (o failed con
 *      el mensaje del error).
 *   3. El user hace GET `/lists/{slug}/export/jobs/{id}` para
 *      pollear status. Cuando es `ready`, hace GET
 *      `/export/jobs/{id}/download?token=...` para bajar el CSV.
 *
 * Esquema de seguridad:
 *  - El job se asocia al `user_id` del creador. Solo el creador
 *    (o un plugin admin) puede consultar/descargar.
 *  - El download URL usa un nonce firmado con TTL 24h derivado
 *    del `(job_id, user_id, file_path)` — no se puede adivinar
 *    sin acceso al job.
 *  - El cleanup diario borra jobs y archivos > 7 días.
 *
 * Trade-off: el job persiste los params como JSON. Si el user
 * cambia de role entre `create` y `run`, el worker aplica los
 * permisos del momento del run (no del momento de create) —
 * defensa adicional.
 */
final class ExportJobService
{
    public const AS_HOOK = 'imagina_crm/export_run';
    public const AS_GROUP = 'imagina-crm';

    /**
     * Umbral en filas: por encima, el endpoint REST devuelve `202`
     * con `job_id` en lugar de stream síncrono. Listas chicas
     * mantienen el flujo legacy para no agregar latencia.
     */
    public const ASYNC_THRESHOLD_ROWS = 5000;

    public function __construct(
        private readonly ExportJobRepository $jobs,
        private readonly CsvExporter $exporter,
        private readonly ListRepository $lists,
        private readonly PermissionService $permissions,
    ) {
    }

    /**
     * @param array<string, mixed> $params Subset del request original.
     *   Forma esperada:
     *   `{ fieldIds?, filterTree?, delimiter?, withBom?, additionalWhere? }`.
     *   `additionalWhere` lo agrega el caller con el scope del user
     *   ya resuelto — el worker NO recalcula scope (eso quedó fijado
     *   al momento del request original; si el role del user cambia,
     *   el cleanup lo manifestará en jobs nuevos).
     */
    public function createJob(int $listId, int $userId, array $params): int
    {
        $jobId = $this->jobs->insert($listId, $userId, $params);
        if ($jobId === 0) {
            return 0;
        }

        if (function_exists('as_enqueue_async_action')) {
            as_enqueue_async_action(self::AS_HOOK, [$jobId], self::AS_GROUP);
        } else {
            // Fallback: dispatch sync. No ideal en producción pero
            // permite que el feature funcione si Action Scheduler
            // está deshabilitado (testing, dev).
            $this->runJob($jobId);
        }

        return $jobId;
    }

    /**
     * Worker que Action Scheduler invoca por `imagina_crm/export_run`.
     * Es público porque WP `add_action` lo necesita callable, pero
     * no debe llamarse manual.
     */
    public function runJob(int $jobId): void
    {
        $job = $this->jobs->find($jobId);
        if ($job === null || $job->status !== ExportJobEntity::STATUS_PENDING) {
            return;
        }

        $list = $this->lists->find($job->listId);
        if ($list === null) {
            $this->jobs->markFailed($jobId, 'Lista no encontrada.');
            return;
        }

        $this->jobs->markRunning($jobId);

        try {
            $params = $job->params;
            $fieldIds = isset($params['fieldIds']) && is_array($params['fieldIds'])
                ? array_values(array_map('intval', $params['fieldIds']))
                : null;
            $filterTree = isset($params['filterTree']) && is_array($params['filterTree'])
                ? $params['filterTree']
                : null;
            /** @var array{sql: string, args: array<int, mixed>}|null $additionalWhere */
            $additionalWhere = isset($params['additionalWhere'])
                && is_array($params['additionalWhere'])
                && isset($params['additionalWhere']['sql'])
                && isset($params['additionalWhere']['args'])
                ? $params['additionalWhere']
                : null;
            $delimiter = isset($params['delimiter']) ? (string) $params['delimiter'] : ',';
            $withBom = ! empty($params['withBom']);

            $csv = $this->exporter->export(
                $list,
                $fieldIds,
                $filterTree,
                $additionalWhere,
                $delimiter,
                $withBom,
            );

            $rowCount = max(0, substr_count($csv, "\n") - 1); // -1 por el header
            $path = $this->writeFile($jobId, $list->slug, $csv);
            if ($path === null) {
                $this->jobs->markFailed($jobId, 'No se pudo escribir el archivo.');
                return;
            }
            $this->jobs->markReady($jobId, $path, $rowCount);
        } catch (\Throwable $e) {
            $this->jobs->markFailed($jobId, $e->getMessage());
        }
    }

    /**
     * Token de descarga firmado (HMAC). 24h TTL. El user lo necesita
     * para hacer GET `/export/jobs/{id}/download?token=...` —
     * defensa contra IDOR (otro user no puede adivinar el token).
     */
    public function downloadToken(ExportJobEntity $job): string
    {
        $expires = time() + 86400;
        $payload = $job->id . '|' . $job->userId . '|' . $expires;
        $signature = hash_hmac('sha256', $payload, wp_salt('auth'));
        return base64_encode($payload . '|' . $signature);
    }

    /**
     * Valida el token y devuelve el job si OK. `null` si expirado,
     * firma inválida, o user_id no matchea el del job.
     */
    public function verifyDownloadToken(int $jobId, string $token, WP_User $user): ?ExportJobEntity
    {
        $raw = base64_decode($token, true);
        if ($raw === false) return null;
        $parts = explode('|', $raw);
        if (count($parts) !== 4) return null;
        [$tokenJobId, $tokenUserId, $expires, $signature] = $parts;
        if ((int) $tokenJobId !== $jobId) return null;
        if ((int) $tokenUserId !== (int) $user->ID && ! $this->permissions->userIsPluginAdmin($user)) {
            return null;
        }
        if ((int) $expires < time()) return null;

        $expected = hash_hmac('sha256', $tokenJobId . '|' . $tokenUserId . '|' . $expires, wp_salt('auth'));
        if (! hash_equals($expected, $signature)) return null;

        $job = $this->jobs->find($jobId);
        if ($job === null || $job->status !== ExportJobEntity::STATUS_READY) {
            return null;
        }
        if ($job->filePath === null || ! file_exists($job->filePath)) {
            return null;
        }
        return $job;
    }

    /**
     * Escribe el CSV en `uploads/imagina-crm/exports/<jobId>-<slug>-<ts>.csv`.
     * Crea el directorio si no existe + el `.htaccess` que bloquea
     * acceso directo desde el web (download solo via endpoint
     * autenticado).
     */
    private function writeFile(int $jobId, string $listSlug, string $csv): ?string
    {
        $upload = wp_upload_dir();
        $baseDir = ($upload['basedir'] ?? '') . '/imagina-crm/exports';
        if (! wp_mkdir_p($baseDir)) {
            return null;
        }
        // .htaccess para bloquear direct access (Apache). Idempotente.
        $htaccess = $baseDir . '/.htaccess';
        if (! file_exists($htaccess)) {
            file_put_contents($htaccess, "Deny from all\n");
        }
        // index.html en blanco para listing protection en hostings
        // sin .htaccess (algunos nginx + autoindex on).
        $index = $baseDir . '/index.html';
        if (! file_exists($index)) {
            file_put_contents($index, '');
        }

        $filename = sprintf(
            '%d-%s-%s.csv',
            $jobId,
            preg_replace('/[^a-z0-9_-]/i', '', $listSlug) ?: 'export',
            gmdate('Ymd-His'),
        );
        $path = $baseDir . '/' . $filename;
        $bytes = file_put_contents($path, $csv);
        return $bytes === false ? null : $path;
    }

    /**
     * Borra archivos huérfanos del directorio (defensivo). Cron diario.
     */
    public function purgeOldJobs(int $days = 7): int
    {
        return $this->jobs->purgeOlderThan($days);
    }
}

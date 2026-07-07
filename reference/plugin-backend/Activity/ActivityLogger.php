<?php
declare(strict_types=1);

namespace ImaginaCRM\Activity;

use ImaginaCRM\Automations\AutomationEntity;
use ImaginaCRM\Comments\CommentEntity;
use ImaginaCRM\Lists\ListEntity;

/**
 * API de alto nivel para loguear actividad. Centraliza:
 * - los slugs de `action` (constantes únicas — evita typos),
 * - el cálculo del diff entre antes/después de un record,
 * - la sanidad mínima del payload `changes` (solo serializable JSON).
 *
 * El logger no decide sus disparos; los hooks de `Plugin.php` lo llaman
 * en respuesta a `imagina_crm/record_*`, `comment_*` y
 * `automation_run_completed`. Esa separación deja al logger testeable
 * sin un container completo.
 */
// No es `final` para permitir dobles de prueba en el suite unitario.
class ActivityLogger
{
    public const ACTION_RECORD_CREATED   = 'record.created';
    public const ACTION_RECORD_UPDATED   = 'record.updated';
    public const ACTION_RECORD_DELETED   = 'record.deleted';
    public const ACTION_COMMENT_CREATED  = 'comment.created';
    public const ACTION_COMMENT_UPDATED  = 'comment.updated';
    public const ACTION_COMMENT_DELETED  = 'comment.deleted';
    public const ACTION_AUTOMATION_RUN   = 'automation.run';
    public const ACTION_MENTION_RECEIVED = 'mention.received';

    public function __construct(private readonly ActivityRepository $repo)
    {
    }

    /**
     * @param array<string, mixed>|null $record
     */
    public function recordCreated(ListEntity $list, int $recordId, ?array $record): int
    {
        return $this->log(
            $list->id,
            $recordId,
            self::ACTION_RECORD_CREATED,
            ['record' => $this->safe($record)],
        );
    }

    /**
     * @param array<string, mixed>|null $newRecord
     * @param array<string, mixed>|null $previous
     */
    public function recordUpdated(ListEntity $list, int $recordId, ?array $newRecord, ?array $previous): int
    {
        $diff = $this->diffRecords($previous, $newRecord);
        if ($diff === []) {
            // Si el update no cambió nada (ej. PATCH idempotente), no
            // contaminamos el timeline.
            return 0;
        }
        return $this->log(
            $list->id,
            $recordId,
            self::ACTION_RECORD_UPDATED,
            ['fields' => $diff],
        );
    }

    public function recordDeleted(ListEntity $list, int $recordId, bool $purge): int
    {
        return $this->log(
            $list->id,
            $recordId,
            self::ACTION_RECORD_DELETED,
            ['purge' => $purge],
        );
    }

    public function commentCreated(CommentEntity $comment): int
    {
        return $this->log(
            $comment->listId,
            $comment->recordId,
            self::ACTION_COMMENT_CREATED,
            ['comment_id' => $comment->id, 'content' => $this->truncate($comment->content)],
            $comment->userId,
        );
    }

    public function commentUpdated(CommentEntity $after, CommentEntity $before): int
    {
        return $this->log(
            $after->listId,
            $after->recordId,
            self::ACTION_COMMENT_UPDATED,
            [
                'comment_id' => $after->id,
                'before'     => $this->truncate($before->content),
                'after'      => $this->truncate($after->content),
            ],
            $after->userId,
        );
    }

    /**
     * Registra que `$mentionedUserId` fue mencionado en `$comment`. La
     * fila guarda al MENCIONADO en `user_id` (a diferencia del resto
     * de actions, donde `user_id` es el actor); el actor queda en
     * `changes.actor_user_id`. Esto permite consultar
     * "mis menciones" como `WHERE action = mention.received AND user_id = ?`.
     */
    public function mentionReceived(CommentEntity $comment, int $mentionedUserId): int
    {
        return $this->log(
            $comment->listId,
            $comment->recordId,
            self::ACTION_MENTION_RECEIVED,
            [
                'comment_id'     => $comment->id,
                'actor_user_id'  => $comment->userId,
                'snippet'        => $this->truncate($comment->content),
            ],
            $mentionedUserId,
        );
    }

    public function commentDeleted(CommentEntity $comment): int
    {
        return $this->log(
            $comment->listId,
            $comment->recordId,
            self::ACTION_COMMENT_DELETED,
            ['comment_id' => $comment->id],
            $comment->userId,
        );
    }

    /**
     * @param array<int, array<string, mixed>> $log
     */
    public function automationRun(
        AutomationEntity $automation,
        int $runId,
        string $finalStatus,
        array $log,
        ?int $recordId,
    ): int {
        return $this->log(
            $automation->listId,
            $recordId,
            self::ACTION_AUTOMATION_RUN,
            [
                'automation_id'   => $automation->id,
                'automation_name' => $automation->name,
                'run_id'          => $runId,
                'status'          => $finalStatus,
                'actions'         => array_map(static fn (array $entry): array => [
                    'action'  => (string) ($entry['action'] ?? ''),
                    'status'  => (string) ($entry['status'] ?? ''),
                    'message' => $entry['message'] ?? null,
                ], $log),
            ],
        );
    }

    /**
     * @param array<string, mixed> $changes
     */
    private function log(int $listId, ?int $recordId, string $action, array $changes, ?int $userId = null): int
    {
        return $this->repo->insert([
            'list_id'   => $listId,
            'record_id' => $recordId,
            'user_id'   => $userId ?? (function_exists('get_current_user_id') ? get_current_user_id() : null),
            'action'    => $action,
            'changes'   => $changes,
        ]);
    }

    /**
     * Calcula el diff de campos entre dos snapshots de record. Soporta
     * tanto el shape hidratado (`{fields: {slug: value}}`) como el plano.
     * Retorna `[slug => ['before' => x, 'after' => y]]` para los slugs
     * cuyos valores cambiaron.
     *
     * @param array<string, mixed>|null $before
     * @param array<string, mixed>|null $after
     * @return array<string, array{before: mixed, after: mixed}>
     */
    public function diffRecords(?array $before, ?array $after): array
    {
        $beforeFields = $this->extractFields($before);
        $afterFields  = $this->extractFields($after);

        $diff = [];
        $allSlugs = array_unique(array_merge(array_keys($beforeFields), array_keys($afterFields)));
        foreach ($allSlugs as $slug) {
            $b = $beforeFields[$slug] ?? null;
            $a = $afterFields[$slug] ?? null;
            if (! $this->valuesEqual($b, $a)) {
                $diff[$slug] = ['before' => $this->safeScalar($b), 'after' => $this->safeScalar($a)];
            }
        }
        return $diff;
    }

    /**
     * @param array<string, mixed>|null $record
     * @return array<string, mixed>
     */
    private function extractFields(?array $record): array
    {
        if (! is_array($record)) {
            return [];
        }
        if (isset($record['fields']) && is_array($record['fields'])) {
            return $record['fields'];
        }
        return $record;
    }

    /**
     * Comparación equivalente a la que usa el trigger engine — laxa
     * para escalares, JSON-equal para arrays.
     */
    private function valuesEqual(mixed $a, mixed $b): bool
    {
        if (is_array($a) && is_array($b)) {
            return wp_json_encode($a) === wp_json_encode($b);
        }
        if (is_array($a) || is_array($b)) {
            return false;
        }
        // phpcs:ignore Universal.Operators.StrictComparisons.LooseEqual
        return $a == $b;
    }

    /**
     * Sanea un payload para garantizar que sea serializable a JSON.
     * Elimina objetos no escalares y descarta resources.
     *
     * @param array<string, mixed>|null $value
     * @return array<string, mixed>
     */
    private function safe(?array $value): array
    {
        if ($value === null) {
            return [];
        }
        return $this->safeArray($value);
    }

    /**
     * @param array<string, mixed> $value
     * @return array<string, mixed>
     */
    private function safeArray(array $value): array
    {
        $out = [];
        foreach ($value as $k => $v) {
            $out[(string) $k] = $this->safeScalar($v);
        }
        return $out;
    }

    private function safeScalar(mixed $v): mixed
    {
        if ($v === null || is_scalar($v)) {
            return $v;
        }
        if (is_array($v)) {
            return $this->safeArray($v);
        }
        // Objetos / resources / lo demás — los serializamos a string para
        // no perder por completo el dato.
        if (is_object($v) && method_exists($v, '__toString')) {
            return (string) $v;
        }
        return null;
    }

    /**
     * Trunca el contenido para no inflar la tabla de actividad con
     * pegas de 5KB. El comentario completo sigue en wp_imcrm_comments.
     */
    private function truncate(string $text, int $max = 280): string
    {
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        return mb_substr($text, 0, $max - 1) . '…';
    }
}

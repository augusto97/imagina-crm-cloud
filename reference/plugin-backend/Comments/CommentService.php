<?php
declare(strict_types=1);

namespace ImaginaCRM\Comments;

use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Records\RecordRepository;
use ImaginaCRM\Support\ValidationResult;

/**
 * Casos de uso de Comentarios.
 *
 * - Valida que la lista exista y que el record exista en su tabla
 *   dinámica antes de persistir (los comentarios son polimórficos: la
 *   FK la enforzamos en código, no en MySQL).
 * - Limita el contenido a 5000 chars para evitar abuso.
 * - Solo el autor o un admin puede editar/borrar (la capability check
 *   real vive en el REST controller — aquí asumimos que ya pasó).
 */
final class CommentService
{
    public const MAX_CONTENT_LENGTH = 5000;

    public function __construct(
        private readonly CommentRepository $comments,
        private readonly ListRepository $lists,
        private readonly RecordRepository $records,
    ) {
    }

    /**
     * @return array<int, CommentEntity>
     */
    public function allForRecord(int $listId, int $recordId): array
    {
        return $this->comments->allForRecord($listId, $recordId);
    }

    public function find(int $id): ?CommentEntity
    {
        return $this->comments->find($id);
    }

    /**
     * @param array<string, mixed> $input
     */
    public function create(int $listId, int $recordId, int $userId, array $input): CommentEntity|ValidationResult
    {
        $list = $this->lists->find($listId);
        if ($list === null) {
            return ValidationResult::failWith('list_id', __('La lista no existe.', 'imagina-crm'));
        }

        // El record debe existir en su tabla dinámica (sin filtro por
        // deleted_at — comentar sobre records soft-deleted es válido para
        // auditoría; restaurar es otra historia).
        if ($this->records->find($list->tableSuffix, $recordId) === null) {
            return ValidationResult::failWith('record_id', __('El registro no existe.', 'imagina-crm'));
        }

        $content = trim((string) ($input['content'] ?? ''));
        if ($content === '') {
            return ValidationResult::failWith('content', __('El comentario no puede estar vacío.', 'imagina-crm'));
        }
        if (mb_strlen($content) > self::MAX_CONTENT_LENGTH) {
            return ValidationResult::failWith(
                'content',
                sprintf(
                    /* translators: %d: max length */
                    __('El comentario excede el máximo de %d caracteres.', 'imagina-crm'),
                    self::MAX_CONTENT_LENGTH,
                ),
            );
        }

        $parentId = isset($input['parent_id']) && $input['parent_id'] !== null ? (int) $input['parent_id'] : null;
        if ($parentId !== null) {
            $parent = $this->comments->find($parentId);
            if ($parent === null || $parent->recordId !== $recordId || $parent->listId !== $listId) {
                return ValidationResult::failWith('parent_id', __('El comentario padre no es válido.', 'imagina-crm'));
            }
        }

        $metadata = $this->validateMetadata($input['metadata'] ?? null);
        if ($metadata instanceof ValidationResult) {
            return $metadata;
        }

        $id = $this->comments->insert([
            'list_id'   => $listId,
            'record_id' => $recordId,
            'user_id'   => $userId,
            'parent_id' => $parentId,
            'content'   => $content,
            'metadata'  => $metadata,
        ]);
        if ($id === 0) {
            return ValidationResult::failWith('database', __('No se pudo crear el comentario.', 'imagina-crm'));
        }

        $created = $this->comments->find($id);
        if ($created === null) {
            return ValidationResult::failWith('database', __('Se creó pero no se pudo leer.', 'imagina-crm'));
        }
        do_action('imagina_crm/comment_created', $created);
        return $created;
    }

    public function update(
        int $id,
        int $userId,
        bool $isAdmin,
        string $content,
        mixed $rawMetadata = null,
    ): CommentEntity|ValidationResult {
        $existing = $this->comments->find($id);
        if ($existing === null) {
            return ValidationResult::failWith('id', __('El comentario no existe.', 'imagina-crm'));
        }
        if (! $isAdmin && $existing->userId !== $userId) {
            return ValidationResult::failWith('forbidden', __('Solo el autor puede editar este comentario.', 'imagina-crm'));
        }

        $content = trim($content);
        if ($content === '') {
            return ValidationResult::failWith('content', __('El comentario no puede estar vacío.', 'imagina-crm'));
        }
        if (mb_strlen($content) > self::MAX_CONTENT_LENGTH) {
            return ValidationResult::failWith(
                'content',
                sprintf(
                    /* translators: %d: max length */
                    __('El comentario excede el máximo de %d caracteres.', 'imagina-crm'),
                    self::MAX_CONTENT_LENGTH,
                ),
            );
        }

        // metadata: si el caller no la mandó, no la tocamos (pasamos null
        // al repo). Si la mandó como array vacío, la limpiamos.
        $metadata = null;
        if ($rawMetadata !== null) {
            $validated = $this->validateMetadata($rawMetadata);
            if ($validated instanceof ValidationResult) {
                return $validated;
            }
            $metadata = $validated;
        }

        if (! $this->comments->updateContent($id, $content, $metadata)) {
            return ValidationResult::failWith('database', __('No se pudo actualizar.', 'imagina-crm'));
        }

        $updated = $this->comments->find($id);
        if ($updated === null) {
            return ValidationResult::failWith('database', __('No se pudo releer.', 'imagina-crm'));
        }
        do_action('imagina_crm/comment_updated', $updated, $existing);
        return $updated;
    }

    /**
     * Valida metadata del composer multi-modo (Nota/Llamada/Email/Reunión).
     *
     * - El backend NO entiende qué hacer con cada `kind`; sólo enforza
     *   shape básico (es array, kind es string permitido, no excede 64
     *   bytes JSON). El frontend interpreta el resto.
     * - Lista de kinds permitidos como guard rail anti-typo, no semántica.
     *
     * @return array<string, mixed>|ValidationResult
     */
    private function validateMetadata(mixed $raw): array|ValidationResult
    {
        if ($raw === null || $raw === '' || $raw === []) {
            return [];
        }
        if (! is_array($raw)) {
            return ValidationResult::failWith('metadata', __('Metadata inválida.', 'imagina-crm'));
        }
        $allowed = ['note', 'call', 'email', 'meeting'];
        if (isset($raw['kind']) && ! in_array($raw['kind'], $allowed, true)) {
            return ValidationResult::failWith('metadata', __('Tipo de comentario desconocido.', 'imagina-crm'));
        }
        // Cap defensivo: 4 KB es más que suficiente para el shape esperado.
        $encoded = wp_json_encode($raw);
        if (! is_string($encoded) || strlen($encoded) > 4096) {
            return ValidationResult::failWith('metadata', __('Metadata demasiado larga.', 'imagina-crm'));
        }
        return $raw;
    }

    public function delete(int $id, int $userId, bool $isAdmin): ValidationResult
    {
        $existing = $this->comments->find($id);
        if ($existing === null) {
            return ValidationResult::failWith('id', __('El comentario no existe.', 'imagina-crm'));
        }
        if (! $isAdmin && $existing->userId !== $userId) {
            return ValidationResult::failWith('forbidden', __('Solo el autor puede eliminar este comentario.', 'imagina-crm'));
        }
        if (! $this->comments->softDelete($id)) {
            return ValidationResult::failWith('database', __('No se pudo eliminar.', 'imagina-crm'));
        }
        do_action('imagina_crm/comment_deleted', $existing);
        return ValidationResult::ok();
    }
}

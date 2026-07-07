<?php
declare(strict_types=1);

namespace ImaginaCRM\Comments;

use ImaginaCRM\Activity\ActivityLogger;
use ImaginaCRM\Lists\ListRepository;

/**
 * Listener de `imagina_crm/comment_created` que dispara cuando alguien
 * publica un comentario con menciones `@usuario`. Para cada usuario
 * mencionado y existente:
 *
 * 1. Persiste un activity entry (`mention.received`) atribuido al
 *    mencionado — eso alimenta el feed `/me/mentions` y notificaciones
 *    in-app futuras.
 * 2. Envía un `wp_mail` con un link al record (admin URL del plugin
 *    con hash `/lists/{slug}/records?focus={recordId}`).
 *
 * No notifica al autor si se auto-menciona (común y sin valor agregado).
 */
final class MentionNotifier
{
    public function __construct(
        private readonly MentionParser $parser,
        private readonly ActivityLogger $activity,
        private readonly ListRepository $lists,
    ) {
    }

    public function handleCommentCreated(CommentEntity $comment): void
    {
        $mentions = $this->parser->resolve($comment->content);
        if ($mentions === []) {
            return;
        }

        $list = $this->lists->find($comment->listId);
        $listSlug = $list?->slug ?? (string) $comment->listId;
        $listName = $list?->name ?? '';

        foreach ($mentions as $login => $userId) {
            if ($userId === $comment->userId) {
                // No notificamos auto-menciones.
                continue;
            }

            $this->activity->mentionReceived($comment, $userId);
            $this->sendEmail($userId, $login, $comment, $listSlug, $listName);
        }
    }

    private function sendEmail(
        int $userId,
        string $login,
        CommentEntity $comment,
        string $listSlug,
        string $listName,
    ): void {
        if (! function_exists('get_user_by') || ! function_exists('wp_mail')) {
            return;
        }
        $user = get_user_by('id', $userId);
        if ($user === false) {
            return;
        }
        $email = is_object($user) && isset($user->user_email) ? (string) $user->user_email : '';
        if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return;
        }

        $displayName = is_object($user) && isset($user->display_name) ? (string) $user->display_name : $login;
        $actorName   = $this->resolveDisplayName($comment->userId);

        $subject = sprintf(
            /* translators: %s: actor display name */
            __('Te mencionaron en Imagina CRM (%s)', 'imagina-crm'),
            $actorName,
        );

        $url = $this->buildRecordUrl($listSlug, $comment->recordId);

        $body = sprintf(
            /* translators: 1: mentioned user, 2: actor, 3: list, 4: snippet, 5: url */
            __(
                "Hola %1\$s,\n\n%2\$s te mencionó en un comentario en la lista \"%3\$s\":\n\n%4\$s\n\nVer el registro: %5\$s",
                'imagina-crm',
            ),
            $displayName,
            $actorName,
            $listName !== '' ? $listName : __('(sin nombre)', 'imagina-crm'),
            $this->snippet($comment->content),
            $url,
        );

        wp_mail($email, $subject, $body);
    }

    private function resolveDisplayName(int $userId): string
    {
        if (! function_exists('get_user_by')) {
            return sprintf('#%d', $userId);
        }
        $user = get_user_by('id', $userId);
        if ($user === false) {
            return sprintf('#%d', $userId);
        }
        $name = is_object($user) && isset($user->display_name) ? (string) $user->display_name : '';
        return $name !== '' ? $name : sprintf('#%d', $userId);
    }

    private function buildRecordUrl(string $listSlug, int $recordId): string
    {
        if (! function_exists('admin_url')) {
            return '#';
        }
        // El admin del plugin usa hash routing (HashRouter de React Router).
        return admin_url(sprintf(
            'admin.php?page=imagina-crm#/lists/%s/records?focus=%d',
            rawurlencode($listSlug),
            $recordId,
        ));
    }

    private function snippet(string $content, int $max = 280): string
    {
        if (mb_strlen($content) <= $max) {
            return $content;
        }
        return mb_substr($content, 0, $max - 1) . '…';
    }
}

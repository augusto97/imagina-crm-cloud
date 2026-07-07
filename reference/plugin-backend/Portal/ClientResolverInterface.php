<?php
declare(strict_types=1);

namespace ImaginaCRM\Portal;

use ImaginaCRM\Fields\FieldEntity;
use ImaginaCRM\Lists\ListEntity;
use WP_User;

/**
 * Contrato para resolver datos del portal de un cliente. Permite que
 * `PortalScopeService` y los REST controllers del portal dependan
 * de un contrato testeable, sin necesidad de mockear la clase final
 * `ClientResolver` (que toca BD via `Database`).
 */
interface ClientResolverInterface
{
    public function portalList(): ?ListEntity;

    public function ownerField(ListEntity $portalList): ?FieldEntity;

    /**
     * @return array<string, mixed>|null
     */
    public function clientRecordFor(WP_User $user): ?array;
}

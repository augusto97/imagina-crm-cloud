<?php
declare(strict_types=1);

namespace ImaginaCRM\REST;

use ImaginaCRM\Container;

/**
 * Engancha el ciclo `rest_api_init` y registra los controllers del plugin.
 *
 * Cada controller se resuelve desde el container DI para que sus
 * dependencias (services, repositories) se inyecten automáticamente.
 */
final class RestBootstrap
{
    /** @var array<int, class-string<AbstractController>> */
    private const CONTROLLERS = [
        ListsController::class,
        PermissionsController::class,
        PublicListsController::class,
        PortalController::class,
        FieldsController::class,
        RecordsController::class,
        ViewsController::class,
        SavedFiltersController::class,
        SlugsController::class,
        LicenseController::class,
        SystemController::class,
        AutomationsController::class,
        CommentsController::class,
        ActivityController::class,
        DashboardsController::class,
        RecurrencesController::class,
        ImportController::class,
        ExportController::class,
        AggregatesController::class,
        SearchAdminController::class,
    ];

    public function __construct(private readonly Container $container)
    {
    }

    public function register(): void
    {
        add_action('rest_api_init', [$this, 'registerRoutes']);
    }

    public function registerRoutes(): void
    {
        foreach (self::CONTROLLERS as $class) {
            $controller = $this->container->get($class);
            if ($controller instanceof AbstractController) {
                $controller->register_routes();
            }
        }
    }
}

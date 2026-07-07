<?php
declare(strict_types=1);

namespace ImaginaCRM;

use ImaginaCRM\Admin\AdminAssets;
use ImaginaCRM\Admin\AdminMenu;
use ImaginaCRM\Standalone\StandalonePage;
use ImaginaCRM\Automations\ActionRegistry;
use ImaginaCRM\Automations\Actions\CallWebhookAction;
use ImaginaCRM\Automations\Actions\IfElseAction;
use ImaginaCRM\Automations\Actions\SendEmailAction;
use ImaginaCRM\Automations\Actions\UpdateFieldAction;
use ImaginaCRM\Automations\AutomationEngine;
use ImaginaCRM\Automations\AutomationRepository;
use ImaginaCRM\Automations\AutomationRunRepository;
use ImaginaCRM\Automations\AutomationService;
use ImaginaCRM\Automations\ScheduledRunner;
use ImaginaCRM\Automations\TriggerContext;
use ImaginaCRM\Automations\TriggerRegistry;
use ImaginaCRM\Activity\ActivityLogger;
use ImaginaCRM\Activity\ActivityRepository;
use ImaginaCRM\Automations\AutomationEntity;
use ImaginaCRM\Comments\CommentEntity;
use ImaginaCRM\Comments\CommentRepository;
use ImaginaCRM\Comments\CommentService;
use ImaginaCRM\Comments\MentionNotifier;
use ImaginaCRM\Comments\MentionParser;
use ImaginaCRM\Dashboards\DashboardRepository;
use ImaginaCRM\Dashboards\DashboardService;
use ImaginaCRM\Dashboards\WidgetEvaluator;
use ImaginaCRM\Fields\FieldRepository;
use ImaginaCRM\Fields\FieldService;
use ImaginaCRM\Fields\FieldTypeRegistry;
use ImaginaCRM\Lists\ListEntity;
use ImaginaCRM\Lists\ListRepository;
use ImaginaCRM\Lists\ListService;
use ImaginaCRM\Licensing\LicenseHttpClient;
use ImaginaCRM\Licensing\LicenseManager;
use ImaginaCRM\Licensing\UpdaterClient;
use ImaginaCRM\Lists\SchemaManager;
use ImaginaCRM\Lists\SlugManager;
use ImaginaCRM\Permissions\PermissionService;
use ImaginaCRM\Permissions\RoleInstaller;
use ImaginaCRM\Portal\ClientResolver;
use ImaginaCRM\Portal\PortalScopeService;
use ImaginaCRM\PublicLists\PublicListService;
use ImaginaCRM\Records\QueryBuilder;
use ImaginaCRM\Records\RecordRepository;
use ImaginaCRM\Records\RecordService;
use ImaginaCRM\Records\RecordValidator;
use ImaginaCRM\Records\RelationRepository;
use ImaginaCRM\REST\RestBootstrap;
use ImaginaCRM\Support\Database;
use ImaginaCRM\Views\SavedViewRepository;
use ImaginaCRM\Views\SavedViewService;

/**
 * Bootstrap principal del plugin.
 *
 * Mantiene el container DI compartido y registra los servicios necesarios.
 * En esta fase ya se cablean SchemaManager, SlugManager, listas y la capa
 * REST. Fields y Records llegan en commits siguientes.
 */
final class Plugin
{
    public const VERSION          = IMAGINA_CRM_VERSION;
    public const TEXT_DOMAIN      = IMAGINA_CRM_TEXT_DOMAIN;
    public const DB_VERSION       = IMAGINA_CRM_DB_VERSION;
    public const ADMIN_PAGE       = 'imagina-crm';
    // Cap canónica para acceder al admin del plugin. La migración de la
    // Fase 7 garantiza que el rol `administrator` de WP la tenga, así
    // que cualquier admin existente sigue funcionando sin acción manual.
    public const ADMIN_CAPABILITY = \ImaginaCRM\Permissions\CapabilityRegistry::CAP_ACCESS_ADMIN;

    private static ?self $instance = null;

    private Container $container;

    private function __construct()
    {
        $this->container = new Container();
        $this->container->instance(Container::class, $this->container);
        $this->bindServices();
    }

    public static function boot(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
            self::$instance->register();
        }

        return self::$instance;
    }

    public static function instance(): self
    {
        return self::boot();
    }

    public function container(): Container
    {
        return $this->container;
    }

    public function dir(): string
    {
        return IMAGINA_CRM_DIR;
    }

    public function url(): string
    {
        return IMAGINA_CRM_URL;
    }

    private function bindServices(): void
    {
        // Database wrapper sobre wpdb global. Se resuelve perezosamente para
        // que `init` ya tenga $wpdb disponible.
        $this->container->bind(Database::class, static function (): Database {
            global $wpdb;
            return new Database($wpdb);
        });

        // SchemaManager y SlugManager dependen sólo de Database.
        $this->container->bind(SchemaManager::class, static function (Container $c): SchemaManager {
            return new SchemaManager($c->get(Database::class));
        });

        // RoleInstaller: sincroniza roles y capabilities del plugin.
        // Stateless, sin dependencias — se invoca en activación y en
        // `maybeUpgradeSchema` para mantener idempotencia ante updates.
        $this->container->bind(RoleInstaller::class, static function (): RoleInstaller {
            return new RoleInstaller();
        });

        // PermissionService: centraliza autorización (caps + ACL por lista).
        // Recibe FieldRepository para resolver el column_name del campo de
        // asignación cuando el ACL define scope=assigned. El bind se hace
        // después que FieldRepository (más abajo), pero al ser lazy
        // (closure), el orden no importa — se construye en el primer get().
        $this->container->bind(PermissionService::class, static function (Container $c): PermissionService {
            return new PermissionService($c->get(FieldRepository::class));
        });

        // PermissionsController: REST `/lists/{id}/permissions` + `/roles`.
        // Roles custom (Fase 10): service + binding del RoleInstaller
        // que ya existía desde Fase 7.
        $this->container->bind(\ImaginaCRM\Permissions\CustomRoleService::class, static function (): \ImaginaCRM\Permissions\CustomRoleService {
            return new \ImaginaCRM\Permissions\CustomRoleService();
        });

        $this->container->bind(\ImaginaCRM\REST\PermissionsController::class, static function (Container $c): \ImaginaCRM\REST\PermissionsController {
            return new \ImaginaCRM\REST\PermissionsController(
                $c->get(ListService::class),
                $c->get(\ImaginaCRM\Permissions\CustomRoleService::class),
                $c->get(RoleInstaller::class),
            );
        });

        // Listas públicas (Fase 8): service + controller del namespace
        // `/imagina-crm/v1/public/*` sin auth/nonce.
        $this->container->bind(PublicListService::class, static function (Container $c): PublicListService {
            return new PublicListService(
                $c->get(ListRepository::class),
                $c->get(FieldRepository::class),
                $c->get(RecordService::class),
                $c->get(\ImaginaCRM\Support\Cache::class),
            );
        });
        $this->container->bind(\ImaginaCRM\REST\PublicListsController::class, static function (Container $c): \ImaginaCRM\REST\PublicListsController {
            return new \ImaginaCRM\REST\PublicListsController(
                $c->get(PublicListService::class),
            );
        });

        // Shortcode `[imcrm-list]` + assets del frontend público (Fase 8 — 2.B).
        $this->container->bind(\ImaginaCRM\PublicLists\Shortcode::class, static function (Container $c): \ImaginaCRM\PublicLists\Shortcode {
            return new \ImaginaCRM\PublicLists\Shortcode(
                $c->get(PublicListService::class),
            );
        });
        $this->container->bind(\ImaginaCRM\PublicLists\PublicAssets::class, static function (): \ImaginaCRM\PublicLists\PublicAssets {
            return new \ImaginaCRM\PublicLists\PublicAssets();
        });
        // Permalinks dedicados para listas públicas (Fase 10).
        $this->container->bind(\ImaginaCRM\PublicLists\PublicPermalinks::class, static function (Container $c): \ImaginaCRM\PublicLists\PublicPermalinks {
            return new \ImaginaCRM\PublicLists\PublicPermalinks(
                $c->get(ListRepository::class),
            );
        });

        // Bloque Gutenberg (Fase 8 — 2.D). Reusa el render del shortcode
        // via render_callback — sin duplicar lógica de render entre ambos.
        $this->container->bind(\ImaginaCRM\PublicLists\Block::class, static function (Container $c): \ImaginaCRM\PublicLists\Block {
            return new \ImaginaCRM\PublicLists\Block(
                $c->get(\ImaginaCRM\PublicLists\Shortcode::class),
            );
        });

        // Portal del cliente (Fase 9 — 3.A). ClientResolver encuentra la
        // lista de portal + el record-cliente del WP_User actual; el
        // PortalScopeService genera el WHERE inyectable que aísla los
        // datos del cliente del resto. Es la pieza crítica de data
        // isolation — los tests viven en `tests/Unit/Portal/`.
        $this->container->bind(ClientResolver::class, static function (Container $c): ClientResolver {
            return new ClientResolver(
                $c->get(ListRepository::class),
                $c->get(FieldRepository::class),
                $c->get(\ImaginaCRM\Support\Database::class),
                $c->get(\ImaginaCRM\Support\Cache::class),
            );
        });
        $this->container->bind(PortalScopeService::class, static function (Container $c): PortalScopeService {
            $db = $c->get(\ImaginaCRM\Support\Database::class);
            return new PortalScopeService(
                $c->get(ClientResolver::class),
                $c->get(FieldRepository::class),
                $db instanceof \ImaginaCRM\Support\Database ? $db : 'wp_imcrm_relations',
            );
        });

        // Portal — shortcode + assets + REST controller (Fase 9 — 3.B).
        $this->container->bind(\ImaginaCRM\Portal\PortalShortcode::class, static function (Container $c): \ImaginaCRM\Portal\PortalShortcode {
            return new \ImaginaCRM\Portal\PortalShortcode(
                $c->get(ClientResolver::class),
            );
        });
        $this->container->bind(\ImaginaCRM\Portal\PortalAssets::class, static function (): \ImaginaCRM\Portal\PortalAssets {
            return new \ImaginaCRM\Portal\PortalAssets();
        });
        $this->container->bind(\ImaginaCRM\Portal\PortalAccountManager::class, static function (Container $c): \ImaginaCRM\Portal\PortalAccountManager {
            return new \ImaginaCRM\Portal\PortalAccountManager(
                $c->get(ClientResolver::class),
                $c->get(RecordRepository::class),
            );
        });
        // Magic links (Fase 10): generación + consumo de tokens one-time.
        $this->container->bind(\ImaginaCRM\Portal\MagicLinkService::class, static function (): \ImaginaCRM\Portal\MagicLinkService {
            return new \ImaginaCRM\Portal\MagicLinkService();
        });
        $this->container->bind(\ImaginaCRM\Portal\MagicLinkConsumer::class, static function (Container $c): \ImaginaCRM\Portal\MagicLinkConsumer {
            return new \ImaginaCRM\Portal\MagicLinkConsumer(
                $c->get(\ImaginaCRM\Portal\MagicLinkService::class),
            );
        });
        $this->container->bind(\ImaginaCRM\REST\PortalController::class, static function (Container $c): \ImaginaCRM\REST\PortalController {
            return new \ImaginaCRM\REST\PortalController(
                $c->get(ClientResolver::class),
                $c->get(PortalScopeService::class),
                $c->get(ListService::class),
                $c->get(RecordService::class),
                $c->get(FieldRepository::class),
                $c->get(\ImaginaCRM\Portal\PortalAccountManager::class),
                $c->get(\ImaginaCRM\Records\RecordAggregator::class),
                $c->get(\ImaginaCRM\Activity\ActivityRepository::class),
                $c->get(\ImaginaCRM\Portal\MagicLinkService::class),
                $c->get(CommentService::class),
                $c->get(PermissionService::class),
            );
        });

        $this->container->bind(SlugManager::class, static function (Container $c): SlugManager {
            return new SlugManager($c->get(Database::class));
        });

        // Object cache wrapper — auto-detect drop-in persistente
        // (Redis/Memcached) y se cae a per-request si no hay. Se
        // inyecta a los repositorios hot (ListRepository,
        // FieldRepository) para deduplicar reads.
        $this->container->bind(\ImaginaCRM\Support\Cache::class, static function (): \ImaginaCRM\Support\Cache {
            return new \ImaginaCRM\Support\Cache();
        });

        // Lists.
        $this->container->bind(ListRepository::class, static function (Container $c): ListRepository {
            return new ListRepository(
                $c->get(Database::class),
                $c->get(\ImaginaCRM\Support\Cache::class),
            );
        });

        $this->container->bind(ListService::class, static function (Container $c): ListService {
            return new ListService(
                $c->get(ListRepository::class),
                $c->get(SlugManager::class),
                $c->get(SchemaManager::class),
            );
        });

        // Field type registry: singleton; los 14 tipos default se registran
        // en su constructor.
        $this->container->bind(FieldTypeRegistry::class, static function (): FieldTypeRegistry {
            return new FieldTypeRegistry();
        });

        $this->container->bind(FieldRepository::class, static function (Container $c): FieldRepository {
            return new FieldRepository(
                $c->get(Database::class),
                $c->get(\ImaginaCRM\Support\Cache::class),
            );
        });

        // Records (debe construirse antes que FieldService porque éste lo
        // recibe inyectado para resolver autocomplete de valores).
        $this->container->bind(RecordRepository::class, static function (Container $c): RecordRepository {
            return new RecordRepository($c->get(Database::class));
        });

        $this->container->bind(FieldService::class, static function (Container $c): FieldService {
            return new FieldService(
                $c->get(FieldRepository::class),
                $c->get(ListRepository::class),
                $c->get(SlugManager::class),
                $c->get(SchemaManager::class),
                $c->get(FieldTypeRegistry::class),
                $c->get(RecordRepository::class),
            );
        });

        $this->container->bind(RelationRepository::class, static function (Container $c): RelationRepository {
            return new RelationRepository($c->get(Database::class));
        });

        $this->container->bind(RecordValidator::class, static function (Container $c): RecordValidator {
            return new RecordValidator($c->get(FieldTypeRegistry::class), $c->get(Database::class));
        });

        $this->container->bind(QueryBuilder::class, static function (Container $c): QueryBuilder {
            return new QueryBuilder($c->get(Database::class), $c->get(SlugManager::class));
        });

        $this->container->bind(RecordService::class, static function (Container $c): RecordService {
            return new RecordService(
                $c->get(FieldRepository::class),
                $c->get(RecordRepository::class),
                $c->get(RelationRepository::class),
                $c->get(RecordValidator::class),
                $c->get(QueryBuilder::class),
                $c->get(\ImaginaCRM\Search\SearchService::class),
            );
        });

        // RecordsETag — versión por lista para 304 Not Modified.
        $this->container->bind(\ImaginaCRM\Records\RecordsETag::class, static function (): \ImaginaCRM\Records\RecordsETag {
            return new \ImaginaCRM\Records\RecordsETag();
        });

        // Tier 3 (0.30.0): motor de búsqueda con índice invertido +
        // composite indexes + purge.
        $this->container->bind(\ImaginaCRM\Search\Tokenizer::class, static function (): \ImaginaCRM\Search\Tokenizer {
            return new \ImaginaCRM\Search\Tokenizer();
        });

        $this->container->bind(\ImaginaCRM\Search\InvertedIndexEngine::class, static function (Container $c): \ImaginaCRM\Search\InvertedIndexEngine {
            return new \ImaginaCRM\Search\InvertedIndexEngine(
                $c->get(Database::class),
                $c->get(FieldRepository::class),
                $c->get(\ImaginaCRM\Search\Tokenizer::class),
            );
        });

        $this->container->bind(\ImaginaCRM\Search\MysqlSearchEngine::class, static function (Container $c): \ImaginaCRM\Search\MysqlSearchEngine {
            return new \ImaginaCRM\Search\MysqlSearchEngine(
                $c->get(Database::class),
                $c->get(ListRepository::class),
                $c->get(FieldRepository::class),
            );
        });

        $this->container->bind(\ImaginaCRM\Search\SearchService::class, static function (Container $c): \ImaginaCRM\Search\SearchService {
            return new \ImaginaCRM\Search\SearchService(
                $c->get(\ImaginaCRM\Search\InvertedIndexEngine::class),
                $c->get(\ImaginaCRM\Search\MysqlSearchEngine::class),
                $c->get(ListRepository::class),
                $c->get(RecordRepository::class),
            );
        });

        $this->container->bind(\ImaginaCRM\Search\SearchHooks::class, static function (Container $c): \ImaginaCRM\Search\SearchHooks {
            return new \ImaginaCRM\Search\SearchHooks($c->get(\ImaginaCRM\Search\SearchService::class));
        });

        $this->container->bind(\ImaginaCRM\Maintenance\CompositeIndexSuggester::class, static function (Container $c): \ImaginaCRM\Maintenance\CompositeIndexSuggester {
            return new \ImaginaCRM\Maintenance\CompositeIndexSuggester(
                $c->get(Database::class),
                $c->get(ListRepository::class),
                $c->get(FieldRepository::class),
                $c->get(SavedViewRepository::class),
            );
        });

        $this->container->bind(\ImaginaCRM\Maintenance\PurgeService::class, static function (Container $c): \ImaginaCRM\Maintenance\PurgeService {
            return new \ImaginaCRM\Maintenance\PurgeService($c->get(Database::class));
        });

        // Saved Views.
        $this->container->bind(SavedViewRepository::class, static function (Container $c): SavedViewRepository {
            return new SavedViewRepository($c->get(Database::class));
        });

        $this->container->bind(SavedViewService::class, static function (Container $c): SavedViewService {
            return new SavedViewService(
                $c->get(SavedViewRepository::class),
                $c->get(ListRepository::class),
                $c->get(FieldRepository::class),
            );
        });

        // Filtros guardados (ClickUp-style): registro de los repos /
        // service / controller. Schema versión 3 trae la tabla
        // `wp_imcrm_saved_filters`.
        $this->container->bind(\ImaginaCRM\Filters\SavedFilterRepository::class, static function (Container $c): \ImaginaCRM\Filters\SavedFilterRepository {
            return new \ImaginaCRM\Filters\SavedFilterRepository($c->get(Database::class));
        });
        $this->container->bind(\ImaginaCRM\Filters\SavedFilterService::class, static function (Container $c): \ImaginaCRM\Filters\SavedFilterService {
            return new \ImaginaCRM\Filters\SavedFilterService(
                $c->get(\ImaginaCRM\Filters\SavedFilterRepository::class),
            );
        });
        $this->container->bind(\ImaginaCRM\REST\SavedFiltersController::class, static function (Container $c): \ImaginaCRM\REST\SavedFiltersController {
            return new \ImaginaCRM\REST\SavedFiltersController(
                $c->get(\ImaginaCRM\Filters\SavedFilterService::class),
                $c->get(\ImaginaCRM\Lists\ListService::class),
            );
        });

        // Recurrencias ClickUp-style sobre campos date/datetime.
        // Schema versión 4 trae `wp_imcrm_recurrences`. El runner se
        // engancha en `init` (más abajo en register()) para escuchar
        // record_updated y el tick horario de Action Scheduler.
        $this->container->bind(\ImaginaCRM\Recurrences\RecurrenceRepository::class, static function (Container $c): \ImaginaCRM\Recurrences\RecurrenceRepository {
            return new \ImaginaCRM\Recurrences\RecurrenceRepository($c->get(Database::class));
        });
        $this->container->bind(\ImaginaCRM\Recurrences\RecurrenceService::class, static function (Container $c): \ImaginaCRM\Recurrences\RecurrenceService {
            return new \ImaginaCRM\Recurrences\RecurrenceService(
                $c->get(\ImaginaCRM\Recurrences\RecurrenceRepository::class),
                $c->get(ListRepository::class),
                $c->get(FieldRepository::class),
                $c->get(\ImaginaCRM\Records\RecordService::class),
            );
        });
        $this->container->bind(\ImaginaCRM\Recurrences\RecurrenceRunner::class, static function (Container $c): \ImaginaCRM\Recurrences\RecurrenceRunner {
            return new \ImaginaCRM\Recurrences\RecurrenceRunner(
                $c->get(\ImaginaCRM\Recurrences\RecurrenceService::class),
                $c->get(\ImaginaCRM\Recurrences\RecurrenceRepository::class),
            );
        });
        $this->container->bind(\ImaginaCRM\REST\RecurrencesController::class, static function (Container $c): \ImaginaCRM\REST\RecurrencesController {
            return new \ImaginaCRM\REST\RecurrencesController(
                $c->get(\ImaginaCRM\Recurrences\RecurrenceService::class),
                $c->get(\ImaginaCRM\Recurrences\RecurrenceRepository::class),
                $c->get(\ImaginaCRM\Lists\ListService::class),
            );
        });

        // Licensing + Updater.
        $this->container->bind(LicenseHttpClient::class, static function (): LicenseHttpClient {
            return new LicenseHttpClient();
        });

        $this->container->bind(LicenseManager::class, static function (Container $c): LicenseManager {
            return new LicenseManager($c->get(LicenseHttpClient::class));
        });

        $this->container->bind(UpdaterClient::class, static function (Container $c): UpdaterClient {
            return new UpdaterClient($c->get(LicenseManager::class));
        });

        // Automations (Fase 2).
        $this->container->bind(TriggerRegistry::class, static function (): TriggerRegistry {
            return new TriggerRegistry();
        });

        $this->container->bind(ActionRegistry::class, static function (Container $c): ActionRegistry {
            $registry = new ActionRegistry();
            // Acciones default: las que necesitan dependencias se construyen
            // aquí con servicios del container. Las que son puramente HTTP
            // (call_webhook) son `new` directo.
            $registry->register(new UpdateFieldAction($c->get(\ImaginaCRM\Records\RecordService::class)));
            $registry->register(new CallWebhookAction());
            $registry->register(new SendEmailAction());
            // Control flow: stub que el engine intercepta. Aparece en el
            // catálogo /actions para que la UI lo ofrezca como tipo,
            // pero su `execute()` jamás corre — `AutomationEngine`
            // maneja la recursión.
            $registry->register(new IfElseAction());
            return $registry;
        });

        $this->container->bind(AutomationRepository::class, static function (Container $c): AutomationRepository {
            return new AutomationRepository($c->get(Database::class));
        });

        $this->container->bind(AutomationRunRepository::class, static function (Container $c): AutomationRunRepository {
            return new AutomationRunRepository($c->get(Database::class));
        });

        $this->container->bind(AutomationService::class, static function (Container $c): AutomationService {
            return new AutomationService(
                $c->get(AutomationRepository::class),
                $c->get(ListRepository::class),
                $c->get(TriggerRegistry::class),
                $c->get(ActionRegistry::class),
            );
        });

        $this->container->bind(AutomationEngine::class, static function (Container $c): AutomationEngine {
            return new AutomationEngine(
                $c->get(AutomationRepository::class),
                $c->get(AutomationRunRepository::class),
                $c->get(TriggerRegistry::class),
                $c->get(ActionRegistry::class),
            );
        });

        // Comments (Fase 3).
        $this->container->bind(CommentRepository::class, static function (Container $c): CommentRepository {
            return new CommentRepository($c->get(Database::class));
        });

        $this->container->bind(CommentService::class, static function (Container $c): CommentService {
            return new CommentService(
                $c->get(CommentRepository::class),
                $c->get(\ImaginaCRM\Lists\ListRepository::class),
                $c->get(\ImaginaCRM\Records\RecordRepository::class),
            );
        });

        // Activity log (Fase 3).
        $this->container->bind(ActivityRepository::class, static function (Container $c): ActivityRepository {
            return new ActivityRepository($c->get(Database::class));
        });

        $this->container->bind(ActivityLogger::class, static function (Container $c): ActivityLogger {
            return new ActivityLogger($c->get(ActivityRepository::class));
        });

        $this->container->bind(MentionParser::class, static function (): MentionParser {
            return new MentionParser();
        });

        $this->container->bind(MentionNotifier::class, static function (Container $c): MentionNotifier {
            return new MentionNotifier(
                $c->get(MentionParser::class),
                $c->get(ActivityLogger::class),
                $c->get(\ImaginaCRM\Lists\ListRepository::class),
            );
        });

        // Dashboards (Fase 5).
        $this->container->bind(DashboardRepository::class, static function (Container $c): DashboardRepository {
            return new DashboardRepository($c->get(Database::class));
        });

        $this->container->bind(DashboardService::class, static function (Container $c): DashboardService {
            return new DashboardService(
                $c->get(DashboardRepository::class),
                $c->get(\ImaginaCRM\Lists\ListRepository::class),
                $c->get(FieldRepository::class),
            );
        });

        $this->container->bind(WidgetEvaluator::class, static function (Container $c): WidgetEvaluator {
            return new WidgetEvaluator(
                $c->get(Database::class),
                $c->get(\ImaginaCRM\Lists\ListRepository::class),
                $c->get(FieldRepository::class),
                $c->get(QueryBuilder::class),
                $c->get(\ImaginaCRM\Records\RecordsETag::class),
            );
        });

        $this->container->bind(ScheduledRunner::class, static function (Container $c): ScheduledRunner {
            return new ScheduledRunner(
                $c->get(AutomationRepository::class),
                $c->get(AutomationRunRepository::class),
                $c->get(\ImaginaCRM\Lists\ListRepository::class),
                $c->get(\ImaginaCRM\Records\RecordService::class),
                $c->get(AutomationEngine::class),
            );
        });

        // Import / export CSV (Fase 6).
        $this->container->bind(\ImaginaCRM\Imports\ImportService::class, static function (Container $c): \ImaginaCRM\Imports\ImportService {
            return new \ImaginaCRM\Imports\ImportService(
                $c->get(FieldRepository::class),
                $c->get(\ImaginaCRM\Records\RecordService::class),
                $c->get(FieldService::class),
            );
        });
        $this->container->bind(\ImaginaCRM\Exports\CsvExporter::class, static function (Container $c): \ImaginaCRM\Exports\CsvExporter {
            return new \ImaginaCRM\Exports\CsvExporter(
                $c->get(FieldRepository::class),
                $c->get(\ImaginaCRM\Records\RecordService::class),
            );
        });
        $this->container->bind(\ImaginaCRM\REST\ImportController::class, static function (Container $c): \ImaginaCRM\REST\ImportController {
            return new \ImaginaCRM\REST\ImportController(
                $c->get(\ImaginaCRM\Imports\ImportService::class),
                $c->get(\ImaginaCRM\Lists\ListService::class),
            );
        });
        $this->container->bind(\ImaginaCRM\Exports\ExportJobRepository::class, static function (Container $c): \ImaginaCRM\Exports\ExportJobRepository {
            return new \ImaginaCRM\Exports\ExportJobRepository($c->get(Database::class));
        });
        $this->container->bind(\ImaginaCRM\Exports\ExportJobService::class, static function (Container $c): \ImaginaCRM\Exports\ExportJobService {
            return new \ImaginaCRM\Exports\ExportJobService(
                $c->get(\ImaginaCRM\Exports\ExportJobRepository::class),
                $c->get(\ImaginaCRM\Exports\CsvExporter::class),
                $c->get(ListRepository::class),
                $c->get(PermissionService::class),
            );
        });
        $this->container->bind(\ImaginaCRM\REST\ExportController::class, static function (Container $c): \ImaginaCRM\REST\ExportController {
            return new \ImaginaCRM\REST\ExportController(
                $c->get(\ImaginaCRM\Exports\CsvExporter::class),
                $c->get(\ImaginaCRM\Lists\ListService::class),
                $c->get(PermissionService::class),
                $c->get(FieldRepository::class),
                $c->get(\ImaginaCRM\Exports\ExportJobService::class),
                $c->get(\ImaginaCRM\Exports\ExportJobRepository::class),
            );
        });

        // Footer aggregations (Fase 6).
        $this->container->bind(\ImaginaCRM\Records\RecordAggregator::class, static function (Container $c): \ImaginaCRM\Records\RecordAggregator {
            return new \ImaginaCRM\Records\RecordAggregator(
                $c->get(Database::class),
                $c->get(FieldRepository::class),
                $c->get(QueryBuilder::class),
            );
        });
        $this->container->bind(\ImaginaCRM\REST\AggregatesController::class, static function (Container $c): \ImaginaCRM\REST\AggregatesController {
            return new \ImaginaCRM\REST\AggregatesController(
                $c->get(\ImaginaCRM\Records\RecordAggregator::class),
                $c->get(\ImaginaCRM\Lists\ListService::class),
                $c->get(PermissionService::class),
                $c->get(FieldRepository::class),
            );
        });
    }

    private function register(): void
    {
        add_action('init', [$this, 'loadTextdomain']);

        // Runtime upgrade check: cuando el plugin se actualiza desde el
        // WP admin (no se llama register_activation_hook), comparamos el
        // DB_VERSION declarado contra el persistido. Si difieren, re-
        // ejecutamos installSystemTables (idempotente vía dbDelta) y
        // actualizamos el option. Esto asegura que las tablas añadidas
        // en fases posteriores (automations, dashboards) existan en
        // sites con el plugin pre-actualizado.
        add_action('init', [$this, 'maybeUpgradeSchema'], 1);

        // Object cache: enganchar invalidación automática. El wrapper
        // se cae a per-request si no hay drop-in persistente
        // (Redis/Memcached).
        $cache = $this->container->get(\ImaginaCRM\Support\Cache::class);
        if ($cache instanceof \ImaginaCRM\Support\Cache) {
            $cache->registerInvalidationHooks();
        }

        // Records ETag versioning: bumpea la versión de la lista en
        // cada record_*/import_finished/field_* hook para que los
        // 304 Not Modified sean correctos en GET /records.
        $etag = $this->container->get(\ImaginaCRM\Records\RecordsETag::class);
        if ($etag instanceof \ImaginaCRM\Records\RecordsETag) {
            $etag->registerInvalidationHooks();
        }

        // Tier 3 (0.30.0): hooks del search engine (push + reindex
        // jobs + cron 6h) y purge automático diario.
        $searchHooks = $this->container->get(\ImaginaCRM\Search\SearchHooks::class);
        if ($searchHooks instanceof \ImaginaCRM\Search\SearchHooks) {
            $searchHooks->register();
            $searchHooks->ensureResyncScheduled();
        }
        $purge = $this->container->get(\ImaginaCRM\Maintenance\PurgeService::class);
        if ($purge instanceof \ImaginaCRM\Maintenance\PurgeService) {
            $purge->registerHandler();
            $purge->ensureScheduled();
        }

        // Cuando se borra un field de una lista, limpiamos referencias
        // huérfanas en los widgets de dashboards. Sin esto, los
        // dashboards quedaban con widgets que referenciaban el field
        // borrado — el evaluator mostraba placeholder pero el dashboard
        // mismo quedaba "atascado" si el frontend disparaba un PATCH
        // y la validación rechazaba (fix paralelo en validateWidgets).
        $dashboards = $this->container->get(DashboardService::class);
        if ($dashboards instanceof DashboardService) {
            add_action(
                'imagina_crm/field_deleted',
                static function ($fieldEntity) use ($dashboards): void {
                    if (is_object($fieldEntity) && property_exists($fieldEntity, 'id')) {
                        $dashboards->pruneFieldReferences((int) $fieldEntity->id);
                    }
                },
                10,
                1
            );
        }

        // REST se registra siempre (admin + frontend pueden consumirlo).
        $rest = new RestBootstrap($this->container);
        $rest->register();

        // Hook de cron diario para revalidar licencia. El registro en
        // sí (wp_schedule_event) lo hace `Installer` en activación.
        $licenses = $this->container->get(LicenseManager::class);
        if ($licenses instanceof LicenseManager) {
            add_action(LicenseManager::CRON_HOOK, [$licenses, 'dailyCheck']);
        }

        // Updater registra los filtros estándar de WP (transient + plugins_api).
        $updater = $this->container->get(UpdaterClient::class);
        if ($updater instanceof UpdaterClient) {
            $updater->register();
        }

        // Automations: el engine escucha los do_action que dispara
        // RecordService cuando se crean / actualizan registros.
        $engine = $this->container->get(AutomationEngine::class);
        if ($engine instanceof AutomationEngine) {
            add_action(
                'imagina_crm/record_created',
                static function (mixed $list, mixed $recordId, mixed $record, mixed $values) use ($engine): void {
                    if (! $list instanceof ListEntity) {
                        return;
                    }
                    unset($recordId, $values);
                    $engine->dispatch(new TriggerContext(
                        event: 'imagina_crm/record_created',
                        list: $list,
                        record: is_array($record) ? $record : null,
                    ));
                },
                10,
                4,
            );

            add_action(
                'imagina_crm/record_updated',
                static function (mixed $list, mixed $recordId, mixed $newRecord, mixed $previous) use ($engine): void {
                    if (! $list instanceof ListEntity) {
                        return;
                    }
                    unset($recordId);
                    $engine->dispatch(new TriggerContext(
                        event: 'imagina_crm/record_updated',
                        list: $list,
                        record: is_array($newRecord) ? $newRecord : null,
                        previousRecord: is_array($previous) ? $previous : null,
                    ));
                },
                10,
                4,
            );

            // Action Scheduler invoca este hook cuando un run encolado
            // toca turno. Llega con el run_id como único argumento.
            add_action(
                AutomationEngine::HOOK_RUN_AUTOMATION,
                static function (mixed $runId) use ($engine): void {
                    if (! is_numeric($runId)) {
                        return;
                    }
                    $engine->runById((int) $runId);
                },
                10,
                1,
            );
        }

        // Export jobs async (Fase 17.A — DEFERRED #2). Action Scheduler
        // invoca este hook por cada job pendiente. El worker corre
        // CsvExporter, escribe a uploads/imagina-crm/exports/, y marca
        // ready/failed.
        $exportJobService = $this->container->get(\ImaginaCRM\Exports\ExportJobService::class);
        if ($exportJobService instanceof \ImaginaCRM\Exports\ExportJobService) {
            add_action(
                \ImaginaCRM\Exports\ExportJobService::AS_HOOK,
                static function (mixed $jobId) use ($exportJobService): void {
                    if (! is_numeric($jobId)) {
                        return;
                    }
                    $exportJobService->runJob((int) $jobId);
                },
                10,
                1,
            );

            // Cleanup diario: borra jobs (y sus archivos) > 7 días.
            add_action('imagina_crm/export_jobs_cleanup', static function () use ($exportJobService): void {
                $exportJobService->purgeOldJobs(7);
            });
            if (! wp_next_scheduled('imagina_crm/export_jobs_cleanup')) {
                wp_schedule_event(time() + 3600, 'daily', 'imagina_crm/export_jobs_cleanup');
            }
        }

        // Tick recurrente del runner de triggers programados.
        $scheduledRunner = $this->container->get(ScheduledRunner::class);
        if ($scheduledRunner instanceof ScheduledRunner) {
            add_action(
                ScheduledRunner::HOOK_TICK,
                [$scheduledRunner, 'tick'],
                10,
                0,
            );
        }

        // Recurrencias por record. El runner se engancha a:
        //  - `imagina_crm/record_updated`: detecta transiciones de
        //    estado para los triggers `status_change`.
        //  - `ScheduledRunner::HOOK_TICK`: en cada tick horario,
        //    barre las recurrencias `schedule` cuya fecha ya pasó.
        $recurrenceRunner = $this->container->get(\ImaginaCRM\Recurrences\RecurrenceRunner::class);
        if ($recurrenceRunner instanceof \ImaginaCRM\Recurrences\RecurrenceRunner) {
            $recurrenceRunner->register();
        }

        // Activity log: el logger se suscribe a los eventos de dominio
        // que ya disparan RecordService, CommentService y AutomationEngine.
        // Como append-only, no afecta la request original aunque falle al
        // insertar.
        $activity = $this->container->get(ActivityLogger::class);
        if ($activity instanceof ActivityLogger) {
            add_action(
                'imagina_crm/record_created',
                static function (mixed $list, mixed $recordId, mixed $record, mixed $values) use ($activity): void {
                    unset($values);
                    if (! $list instanceof ListEntity || ! is_numeric($recordId)) {
                        return;
                    }
                    $activity->recordCreated(
                        $list,
                        (int) $recordId,
                        is_array($record) ? $record : null,
                    );
                },
                10,
                4,
            );

            add_action(
                'imagina_crm/record_updated',
                static function (mixed $list, mixed $recordId, mixed $newRecord, mixed $previous) use ($activity): void {
                    if (! $list instanceof ListEntity || ! is_numeric($recordId)) {
                        return;
                    }
                    $activity->recordUpdated(
                        $list,
                        (int) $recordId,
                        is_array($newRecord) ? $newRecord : null,
                        is_array($previous) ? $previous : null,
                    );
                },
                10,
                4,
            );

            add_action(
                'imagina_crm/record_deleted',
                static function (mixed $list, mixed $recordId, mixed $purge) use ($activity): void {
                    if (! $list instanceof ListEntity || ! is_numeric($recordId)) {
                        return;
                    }
                    $activity->recordDeleted($list, (int) $recordId, (bool) $purge);
                },
                10,
                3,
            );

            add_action(
                'imagina_crm/comment_created',
                static function (mixed $comment) use ($activity): void {
                    if ($comment instanceof CommentEntity) {
                        $activity->commentCreated($comment);
                    }
                },
                10,
                1,
            );

            // Menciones: parsea @logins y notifica a los usuarios
            // mencionados (priority 20 — corre después del logger
            // base para que el orden temporal del activity log sea
            // estable: comment.created → mention.received).
            $mentionNotifier = $this->container->get(MentionNotifier::class);
            if ($mentionNotifier instanceof MentionNotifier) {
                add_action(
                    'imagina_crm/comment_created',
                    static function (mixed $comment) use ($mentionNotifier): void {
                        if ($comment instanceof CommentEntity) {
                            $mentionNotifier->handleCommentCreated($comment);
                        }
                    },
                    20,
                    1,
                );
            }

            add_action(
                'imagina_crm/comment_updated',
                static function (mixed $after, mixed $before) use ($activity): void {
                    if ($after instanceof CommentEntity && $before instanceof CommentEntity) {
                        $activity->commentUpdated($after, $before);
                    }
                },
                10,
                2,
            );

            add_action(
                'imagina_crm/comment_deleted',
                static function (mixed $comment) use ($activity): void {
                    if ($comment instanceof CommentEntity) {
                        $activity->commentDeleted($comment);
                    }
                },
                10,
                1,
            );

            add_action(
                'imagina_crm/automation_run_completed',
                static function (mixed $automation, mixed $runId, mixed $status, mixed $log) use ($activity): void {
                    if (! $automation instanceof AutomationEntity || ! is_numeric($runId) || ! is_string($status)) {
                        return;
                    }
                    $activity->automationRun(
                        $automation,
                        (int) $runId,
                        $status,
                        is_array($log) ? $log : [],
                        null,
                    );
                },
                10,
                4,
            );
        }

        // StandalonePage hookea init/template_redirect — fire en
        // requests frontend (NO admin). Tiene que registrarse SIEMPRE,
        // fuera del if(is_admin()), porque la URL `/imagina-crm/` es
        // una request del frontend, no del wp-admin.
        $standalone = $this->container->get(StandalonePage::class);
        if ($standalone instanceof StandalonePage) {
            $standalone->register();
        }

        // Listas públicas (Fase 8): el shortcode y el enqueue de su CSS
        // viven en frontend. Es seguro registrarlos siempre — los
        // assets solo se cargan en páginas que tengan el shortcode (vía
        // detección perezosa en `PublicAssets`).
        $publicShortcode = $this->container->get(\ImaginaCRM\PublicLists\Shortcode::class);
        if ($publicShortcode instanceof \ImaginaCRM\PublicLists\Shortcode) {
            $publicShortcode->register();
        }
        $publicAssets = $this->container->get(\ImaginaCRM\PublicLists\PublicAssets::class);
        if ($publicAssets instanceof \ImaginaCRM\PublicLists\PublicAssets) {
            $publicAssets->register();
        }
        $publicBlock = $this->container->get(\ImaginaCRM\PublicLists\Block::class);
        if ($publicBlock instanceof \ImaginaCRM\PublicLists\Block) {
            $publicBlock->register();
        }
        // Permalinks dedicados (Fase 10): rewrite rules + render con
        // template del tema. Auto-flush cuando cambia la signature.
        $publicPermalinks = $this->container->get(\ImaginaCRM\PublicLists\PublicPermalinks::class);
        if ($publicPermalinks instanceof \ImaginaCRM\PublicLists\PublicPermalinks) {
            $publicPermalinks->register();
        }

        // Portal del cliente (Fase 9 — 3.B). Shortcode + enqueue lazy del
        // CSS. El JS llega en 3.F. El REST controller se registra abajo
        // junto con todo el resto via RestBootstrap.
        $portalShortcode = $this->container->get(\ImaginaCRM\Portal\PortalShortcode::class);
        if ($portalShortcode instanceof \ImaginaCRM\Portal\PortalShortcode) {
            $portalShortcode->register();
        }
        $portalAssets = $this->container->get(\ImaginaCRM\Portal\PortalAssets::class);
        if ($portalAssets instanceof \ImaginaCRM\Portal\PortalAssets) {
            $portalAssets->register();
        }
        // Magic links (Fase 10): hook en `template_redirect` que
        // detecta `?imcrm_token=...`, autentica vía cookie y redirige
        // limpio. Si no hay token presente, es no-op cero-overhead.
        $magicLinkConsumer = $this->container->get(\ImaginaCRM\Portal\MagicLinkConsumer::class);
        if ($magicLinkConsumer instanceof \ImaginaCRM\Portal\MagicLinkConsumer) {
            $magicLinkConsumer->register();
        }

        if (is_admin()) {
            $this->registerAdmin();
        }

        do_action('imagina_crm/booted', $this);
    }

    private function registerAdmin(): void
    {
        $assets = $this->container->get(AdminAssets::class);
        $menu   = $this->container->get(AdminMenu::class);

        if ($assets instanceof AdminAssets) {
            $assets->register();
        }

        if ($menu instanceof AdminMenu) {
            $menu->register();
        }
    }

    public function loadTextdomain(): void
    {
        load_plugin_textdomain(
            self::TEXT_DOMAIN,
            false,
            dirname(IMAGINA_CRM_BASENAME) . '/languages'
        );
    }

    /**
     * Re-corre las migraciones del SchemaManager si el `imcrm_db_version`
     * persistido difiere del declarado en código. Cubre el flujo de
     * `update plugin` desde el WP admin (que NO dispara
     * `register_activation_hook`).
     *
     * `dbDelta` es idempotente para tablas existentes — sólo aplica
     * diffs (nuevas tablas, nuevas columnas/índices). Es seguro
     * llamarlo cada activación.
     */
    public function maybeUpgradeSchema(): void
    {
        $stored = get_option(\ImaginaCRM\Activation\Installer::OPTION_DB_VERSION, '0');
        if ((string) $stored === self::DB_VERSION) {
            return;
        }
        $schema = $this->container->get(\ImaginaCRM\Lists\SchemaManager::class);
        if ($schema instanceof \ImaginaCRM\Lists\SchemaManager) {
            $schema->installSystemTables();
            // Re-sincroniza roles/caps en cada bump de DB_VERSION. La
            // operación es idempotente, así que es seguro correrla aun
            // si la migración no toca roles.
            $roleInstaller = $this->container->get(RoleInstaller::class);
            if ($roleInstaller instanceof RoleInstaller) {
                $roleInstaller->sync();
            }
            update_option(\ImaginaCRM\Activation\Installer::OPTION_DB_VERSION, self::DB_VERSION, false);
            do_action('imagina_crm/schema_upgraded', $stored, self::DB_VERSION);
        }
    }
}

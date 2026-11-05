import { Global, Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { FieldsModule } from '../fields/fields.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsRepository } from '../records/records.repository';
import { CollectionHooksController, CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { PublicSubscriptionsController, SubscriptionsController } from '../subscriptions/subscriptions.controller';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/**
 * Cobros de las empresas (v0.1.251, ADR-S31). @Global: el motor de
 * automatizaciones crea links con la acción «Crear link de pago» y no puede
 * importar este módulo sin ciclo (records → automations → …).
 * v0.1.367 — también las suscripciones (ADR-S96): mismas conexiones, misma URL
 * de avisos y el motor las usa igual.
 */
@Global()
@Module({
    imports: [AuthModule, ListsModule, FieldsModule, ActivityModule],
    controllers: [CollectionsController, CollectionHooksController, SubscriptionsController, PublicSubscriptionsController],
    providers: [CollectionsService, SubscriptionsService, RecordsRepository],
    exports: [CollectionsService, SubscriptionsService],
})
export class CollectionsModule {}

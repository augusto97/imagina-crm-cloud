import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { DomainsModule } from '../domains/domains.module';
import { FieldsModule } from '../fields/fields.module';
import { FilesModule } from '../files/files.module';
import { ListsModule } from '../lists/lists.module';
import { RecordsModule } from '../records/records.module';
import { RelationsRepository } from '../records/relations.repository';
import { ShopCouponsService } from './shop-coupons.service';
import { ShopImagesService } from './shop-images.service';
import { ShopOrdersService } from './shop-orders.service';
import { ShopPublicService } from './shop-public.service';
import { ShopTasksService } from './shop-tasks.service';
import { ShopVariantsService } from './shop-variants.service';
import { PlatformShopsController, PublicShopApiController, PublicShopPageController, RecordShopOrderController, ShopsController } from './shop.controller';
import { ShopService } from './shop.service';

/**
 * v0.1.412 (ADR-S103) — Tienda desde una lista: catálogo público, carrito y
 * pedidos que llegan como registros de «Pedidos».
 */
@Module({
    imports: [AuthModule, ActivityModule, DomainsModule, FieldsModule, FilesModule, ListsModule, RecordsModule],
    controllers: [ShopsController, RecordShopOrderController, PlatformShopsController, PublicShopPageController, PublicShopApiController],
    providers: [ShopService, ShopPublicService, ShopOrdersService, ShopImagesService, ShopTasksService, ShopVariantsService, ShopCouponsService, RelationsRepository, SuperadminGuard],
    exports: [ShopService, ShopOrdersService],
})
export class ShopModule {}

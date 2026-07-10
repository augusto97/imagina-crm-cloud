import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import {
    PublicAdminController,
    PublicController,
    PublicPageController,
} from './public.controller';
import { PublicListsService } from './public-lists.service';

/**
 * Listas públicas embebibles (solo-lectura por token opaco + restricción de
 * dominio por iframe). Los endpoints públicos no llevan guards; el admin
 * (`PublicAdminController`) exige sesión + `manage_lists`.
 */
@Module({
    imports: [AuthModule, ListsModule],
    controllers: [PublicController, PublicPageController, PublicAdminController],
    providers: [PublicListsService],
    exports: [PublicListsService],
})
export class PublicListsModule {}

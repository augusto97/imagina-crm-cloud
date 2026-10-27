import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuperadminGuard } from '../authz/superadmin.guard';
import { FilesModule } from '../files/files.module';
import { PlatformBrandController, PublicBrandController } from './platform-brand.controller';
import { PlatformBrandService } from './platform-brand.service';

/**
 * v0.1.327 — la marca de la plataforma. Global: la leen el boot público
 * (dominios) y el manifiesto de la app instalable.
 */
@Global()
@Module({
    imports: [AuthModule, FilesModule],
    controllers: [PlatformBrandController, PublicBrandController],
    providers: [PlatformBrandService, SuperadminGuard],
    exports: [PlatformBrandService],
})
export class BrandModule {}

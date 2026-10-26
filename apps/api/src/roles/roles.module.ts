import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomRolesController } from './custom-roles.controller';
import { CustomRolesService } from './custom-roles.service';

/**
 * C2 — Roles propios. Global: Miembros, la consola y los permisos por lista
 * los leen sin tener que importar este módulo.
 */
@Global()
@Module({
    imports: [AuthModule],
    controllers: [CustomRolesController],
    providers: [CustomRolesService],
    exports: [CustomRolesService],
})
export class RolesModule {}

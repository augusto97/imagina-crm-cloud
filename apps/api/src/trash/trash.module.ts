import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { TrashController } from './trash.controller';
import { TrashJobs } from './trash.jobs';
import { TrashService } from './trash.service';

/**
 * Papelera: listar, restaurar, borrar para siempre y el vaciado diario. El
 * borrado en sí (mandar algo a la papelera) lo hace cada módulo con
 * `trash-ops.ts`; este módulo es el único que ve lo que está adentro.
 */
@Module({
    imports: [AuthModule, FilesModule],
    controllers: [TrashController],
    providers: [TrashService, TrashJobs],
    exports: [TrashService],
})
export class TrashModule {}

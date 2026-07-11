import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { FILE_STORAGE, LocalFileStorage } from './file-storage';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
    imports: [AuthModule],
    controllers: [FilesController],
    providers: [
        FilesService,
        {
            provide: FILE_STORAGE,
            inject: [ENV],
            useFactory: (env: Env) => new LocalFileStorage(env.UPLOADS_DIR),
        },
    ],
    exports: [FilesService],
})
export class FilesModule {}

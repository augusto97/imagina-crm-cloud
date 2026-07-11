import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ENV, type Env } from '../config/env';
import { FILE_STORAGE, LocalFileStorage } from './file-storage';
import { S3FileStorage } from './s3-file-storage';
import { FilesController, SignedFilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
    imports: [AuthModule],
    controllers: [FilesController, SignedFilesController],
    providers: [
        FilesService,
        {
            provide: FILE_STORAGE,
            inject: [ENV],
            useFactory: (env: Env) =>
                env.STORAGE_DRIVER === 's3'
                    ? new S3FileStorage({
                          endpoint: env.S3_ENDPOINT,
                          region: env.S3_REGION,
                          bucket: env.S3_BUCKET,
                          accessKeyId: env.S3_ACCESS_KEY_ID,
                          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
                          forcePathStyle: env.S3_FORCE_PATH_STYLE,
                      })
                    : new LocalFileStorage(env.UPLOADS_DIR),
        },
    ],
    exports: [FilesService],
})
export class FilesModule {}

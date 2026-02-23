import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { TicketsModule } from './tickets/tickets.module';
import { AppController } from './app.controller';
import { PublicController } from './public.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    TicketsModule,
  ],
  controllers: [AppController, PublicController],
})
export class AppModule {}

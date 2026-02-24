import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'body-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow larger payloads for logo/event settings (base64 images)
  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Keep /api/* prefixed while allowing bare '/' for a simple health check
  app.setGlobalPrefix('api', { exclude: [''] });

  const port = Number(process.env.PORT) || 5055;
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);
  console.log(`Holiii Backend running on http://${host}:${port}/api`);
}
bootstrap();

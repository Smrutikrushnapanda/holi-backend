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

  const port = process.env.PORT || 5000;
  await app.listen(port);
  console.log(`Holiiii Backend running on http://localhost:${port}/api`);
}
bootstrap();

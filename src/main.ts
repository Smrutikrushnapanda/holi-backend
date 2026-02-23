import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Keep /api/* prefixed while allowing bare '/' for a simple health check
  app.setGlobalPrefix('api', { exclude: [''] });

  const port = process.env.PORT || 5000;
  await app.listen(port);
  console.log(`Holi Backend running on http://localhost:${port}/api`);
}
bootstrap();

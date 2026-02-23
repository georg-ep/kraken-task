import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // TRADE-OFF: enableCors() with no arguments allows all origins.
  // In a real production API, we would restrict this to exactly the known frontend origins.
  app.enableCors();
  await app.listen(3000);
  console.log(`Backend running on http://localhost:3000`);
}
bootstrap();

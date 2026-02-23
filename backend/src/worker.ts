import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  console.log('BullMQ Worker process running');
}

bootstrapWorker().catch(err => {
  console.error('Worker failed to start', err);
  process.exit(1);
});

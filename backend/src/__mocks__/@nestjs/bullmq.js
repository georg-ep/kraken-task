// Manual mock for @nestjs/bullmq — prevents ESM uuid transitive import errors in Jest CJS mode.

const Processor = (queueName, opts) => (target) => {
  // Store metadata on the class for tests that use Reflect.getMetadata
  Reflect.defineMetadata('bullmq:worker_metadata', { queueName, ...(opts || {}) }, target);
  return target;
};

class WorkerHost {
  process() {}
}

const InjectQueue = (queueName) => () => {};

const stubModule = { module: class {} };
const BullModule = {
  forRoot: () => stubModule,
  forRootAsync: () => stubModule,
  forFeature: () => stubModule,
  registerQueue: (...args) => stubModule,
  registerFlowProducer: (...args) => stubModule,
};

const getQueueToken = (name) => `BullQueue_${name}`;

module.exports = { Processor, WorkerHost, InjectQueue, BullModule, getQueueToken };

// Manual mock for bullmq — prevents ESM uuid transitive import errors in Jest CJS mode.
// Exposes just enough surface for NestJS service constructors and the Processor decorator
// to work without loading the real bullmq source tree.

class Queue {
  constructor() {}
  add = jest.fn().mockResolvedValue({});
  close = jest.fn().mockResolvedValue(undefined);
  getJob = jest.fn().mockResolvedValue(null);
}

class Worker {
  constructor() {}
  close = jest.fn().mockResolvedValue(undefined);
  on = jest.fn();
}

class FlowProducer {
  constructor() {}
}

module.exports = { Queue, Worker, FlowProducer };

import { Queue, type Job, Worker } from 'bullmq';
import type { QueueOptions, WorkerOptions } from 'bullmq';
import { getRedisClient } from './redis';

interface QueueConfig {
  name: string;
  defaultJobOptions?: Partial<JobOptions>;
  workerOptions?: Partial<WorkerOptions>;
}

interface JobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
}

interface JobHandler<T = any, R = any> {
  (job: Job<T>): Promise<R>;
}

export class MessageQueue {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private redisClient = getRedisClient();

  /**
   * Create or get a queue
   */
  getQueue<T = any>(name: string, options?: Partial<QueueOptions>): Queue<T> {
    if (!this.queues.has(name)) {
      const queue = new Queue<T>(name, {
        connection: this.redisClient.getClient() as any,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: 100,
          removeOnFail: 1000,
        },
        ...options,
      });

      this.queues.set(name, queue);
    }
    return this.queues.get(name) as Queue<T>;
  }

  /**
   * Add a job to the queue
   */
  async addJob<T = any>(
    queueName: string,
    jobName: string,
    data: T,
    options?: JobOptions
  ): Promise<Job<T>> {
    const queue = this.getQueue<T>(queueName);
    return await queue.add(jobName as any, data as any, options as any) as any as Job<T>;
  }

  /**
   * Add multiple jobs to the queue
   */
  async addBulkJobs<T = any>(
    queueName: string,
    jobs: Array<{
      name: string;
      data: T;
      opts?: JobOptions;
    }>
  ): Promise<Job<T>[]> {
    const queue = this.getQueue<T>(queueName);
    return await queue.addBulk(jobs as any) as any as Job<T>[];
  }

  /**
   * Register a worker to process jobs
   */
  registerWorker<T = any, R = any>(
    queueName: string,
    handler: JobHandler<T, R>,
    options?: Partial<WorkerOptions>
  ): Worker<T, R> {
    const worker = new Worker<T, R>(
      queueName,
      async (job: Job<T>) => {
        console.log(`Processing job ${job.id} from queue ${queueName}`);
        try {
          const result = await handler(job);
          console.log(`Job ${job.id} completed successfully`);
          return result;
        } catch (error) {
          console.error(`Job ${job.id} failed:`, error);
          throw error;
        }
      },
      {
        connection: this.redisClient.getClient() as any,
        concurrency: 5,
        ...options,
      }
    );

    // Event handlers
    worker.on('completed', (job) => {
      console.log(`✓ Job ${job.id} completed`);
    });

    worker.on('failed', (job, err) => {
      console.error(`✗ Job ${job?.id} failed:`, err);
    });

    worker.on('error', (err) => {
      console.error(`Worker error in queue ${queueName}:`, err);
    });

    this.workers.set(queueName, worker);
    return worker;
  }

  /**
   * Get job by ID
   */
  async getJob<T = any>(queueName: string, jobId: string): Promise<Job<T> | undefined> {
    const queue = this.getQueue<T>(queueName);
    return await queue.getJob(jobId);
  }

  /**
   * Remove job by ID
   */
  async removeJob(queueName: string, jobId: string): Promise<void> {
    const job = await this.getJob(queueName, jobId);
    if (job) {
      await job.remove();
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string) {
    const queue = this.getQueue(queueName);
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Clean old jobs from queue
   */
  async cleanQueue(
    queueName: string,
    grace: number,
    limit: number,
    type: 'completed' | 'failed'
  ): Promise<string[]> {
    const queue = this.getQueue(queueName);
    return await queue.clean(grace, limit, type);
  }

  /**
   * Pause queue
   */
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.pause();
  }

  /**
   * Resume queue
   */
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.resume();
  }

  /**
   * Drain queue (remove all jobs)
   */
  async drainQueue(queueName: string, delayed: boolean = false): Promise<void> {
    const queue = this.getQueue(queueName);
    await queue.drain(delayed);
  }

  /**
   * Get all jobs by state
   */
  async getJobs<T = any>(
    queueName: string,
    types: Array<'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused'>,
    start?: number,
    end?: number
  ): Promise<Job<T>[]> {
    const queue = this.getQueue<T>(queueName);
    return await queue.getJobs(types, start, end);
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    const failedJobs = await queue.getFailed();
    await Promise.all(failedJobs.map(job => job.retry()));
  }

  /**
   * Schedule a recurring job
   */
  async addScheduledJob<T = any>(
    queueName: string,
    jobName: string,
    data: T,
    cronExpression: string
  ): Promise<Job<T>> {
    const queue = this.getQueue<T>(queueName);
    return await queue.add(jobName as any, data as any, {
      repeat: {
        pattern: cronExpression,
      },
    } as any) as any as Job<T>;
  }

  /**
   * Remove repeatable job
   */
  async removeRepeatableJob(
    queueName: string,
    jobName: string,
    repeatOpts: { pattern: string }
  ): Promise<boolean> {
    const queue = this.getQueue(queueName);
    return await queue.removeRepeatableByKey(`${jobName}:${repeatOpts.pattern}`);
  }

  /**
   * Close all queues and workers
   */
  async close(): Promise<void> {
    const workerPromises = Array.from(this.workers.values()).map(worker => worker.close());
    const queuePromises = Array.from(this.queues.values()).map(queue => queue.close());
    await Promise.all([...workerPromises, ...queuePromises]);
  }
}

// Singleton instance
let messageQueueInstance: MessageQueue | null = null;

export function getMessageQueue(): MessageQueue {
  if (!messageQueueInstance) {
    messageQueueInstance = new MessageQueue();
  }
  return messageQueueInstance;
}

// Job Types
export enum JobType {
  GENERATE_CONTENT = 'generate_content',
  SEND_EMAIL = 'send_email',
  WEBHOOK_DELIVERY = 'webhook_delivery',
  DATA_EXPORT = 'data_export',
  ANALYTICS_PROCESS = 'analytics_process',
  CACHE_WARM = 'cache_warm',
  CLEANUP = 'cleanup',
}

// Initialize common queues
export function initializeQueues(): void {
  const mq = getMessageQueue();

  // Content generation queue
  mq.getQueue('content-generation', {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 50,
    },
  });

  // Email queue
  mq.getQueue('email', {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
    },
  });

  // Webhook queue
  mq.getQueue('webhooks', {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: 100,
    },
  });

  // Analytics queue
  mq.getQueue('analytics', {
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: 1000,
    },
  });
}

export { Job, Worker };

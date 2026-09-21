declare module 'redlock' {
  import { Redis } from 'ioredis';

  export interface Lock {
    release(): Promise<void>;
  }

  export default class Redlock {
    constructor(clients: Redis[], options?: any);
    acquire(resources: string[], ttl: number): Promise<Lock>;
  }
}
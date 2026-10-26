/**
 * The parts of the Cloudflare Workers runtime the online relay uses (M30), declared here rather
 * than pulling in the full workers types package.
 */
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    ctx: DurableObjectState;
    env: Env;
    constructor(ctx: DurableObjectState, env: Env);
    /** Called when the alarm set with `storage.setAlarm` rings. */
    alarm?(): Promise<void>;
  }
}

interface SqlCursor<T> {
  toArray(): T[];
  one(): T;
  /** Rows written and read by the statement: what the free plan counts. */
  readonly rowsWritten: number;
  readonly rowsRead: number;
}
interface SqlStorage {
  exec<T = Record<string, string | number | null>>(query: string, ...bindings: unknown[]): SqlCursor<T>;
}
interface DurableObjectStorage {
  sql: SqlStorage;
  transactionSync<T>(fn: () => T): T;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  /** Delete everything stored (not the alarm: delete that first). */
  deleteAll(): Promise<void>;
}
interface CfWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
  readyState: number;
}
interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(ws: CfWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfWebSocket[];
  setWebSocketAutoResponse(pair: WebSocketRequestResponsePair): void;
}
declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
}
declare class WebSocketPair {
  0: CfWebSocket;
  1: CfWebSocket;
}
interface DurableObjectId {
  toString(): string;
}
interface DurableObjectStub {
  fetch(req: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

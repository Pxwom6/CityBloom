/**
 * The parts of the Cloudflare Workers runtime the online relay uses (M30), declared here rather
 * than pulling in the full workers types package.
 */
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    ctx: DurableObjectState;
    env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

interface SqlCursor<T> {
  toArray(): T[];
  one(): T;
}
interface SqlStorage {
  exec<T = Record<string, string | number | null>>(query: string, ...bindings: unknown[]): SqlCursor<T>;
}
interface DurableObjectStorage {
  sql: SqlStorage;
  transactionSync<T>(fn: () => T): T;
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

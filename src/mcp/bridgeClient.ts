import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

const MAX_MESSAGE_BYTES = 1024 * 1024;

interface BridgeRequest {
  id: string;
  token: string;
  name: string;
  args: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface MCPBridgeResponse {
  text: string;
  isError: boolean;
}

export class MCPBridgeClient {
  private socket: Socket | undefined;
  private connectPromise: Promise<Socket> | undefined;
  private buffer = '';
  private readonly pending = new Map<
    string,
    {
      resolve: (value: MCPBridgeResponse) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly pipeName: string,
    private readonly token: string,
  ) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPBridgeResponse> {
    const socket = await this.connect();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`MCP tool call timed out: ${name}`));
        },
        30 * 60 * 1000,
      );
      this.pending.set(id, { resolve, reject, timer });
      socket.write(
        `${JSON.stringify({ id, token: this.token, name, args } satisfies BridgeRequest)}\n`,
        (error) => {
          if (error) {
            const pending = this.pending.get(id);
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(id);
              reject(error);
            }
          }
        },
      );
    });
  }

  private connect(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve(this.socket);
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const connection = new Promise<Socket>((resolve, reject) => {
      const client = createConnection(this.pipeName);
      let connected = false;
      client.setEncoding('utf8');
      client.on('data', (chunk: string) => this.receive(chunk));
      client.on('error', (error: Error) => {
        if (!connected) {
          reject(error);
        }
        this.failPending(error);
      });
      client.on('close', () => {
        if (this.socket === client) {
          this.socket = undefined;
        }
        this.failPending(new Error('MCP bridge connection closed'));
      });
      client.once('connect', () => {
        connected = true;
        this.socket = client;
        resolve(client);
      });
    }).finally(() => {
      this.connectPromise = undefined;
    });
    this.connectPromise = connection;
    return connection;
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_MESSAGE_BYTES) {
      this.socket?.destroy(new Error('MCP bridge response exceeds the size limit'));
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      try {
        const parsed = JSON.parse(line) as {
          id?: unknown;
          result?: unknown;
          error?: unknown;
        };
        if (typeof parsed.id !== 'string') {
          throw new Error('Invalid MCP bridge response id');
        }
        const pending = this.pending.get(parsed.id);
        if (!pending) {
          newline = this.buffer.indexOf('\n');
          continue;
        }
        clearTimeout(pending.timer);
        this.pending.delete(parsed.id);
        if (
          isRecord(parsed.result) &&
          typeof parsed.result.text === 'string' &&
          typeof parsed.result.isError === 'boolean'
        ) {
          pending.resolve({ text: parsed.result.text, isError: parsed.result.isError });
        } else {
          pending.reject(
            new Error(
              typeof parsed.error === 'string' ? parsed.error : 'Invalid MCP bridge result',
            ),
          );
        }
      } catch (error) {
        this.failPending(error instanceof Error ? error : new Error(String(error)));
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  dispose(): void {
    this.socket?.destroy();
    this.socket = undefined;
    this.failPending(new Error('MCP bridge client disposed'));
  }
}

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type * as vscode from 'vscode';
import { callToolResultAsync } from './tools';

const MAX_MESSAGE_BYTES = 1024 * 1024;
const PIPE_PREFIX = '\\\\.\\pipe\\vscode-ue-helper-mcp-';

interface BridgeRequest {
  id: string;
  token: string;
  name: string;
  args: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class MCPBridgeServer implements vscode.Disposable {
  readonly pipeName = `${PIPE_PREFIX}${randomUUID()}`;
  readonly token = randomBytes(32).toString('hex');
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly logger: { error(message: string, ...args: unknown[]): void }) {
    this.server = createServer((socket) => this.accept(socket));
  }

  get environment(): Record<string, string> {
    return {
      VSCODE_UE_HELPER_MCP_PIPE: this.pipeName,
      VSCODE_UE_HELPER_MCP_TOKEN: this.token,
    };
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        this.server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.server.removeListener('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.pipeName);
    });
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_MESSAGE_BYTES) {
        socket.destroy(new Error('MCP bridge message exceeds the size limit'));
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        this.handleLine(socket, line);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('error', (error) => this.logger.error('[mcp] bridge socket error:', error));
    socket.on('close', () => this.sockets.delete(socket));
  }

  private handleLine(socket: Socket, line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      this.logger.error('[mcp] invalid bridge request JSON:', error);
      socket.destroy(new Error('Invalid MCP bridge request'));
      return;
    }

    if (!isRecord(parsed)) {
      socket.destroy(new Error('Invalid MCP bridge request shape'));
      return;
    }
    const request = parsed as Partial<BridgeRequest>;
    if (
      typeof request.id !== 'string' ||
      typeof request.token !== 'string' ||
      typeof request.name !== 'string' ||
      !isRecord(request.args)
    ) {
      socket.destroy(new Error('Invalid MCP bridge request fields'));
      return;
    }

    const expected = Buffer.from(this.token, 'utf8');
    const provided = Buffer.from(request.token, 'utf8');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      socket.destroy(new Error('Unauthorized MCP bridge request'));
      return;
    }

    void callToolResultAsync(request.name, request.args).then(
      (result) => {
        if (!socket.destroyed) {
          socket.write(`${JSON.stringify({ id: request.id, result })}\n`);
        }
      },
      (error: unknown) => {
        this.logger.error(`[mcp] tool ${request.name} failed:`, error);
        if (!socket.destroyed) {
          socket.write(
            `${JSON.stringify({
              id: request.id,
              result: {
                text: JSON.stringify({
                  ok: false,
                  error: {
                    code: 'INTERNAL_ERROR',
                    message: error instanceof Error ? error.message : String(error),
                  },
                  isError: true,
                }),
                isError: true,
              },
            })}\n`,
          );
        }
      },
    );
  }

  dispose(): void {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    if (this.server.listening) {
      this.server.close((error) => {
        if (error) {
          this.logger.error('[mcp] failed to close bridge:', error);
        }
      });
    }
  }
}

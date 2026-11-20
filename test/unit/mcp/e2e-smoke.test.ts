import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MCPBridgeServer } from '@mcp/bridge';
import { MCP_TOOLS, setMCPContext } from '@mcp/tools';
import type { Logger } from '@core/logger';

/**
 * bugfix-005 端到端冒烟:模拟 VS Code 的 MCP 启动路径。
 * 扩展宿主侧 bridge + 真实 out/mcpServer.js 子进程,验证 bridge 回连链路。
 * 依赖 `npm run build` 产物,产物缺失时跳过(`npm test` 不先构建)。
 */
describe.skipIf(!existsSync(resolve(__dirname, '../../../out/mcpServer.js')))(
  'e2e smoke: VS Code MCP startup path',
  () => {
  it('spawns out/mcpServer.js and completes a tool call through the bridge', async () => {
    const script = resolve(__dirname, '../../../out/mcpServer.js');
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
    setMCPContext({
      config: { configuration: 'Development', target: 'Editor', platform: 'Win64' },
      logger,
    } as never);

    const bridge = new MCPBridgeServer(logger);
    await bridge.start();
    try {
      const env = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ...bridge.environment,
        VSCODE_UE_HELPER_MCP_TOOLS: JSON.stringify(MCP_TOOLS),
      };
      const child = spawn(process.execPath, [script], { env });
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      const send = (msg: object): void => {
        child.stdin.write(JSON.stringify(msg) + '\n');
      };
      send({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } },
      });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ue_status', arguments: {} } });

      // 轮询等待 tools/call 响应(最多 10s)
      const deadline = Date.now() + 10_000;
      let callResponse = '';
      while (Date.now() < deadline) {
        const line = out.split('\n').find((l) => l.includes('"id":2'));
        if (line) {
          callResponse = line;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      child.kill();
      expect(err, `子进程 stderr: ${err.slice(0, 400)}`).toBe('');
      expect(callResponse, `未收到 tools/call 响应,stdout=${out.slice(0, 400)}`).toContain('"id":2');
      const parsed = JSON.parse(callResponse) as { result?: { isError?: boolean; content?: { text: string }[] } };
      expect(parsed.result?.isError).toBeFalsy();
      expect(parsed.result?.content?.[0]?.text).toContain('"ok":true');
    } finally {
      bridge.dispose();
      setMCPContext(null);
    }
  }, 15_000);
  },
);

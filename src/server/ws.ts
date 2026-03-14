import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createRouter } from './router.js';
import type { ServerEvent } from '../protocol/types.js';

const PORT = Number(process.env.PORT ?? 3284);
const HOST = process.env.HOST ?? '127.0.0.1';

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  const router = createRouter({
    providerOptions: {
      claudeMode: (process.env.CLAUDE_MODE as 'mock' | 'cli' | undefined) ?? 'cli',
      claudePermissionMode: (process.env.CLAUDE_PERMISSION_MODE as 'default' | 'acceptEdits' | 'bypassPermissions' | undefined) ?? 'acceptEdits',
    },
    eventSink: (event: ServerEvent) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    },
  });

  socket.on('message', (raw) => {
    try {
      const payload = JSON.parse(String(raw));
      const out = router.handle(payload);

      if (out.response && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(out.response));
      }

    } catch (error) {
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: error instanceof Error ? error.message : 'Parse error',
            },
          }),
        );
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`claude-app-server ws listening on ws://${HOST}:${PORT}`);
});

import { createServer } from 'http';
import { pathToFileURL } from 'url';
import { handleGatewayRequest } from './http.mjs';
import { setInferHook, resetInferHook, resetQueue, getHealth, enqueueJob, getJob, cancelJob } from './queue.mjs';

export { setInferHook, resetInferHook, resetQueue, getHealth, enqueueJob, getJob, cancelJob };

export function createGatewayServer() {
  return createServer((req, res) => {
    handleGatewayRequest(req, res).catch((e) => {
      if (!res.headersSent) {
        res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message || 'internal error' }));
      }
    });
  });
}

export function startGateway(port = Number(process.env.JETSON_GATEWAY_PORT || 0), host = process.env.JETSON_GATEWAY_HOST || '127.0.0.1') {
  const server = createGatewayServer();
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const boundHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      resolve({
        server,
        port: actualPort,
        url: `http://${boundHost}:${actualPort}`,
      });
    });
  });
}

const thisFile = pathToFileURL(process.argv[1] || '').href;
if (import.meta.url === thisFile) {
  const port = Number(process.env.JETSON_GATEWAY_PORT || 8787);
  const host = process.env.JETSON_GATEWAY_HOST || '0.0.0.0';
  const { url, port: bound } = await startGateway(port, host);
  console.log(`Jetson Image Gateway listening on ${url} (bound ${host}:${bound})`);
}

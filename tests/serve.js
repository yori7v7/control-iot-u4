import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const root = fileURLToPath(new URL('../', import.meta.url));
const basePath = '/control-iot-u4/';
const types = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
};

createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const { pathname, search } = new URL(request.url, `http://${host}:${port}`);
  if (pathname === '/' || pathname === basePath.slice(0, -1)) {
    response.writeHead(302, { Location: `${basePath}${search}` }).end();
    return;
  }
  const asset = pathname.slice(basePath.length) || 'index.html';
  const isPublic = asset === 'index.html' ||
    /^assets\/(?:[a-z\d_-]+\/)*[a-z\d_.-]+\.(?:css|js|svg)$/i.test(asset);
  if (!pathname.startsWith(basePath) || !isPublic) {
    response.writeHead(404).end();
    return;
  }

  try {
    const contents = await readFile(resolve(root, asset));
    const extension = asset.split('.').at(-1).toLowerCase();
    response.writeHead(200, {
      'Content-Type': types[extension],
      'Content-Length': contents.length,
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, host, () => {
  console.log(`Control IoT · http://${host}:${port}${basePath}`);
});

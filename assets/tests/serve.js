import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolvePublicAsset } from './public-assets.js';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const basePath = '/control-iot-u4/';

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
  const asset = resolvePublicAsset(pathname, basePath);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }

  try {
    const contents = await readFile(asset.url);
    response.writeHead(200, {
      'Content-Type': asset.contentType,
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

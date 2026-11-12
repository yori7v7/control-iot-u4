const projectRoot = new URL('../../', import.meta.url);
const style = /^assets\/css\/(?:[a-z\d_-]+\/)*[a-z\d_.-]+\.css$/i;
const module = /^assets\/js\/(?:[a-z\d_-]+\/)*[a-z\d_.-]+\.js$/i;

export function resolvePublicAsset(pathname, basePath) {
  if (!pathname.startsWith(basePath)) return null;
  const path = pathname.slice(basePath.length) || 'index.html';
  let contentType;
  if (path === 'index.html') contentType = 'text/html; charset=utf-8';
  else if (path === 'assets/favicon.svg' || path === 'assets/icons.svg') contentType = 'image/svg+xml';
  else if (style.test(path)) contentType = 'text/css; charset=utf-8';
  else if (module.test(path)) contentType = 'text/javascript; charset=utf-8';
  else return null;
  return { url: new URL(path, projectRoot), contentType };
}

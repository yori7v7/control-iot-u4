import { CONFIG } from '../config.js';

const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
export const baseUrl = local ? 'http://127.0.0.1:8043' : CONFIG.apiUrl;

export async function request(path, { method = 'GET', token, body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const timeout = AbortSignal.timeout(12000);
  const options = { method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error',
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout };
  if (body !== undefined) options.body = JSON.stringify(body);
  let response;
  try {
    response = await fetch(`${baseUrl}/plataforma${path}`, options);
  } catch {
    throw new Error('No se pudo contactar con la API.');
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const detail = typeof data?.detail === 'string' ? data.detail
      : Array.isArray(data?.detail) ? data.detail.map(item => item.msg).join(' ') : 'La API devolvió un error.';
    throw Object.assign(new Error(detail), { status: response.status });
  }
  return data;
}

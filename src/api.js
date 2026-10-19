/**
 * API client module for Baidu Netdisk Link Resolver
 *
 * Defaults to relative path `/api` so that Vite dev proxy or Nginx reverse proxy
 * seamlessly handles the upstream requests to `http://mxd.indevs.in`, eliminating
 * CORS and HTTPS Mixed Content blocking.
 */

export const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/+$/, '');

/**
 * Fetch share info and file list
 * @param {Object} params - { sign, site, surl, pwd }
 * @returns {Promise<{code: number, share?: {uid: string, sid: string}, list?: Array, message?: string}>}
 */
export async function fetchShareInfo(params) {
  try {
    const res = await fetch(`${API_BASE}/api/dupansi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      return { code: res.status, message: `HTTP 错误: ${res.status} ${res.statusText}` };
    }
    const data = await res.json();
    return data;
  } catch (err) {
    return { code: 1, message: err.message || '网络连接失败' };
  }
}

/**
 * Fetch direct download link for a specific file
 * @param {Object} params - { sign, site, surl, pwd, uid, sid, fid }
 * @returns {Promise<{code: number, data?: {url: string[], info: {out: string, 'user-agent': string}}, message?: string}>}
 */
export async function fetchDirectLink(params) {
  try {
    const res = await fetch(`${API_BASE}/api/dupan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      return { code: res.status, message: `HTTP 错误: ${res.status} ${res.statusText}` };
    }
    const data = await res.json();
    return data;
  } catch (err) {
    return { code: 1, message: err.message || '网络连接失败' };
  }
}

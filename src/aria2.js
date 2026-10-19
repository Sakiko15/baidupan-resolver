/**
 * Aria2 / Motrix JSON-RPC Client Integration
 */

import { uid, fixpath, load, save, dialog, xdialog, form, xbody } from './utils.js';

const DEFAULT_CONFIG = {
  token: '',
  jsonrpc: 'http://localhost:16800/jsonrpc',
};

/**
 * Get current Aria2 configuration from localStorage
 */
export function getAria2Config() {
  return load('aria2', DEFAULT_CONFIG);
}

/**
 * Save Aria2 configuration to localStorage
 */
export function saveAria2Config(config) {
  save('aria2', config);
}

/**
 * Build Aria2 JSON-RPC payload with optional token authentication
 * @param {string} method
 * @param {Array} methodParams
 * @param {string} [token]
 * @returns {Object}
 */
export function buildAria2Payload(method, methodParams = [], token = '') {
  const params = [];
  if (token?.trim()) {
    params.push(`token:${token.trim()}`);
  }
  params.push(...methodParams);
  return {
    id: uid(),
    method,
    params,
  };
}

/**
 * Test connectivity with Motrix / Aria2 JSON-RPC endpoint
 * @param {Object} [config]
 * @returns {Promise<boolean>}
 */
export async function checkConnection(config = getAria2Config()) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1000);

  const payload = buildAria2Payload('aria2.changeGlobalOption', [{ 'max-concurrent-downloads': '2' }], config.token);

  try {
    const res = await fetch(config.jsonrpc || DEFAULT_CONFIG.jsonrpc, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const json = await res.json();
    return json?.result === 'OK';
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

/**
 * Push download task to Aria2 / Motrix
 * @param {string[]|string} urls - Direct download URL(s)
 * @param {Object} info - { out: string, 'user-agent': string }
 * @param {Object} [config]
 * @returns {Promise<{code: number, result?: any, message?: string}>}
 */
export async function addDownloadTask(urls, info = {}, config = getAria2Config(), timeoutMs = 15000) {
  const urlList = Array.isArray(urls) ? urls : [urls];
  const filename = fixpath(info.out || '');
  const userAgent = info['user-agent'] || 'netdisk';

  const payload = buildAria2Payload(
    'aria2.addUri',
    [
      urlList,
      {
        out: filename,
        'user-agent': userAgent,
      },
    ],
    config.token
  );

  try {
    const res = await fetch(config.jsonrpc || DEFAULT_CONFIG.jsonrpc, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json();
    if (json.error) {
      return { code: 1, message: json.error.message || 'Aria2 任务创建失败' };
    }
    return { code: 0, result: json.result };
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout');
    return { code: 1, message: isTimeout ? 'Aria2 推送超时' : (err.message || 'Aria2 请求失败') };
  }
}

/**
 * Open the Aria2 / Motrix configuration modal
 * @param {Function} [onSave] - Callback after saving configuration
 */
export function showConfigDialog(onSave) {
  const currentConfig = getAria2Config();
  const formEl = document.createElement('form');
  formEl.method = 'dialog';
  formEl.innerHTML = `
    <label class="font-medium text-stone-700">Motrix / Aria2 RPC 地址</label>
    <label>
      <svg width="20" height="20" viewBox="0 0 48 48" fill="none" class="text-stone-500">
        <path d="M30 19H20C15.5817 19 12 22.5817 12 27C12 31.4183 15.5817 35 20 35H36C40.4183 35 44 31.4183 44 27C44 24.9711 43.2447 23.1186 42 21.7084" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6 24.2916C4.75527 22.8814 4 21.0289 4 19C4 14.5817 7.58172 11 12 11H28C32.4183 11 36 14.5817 36 19C36 23.4183 32.4183 27 28 27H18" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <input name="jsonrpc" type="text" autocomplete="off" placeholder="http://localhost:16800/jsonrpc" required>
    </label>
    <label class="font-medium text-stone-700">RPC 密钥 (Token)</label>
    <label>
      <svg width="20" height="20" viewBox="0 0 48 48" fill="none" class="text-stone-500">
        <circle cx="15" cy="33" r="8" fill="none" stroke="currentColor" stroke-width="4"/>
        <path d="M29 16L35.5 22" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M20 26L37 7" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M35 11L42 17.5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <input name="token" type="text" autocomplete="off" placeholder="无密码则保持为空">
    </label>
    <div class="group mt-4">
      <button type="button"><i class="bi-x-square"></i> 取消</button>
      <button type="submit"><i class="bi-check2-square"></i> 保存配置</button>
    </div>
  `;

  formEl.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(formEl);
    const jsonrpc = (fd.get('jsonrpc') || '').toString().trim() || DEFAULT_CONFIG.jsonrpc;
    const token = (fd.get('token') || '').toString().trim();
    const updated = { jsonrpc, token };
    saveAria2Config(updated);
    xdialog();
    if (typeof onSave === 'function') onSave(updated);
  });

  formEl.querySelector('button[type=button]').addEventListener('click', xdialog);
  dialog(formEl);
  form('#liveDialog', currentConfig);
}

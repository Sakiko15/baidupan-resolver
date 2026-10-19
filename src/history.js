/**
 * Baidu Netdisk Link Resolver History Management
 * Manages persistent resolution history in localStorage.
 */

import {
  uid,
  save,
  load,
  fixpath,
  escapeHtml,
  escapeShellArg,
  buildIdmCommand,
  copyToClipboard,
  dialog,
  xdialog,
  toast,
} from './utils.js';
import { checkConnection, addDownloadTask, showConfigDialog } from './aria2.js';

export const STORAGE_KEY = 'bd_parse_history';
export const MAX_HISTORY = 100;

/**
 * Safely retrieve parsed history list from localStorage.
 * Always returns an array (empty array on missing/corrupted data).
 * @returns {Array<Object>}
 */
export function getHistoryList() {
  const items = load(STORAGE_KEY, []);
  return Array.isArray(items) ? items : [];
}

/**
 * Add or update a history record.
 * Idempotent: If identical file exists (by surl+fid or fid), updates url, size, timestamp and moves to front.
 * Truncates exceeding MAX_HISTORY items (FIFO).
 * @param {Object} param0
 * @param {string} [param0.id]
 * @param {string} param0.fid
 * @param {string} param0.name
 * @param {string|number} [param0.size]
 * @param {string} param0.url
 * @param {string} [param0.ua]
 * @param {string} [param0.surl]
 * @param {string} [param0.pwd]
 * @returns {Array<Object>} Updated history array
 */
export function addHistoryItem({
  fid = '',
  name = '',
  size = '',
  url = '',
  ua = 'netdisk',
  surl = '',
  pwd = '',
} = {}) {
  const cleanName = fixpath(String(name || '')).trim();
  const cleanUrl = String(url || '').trim();

  // Validate required fields
  if (!cleanName || !cleanUrl) {
    return getHistoryList();
  }

  const list = getHistoryList();
  const fidStr = String(fid || '').trim();
  const surlStr = String(surl || '').trim();

  const item = {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    fid: fidStr,
    name: cleanName,
    size: String(size ?? ''),
    url: cleanUrl,
    ua: String(ua || 'netdisk').trim(),
    surl: surlStr,
    pwd: String(pwd || '').trim(),
    time: Date.now(),
  };

  // Find if already exists
  const existingIdx = list.findIndex(x => {
    if (!x) return false;
    if (surlStr && fidStr) {
      return x.surl === surlStr && x.fid === fidStr;
    }
    if (fidStr) {
      return x.fid === fidStr;
    }
    return x.name === cleanName;
  });

  if (existingIdx !== -1) {
    const existing = list[existingIdx];
    list.splice(existingIdx, 1);
    list.unshift({
      ...existing,
      ...item,
      id: existing.id || item.id,
    });
  } else {
    list.unshift(item);
  }

  const trimmed = list.slice(0, MAX_HISTORY);
  save(STORAGE_KEY, trimmed);
  return trimmed;
}

/**
 * Remove single item by unique ID
 * @param {string} id
 * @returns {Array<Object>} Updated history array
 */
export function removeHistoryItem(id) {
  if (!id) return getHistoryList();
  const list = getHistoryList().filter(x => x && x.id !== id);
  save(STORAGE_KEY, list);
  return list;
}

/**
 * Clear all history items
 * @returns {Array} Empty array
 */
export function clearHistory() {
  save(STORAGE_KEY, []);
  return [];
}

/**
 * Format timestamp into YYYY-MM-DD HH:mm:ss
 * @param {number|string} timestamp
 * @returns {string}
 */
export function formatHistoryTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(Number(timestamp));
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

/**
 * Filter history items by keyword (case-insensitive on name or surl)
 * @param {string} keyword
 * @param {Array<Object>} [list]
 * @returns {Array<Object>}
 */
export function filterHistory(keyword = '', list = null) {
  const items = Array.isArray(list) ? list : getHistoryList();
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return items;
  return items.filter(x => {
    if (!x) return false;
    const nameMatch = x.name && String(x.name).toLowerCase().includes(kw);
    const surlMatch = x.surl && String(x.surl).toLowerCase().includes(kw);
    return Boolean(nameMatch || surlMatch);
  });
}

/**
 * Show comprehensive export & download modal for history item
 * @param {Object} item
 */
export function showHistoryMoreModal(item) {
  if (!item) return;

  const ua = item.ua || 'netdisk';
  const curlCmd = `curl -L -A ${escapeShellArg(ua)} -o ${escapeShellArg(item.name)} ${escapeShellArg(item.url)}`;
  const idmCmd = buildIdmCommand(item.url, item.name);

  const modalEl = document.createElement('div');
  modalEl.className = 'text-left space-y-4 max-w-lg w-full font-sans';
  modalEl.innerHTML = `
    <div class="flex items-start justify-between border-b border-slate-200/80 pb-3">
      <div>
        <h3 class="font-bold text-slate-800 text-sm sm:text-base flex items-center gap-2">
          <i class="bi-file-earmark-arrow-down text-blue-600"></i>
          <span>历史文件下载选项</span>
        </h3>
        <p class="text-xs text-slate-500 mt-0.5 break-all max-w-sm line-clamp-1">${escapeHtml(item.name)}</p>
      </div>
      <button type="button" id="btnModalClose" class="text-slate-400 hover:text-slate-600 text-lg p-1 leading-none">&times;</button>
    </div>

    <div class="space-y-3 text-xs">
      <div>
        <label class="block font-medium text-slate-700 mb-1">下载直链 URL</label>
        <div class="flex items-center gap-1.5">
          <input type="text" readonly value="${escapeHtml(item.url)}" class="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-600 font-mono text-[11px] select-all">
          <button type="button" id="btnCopyUrl" class="shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition">
            复制
          </button>
        </div>
      </div>

      <div>
        <label class="block font-medium text-slate-700 mb-1">User-Agent 请求头</label>
        <div class="flex items-center gap-1.5">
          <input type="text" readonly value="${escapeHtml(ua)}" class="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-600 font-mono text-[11px] select-all">
          <button type="button" id="btnCopyUa" class="shrink-0 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium transition">
            复制
          </button>
        </div>
      </div>

      <div>
        <label class="block font-medium text-slate-700 mb-1">cURL 终端命令行</label>
        <div class="flex items-center gap-1.5">
          <input type="text" readonly value="${escapeHtml(curlCmd)}" class="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-600 font-mono text-[11px] select-all">
          <button type="button" id="btnCopyCurl" class="shrink-0 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium transition">
            复制
          </button>
        </div>
      </div>

      <div>
        <label class="block font-medium text-slate-700 mb-1">IDM (Internet Download Manager) 调用命令</label>
        <div class="flex items-center gap-1.5">
          <input type="text" readonly value="${escapeHtml(idmCmd)}" class="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-600 font-mono text-[11px] select-all">
          <button type="button" id="btnCopyIdm" class="shrink-0 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium transition">
            复制
          </button>
        </div>
      </div>
    </div>

    <div class="pt-2 border-t border-slate-200/80 flex items-center justify-between">
      <button type="button" id="btnModalPushMotrix" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium inline-flex items-center gap-1.5 transition">
        <i class="bi-rocket-takeoff"></i><span>推送到 Motrix</span>
      </button>
      <button type="button" id="btnModalClose2" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium transition">
        关闭
      </button>
    </div>
  `;

  modalEl.querySelector('#btnModalClose')?.addEventListener('click', xdialog);
  modalEl.querySelector('#btnModalClose2')?.addEventListener('click', xdialog);

  modalEl.querySelector('#btnCopyUrl')?.addEventListener('click', async () => {
    await copyToClipboard(item.url);
    toast('直链已复制！注意：下载需使用 User-Agent: netdisk');
  });

  modalEl.querySelector('#btnCopyUa')?.addEventListener('click', async () => {
    await copyToClipboard(ua);
    toast('User-Agent 已复制: netdisk');
  });

  modalEl.querySelector('#btnCopyCurl')?.addEventListener('click', async () => {
    await copyToClipboard(curlCmd);
    toast('cURL 命令已复制到剪贴板');
  });

  modalEl.querySelector('#btnCopyIdm')?.addEventListener('click', async () => {
    await copyToClipboard(idmCmd);
    toast('IDM 下载命令已复制');
  });

  modalEl.querySelector('#btnModalPushMotrix')?.addEventListener('click', async () => {
    const isAlive = await checkConnection();
    if (!isAlive) {
      showConfigDialog();
      toast('Motrix 未连接，请确认 Motrix 是否启动或配置 RPC 地址');
      return;
    }
    const pushRes = await addDownloadTask(item.url, {
      out: item.name,
      'user-agent': item.ua || 'netdisk',
    });
    if (pushRes.code === 0) {
      toast('已推送到 Motrix 下载列表');
      xdialog();
    } else {
      dialog(`推送到 Motrix 失败：${escapeHtml(pushRes.message)}`);
    }
  });

  dialog(modalEl);
}

/**
 * Initialize History Page lifecycle & event bindings
 */
export function initHistoryPage() {
  if (typeof document === 'undefined') return;

  const totalCountEl = document.getElementById('historyTotalCount');
  const searchInput = document.getElementById('historySearchInput');
  const clearSearchBtn = document.getElementById('btnClearSearch');
  const clearAllBtn = document.getElementById('btnClearAllHistory');
  const tableContainer = document.getElementById('historyTableContainer');
  const tableBody = document.getElementById('historyTableBody');
  const emptyState = document.getElementById('historyEmptyState');

  if (!tableBody) return;

  function render(query = '') {
    const allItems = getHistoryList();
    const count = allItems.length;

    if (totalCountEl) {
      totalCountEl.textContent = `${count} 条`;
    }

    if (count === 0) {
      tableContainer?.classList.add('hidden');
      emptyState?.classList.remove('hidden');
      emptyState?.classList.add('flex');
      return;
    }

    tableContainer?.classList.remove('hidden');
    emptyState?.classList.add('hidden');
    emptyState?.classList.remove('flex');

    const filtered = filterHistory(query, allItems);

    if (filtered.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="3" class="py-12 text-center text-slate-400 font-sans">
            <i class="bi-search text-xl block mb-2 text-slate-300"></i>
            <span>未找到包含 &ldquo;${escapeHtml(query)}&rdquo; 的历史记录</span>
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = filtered.map(item => `
      <tr class="group hover:bg-slate-50/80 transition-colors" data-id="${escapeHtml(item.id)}">
        <td class="text-right text-slate-500 whitespace-nowrap py-3 px-3 font-mono">
          ${item.size ? `${escapeHtml(item.size)} <span class="text-[11px] text-slate-400 font-sans">MB</span>` : '<span class="text-slate-300">-</span>'}
        </td>
        <td class="text-left py-3 px-3">
          <div class="font-medium text-slate-800 break-all flex items-center gap-1.5">
            <i class="bi-file-earmark text-slate-400 shrink-0"></i>
            <span class="hover:text-blue-600 transition-colors">${escapeHtml(item.name)}</span>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400 font-mono">
            <span class="inline-flex items-center gap-1" title="解析时间">
              <i class="bi-clock text-[10px]"></i>
              <span>${formatHistoryTime(item.time)}</span>
            </span>
            ${item.surl ? `
            <span class="inline-flex items-center gap-1 text-slate-500" title="来源分享短链">
              <i class="bi-link-45deg text-[11px]"></i>
              <span>/s/1${escapeHtml(item.surl)}</span>
              ${item.pwd ? `<span class="text-slate-400">(码: ${escapeHtml(item.pwd)})</span>` : ''}
            </span>` : ''}
          </div>
        </td>
        <td class="text-right py-3 px-3 whitespace-nowrap space-x-1 font-sans">
          <button type="button" class="action-history-motrix text-xs px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-xs transition inline-flex items-center gap-1 cursor-pointer" title="推送到 Motrix / Aria2 (自动携带 UA)">
            <i class="bi-rocket-takeoff"></i><span class="hidden sm:inline">Motrix</span>
          </button>
          <button type="button" class="action-history-copy-url text-xs px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition inline-flex items-center gap-1 cursor-pointer" title="复制直链地址 (需设置 UA 为 netdisk)">
            <i class="bi-link-45deg"></i><span class="hidden sm:inline">复制直链</span>
          </button>
          <button type="button" class="action-history-reparse text-xs px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-600 transition inline-flex items-center gap-1 cursor-pointer" title="返回首页重新拉取此文件最新直链">
            <i class="bi-arrow-repeat"></i><span class="hidden md:inline">重解</span>
          </button>
          <button type="button" class="action-history-more text-xs px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 transition inline-flex items-center cursor-pointer" title="更多导出选项 (cURL / IDM)">
            <i class="bi-three-dots"></i>
          </button>
          <button type="button" class="action-history-delete text-xs px-1.5 py-1 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-600 transition inline-flex items-center cursor-pointer" title="删除此记录">
            <i class="bi-trash3"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  // Initial render
  render(searchInput?.value || '');

  // Search input handler
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      const val = e.target.value.trim();
      if (clearSearchBtn) {
        if (val) {
          clearSearchBtn.classList.remove('hidden');
        } else {
          clearSearchBtn.classList.add('hidden');
        }
      }
      render(val);
    });
  }

  // Clear search button handler
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearSearchBtn.classList.add('hidden');
      render('');
    });
  }

  // Clear all button handler with modal confirmation
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (getHistoryList().length === 0) {
        toast('暂无历史记录可清空');
        return;
      }

      const modalEl = document.createElement('div');
      modalEl.className = 'text-left space-y-3 font-sans max-w-sm';
      modalEl.innerHTML = `
        <div class="flex items-center gap-2 text-slate-800 font-semibold text-sm">
          <i class="bi-exclamation-triangle text-amber-500 text-base"></i>
          <span>清空历史解析记录</span>
        </div>
        <p class="text-xs text-slate-600">确定要清空本地所有已解析的历史直链吗？此操作不可撤销。</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" id="btnCancelClear" class="px-3 py-1.5 text-xs rounded border border-slate-200 hover:bg-slate-50 text-slate-600 transition">
            取消
          </button>
          <button type="button" id="btnConfirmClear" class="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-700 text-white font-medium transition">
            确认清空
          </button>
        </div>
      `;

      modalEl.querySelector('#btnCancelClear')?.addEventListener('click', xdialog);
      modalEl.querySelector('#btnConfirmClear')?.addEventListener('click', () => {
        clearHistory();
        xdialog();
        render();
        toast('历史记录已全部清空');
      });

      dialog(modalEl);
    });
  }

  // Table row actions event delegation
  tableBody.addEventListener('click', async e => {
    const target = e.target;
    const row = target.closest('tr');
    if (!row) return;

    const id = row.dataset.id;
    if (!id) return;

    const allItems = getHistoryList();
    const item = allItems.find(x => x.id === id);
    if (!item) return;

    // Motrix push button
    if (target.closest('.action-history-motrix')) {
      const btn = target.closest('.action-history-motrix');
      const prev = btn.innerHTML;
      btn.innerHTML = '<i class="bi-arrow-clockwise animate-spin"></i>';

      const isAlive = await checkConnection();
      if (!isAlive) {
        btn.innerHTML = prev;
        showConfigDialog();
        toast('Motrix 未连接，请确认 Motrix 是否启动或配置 RPC 地址');
        return;
      }

      const pushRes = await addDownloadTask(item.url, {
        out: item.name,
        'user-agent': item.ua || 'netdisk',
      });
      btn.innerHTML = prev;

      if (pushRes.code === 0) {
        toast('已推送到 Motrix 下载列表');
      } else {
        dialog(`推送到 Motrix 失败：${escapeHtml(pushRes.message)}`);
      }
      return;
    }

    // Direct link copy button
    if (target.closest('.action-history-copy-url')) {
      await copyToClipboard(item.url);
      toast('直链已复制！注意下载需设置 UA: netdisk');
      return;
    }

    // Reparse button
    if (target.closest('.action-history-reparse')) {
      if (!item.surl) {
        toast('该记录未关联来源分享短链，无法自动重解');
        return;
      }
      if (globalThis.box) {
        if (!globalThis.box.si) {
          globalThis.box.si = {};
        }
        globalThis.box.si.surl = item.surl;
        globalThis.box.si.pwd = item.pwd || '';
        globalThis.box.autoOpen = true;

        if (globalThis.box.router) {
          globalThis.box.router.push('home.html');
        } else {
          location.href = 'home.html';
        }
      }
      return;
    }

    // More options button
    if (target.closest('.action-history-more')) {
      showHistoryMoreModal(item);
      return;
    }

    // Single item delete button
    if (target.closest('.action-history-delete')) {
      removeHistoryItem(id);
      render(searchInput?.value || '');
      toast('已删除该条历史记录');
      return;
    }
  });
}

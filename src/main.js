/**
 * Main application entry point
 */

import {
  random,
  fixpath,
  cut,
  xbody,
  save,
  load,
  tpl,
  dialog,
  xdialog,
  toast,
  copyToClipboard,
  escapeHtml,
  escapeShellArg,
} from './utils.js';

export { escapeShellArg };
import { fetchShareInfo, fetchDirectLink } from './api.js';
import {
  getAria2Config,
  saveAria2Config,
  checkConnection,
  addDownloadTask,
  showConfigDialog,
} from './aria2.js';
import { Router } from './router.js';

// Application State
const state = {
  si: {
    surl: '',
    pwd: '',
    sign: '',
    site: typeof location !== 'undefined' ? location.hostname : '',
    uid: '',
    sid: '',
  },
  files: [],
  wait: false,
};

// Direct link session cache (avoids repeated API calls for the same file in a session)
const directLinkCache = new Map();

// Global box instance for debugging / console inspection
const box = {
  si: state.si,
  data: {},
  aria2: getAria2Config(),
  directLinkCache,
};
globalThis.box = box;

// Reactive state proxy for DOM data binding
const reactiveData = new Proxy(box.data, {
  set(target, prop, value, receiver) {
    if (typeof document !== 'undefined') {
      document.querySelectorAll(`[data-json="${prop}"]`).forEach(el => {
        el.dataset.html ??= el.innerHTML;
        el.innerHTML = tpl(el.dataset.html, value);
      });
    }
    return Reflect.set(target, prop, value, receiver);
  },
});

/**
 * Validate Baidu Netdisk share URL
 */
function isValidBaiduUrl(url = '') {
  return url.includes('pan.baidu.com/s/');
}

/**
 * Extract surl and pwd from text
 */
export function parseBaiduShareText(text = '') {
  const clean = text.replaceAll(/[^\x20-\x7E\u4e00-\u9fa5]/g, ' ');
  let surl = '';
  let pwd = '';

  // Match URL: pan.baidu.com/s/1[a-zA-Z0-9_-]+ or pan.baidu.com/s/[a-zA-Z0-9_-]+
  const urlMatch = clean.match(/(?:https?:\/\/)?pan\.baidu\.com\/s\/([a-zA-Z0-9_-]+)/i);
  if (urlMatch) {
    surl = urlMatch[1];
    if (surl.startsWith('1')) {
      surl = surl.slice(1);
    }
  }

  // Check pwd in query param ?pwd=xxxx
  const pwdParamMatch = clean.match(/[?&]pwd=([a-zA-Z0-9]{4})/i);
  if (pwdParamMatch) {
    pwd = pwdParamMatch[1];
  } else {
    // Check pwd in text like 提取码: abcd / 密码: abcd
    const pwdTextMatch = clean.match(/(?:提取码|密码|pwd)[:：\s]*([a-zA-Z0-9]{4})/i);
    if (pwdTextMatch) {
      pwd = pwdTextMatch[1];
    }
  }

  return { surl, pwd };
}

/**
 * Fetch or get cached direct download link
 */
async function resolveDirectLink(fid) {
  if (directLinkCache.has(fid)) {
    return { ok: true, ...directLinkCache.get(fid) };
  }

  const sign = load('sign', null) || random();
  save('sign', sign);
  state.si.sign = sign;
  state.si.site = location.hostname;
  state.si.fid = fid;

  const res = await fetchDirectLink(state.si);
  if (res.code !== 0 || !res.data?.url?.[0]) {
    return { ok: false, message: res.message || '直链获取失败' };
  }

  const { url: urls, info } = res.data;
  info.out = fixpath(info.out || '');
  const result = {
    url: urls[0],
    urls,
    info,
  };
  directLinkCache.set(fid, result);
  return { ok: true, ...result };
}

/**
 * Trigger native browser direct download
 */
function triggerBrowserDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('已启动浏览器下载');
}

/**
 * Show comprehensive download options modal
 */
async function showDownloadOptionsModal(fid, fileName, fileSize) {
  dialog(`
    <div class="center flex-col py-6">
      <div class="loader"></div>
      <p class="text-sm text-slate-500 mt-4">正在解析文件直链...</p>
    </div>
  `);

  const resolved = await resolveDirectLink(fid);
  if (!resolved.ok) {
    dialog(`
      <div class="text-center py-4">
        <div class="text-red-500 text-3xl mb-2"><i class="bi-exclamation-triangle"></i></div>
        <h3 class="text-base font-semibold text-slate-800 mb-2">解析失败</h3>
        <p class="text-sm text-slate-600 mb-4">${escapeHtml(resolved.message)}</p>
        <button type="button" class="px-4 py-1.5 bg-slate-800 text-white text-sm rounded-lg" onclick="document.getElementById('liveDialog').close()">关闭</button>
      </div>
    `);
    return;
  }

  const { url, info } = resolved;
  const outName = info.out || fileName || '未命名文件';
  const ua = info['user-agent'] || 'netdisk';
  const safeOutName = escapeHtml(outName);
  const safeFileSize = escapeHtml(fileSize || '--');
  const safeUa = escapeHtml(ua);
  const safeUrl = escapeHtml(url);
  const curlCmd = `curl -L -A ${escapeShellArg(ua)} -o ${escapeShellArg(outName)} ${escapeShellArg(url)}`;

  const modalEl = document.createElement('div');
  modalEl.className = 'download-modal space-y-4';
  modalEl.innerHTML = `
    <div class="border-b border-slate-200 pb-3">
      <h3 class="text-base font-bold text-slate-800 truncate" title="${safeOutName}">
        <i class="bi-file-earmark-arrow-down mr-1.5 text-blue-600"></i>${safeOutName}
      </h3>
      <div class="flex items-center gap-3 text-xs text-slate-500 mt-1">
        <span>大小: ${safeFileSize} MB</span>
        <span>User-Agent: ${safeUa}</span>
      </div>
    </div>

    <div class="space-y-1.5">
      <label class="text-xs font-semibold text-slate-700">直链下载地址</label>
      <div class="relative">
        <input type="text" readonly value="${safeUrl}" class="w-full text-xs font-mono bg-slate-50 border border-slate-200 rounded px-2.5 py-2 text-slate-700 select-all pr-16" id="directUrlInput">
        <button type="button" class="absolute right-1 top-1 bottom-1 px-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs rounded transition flex items-center gap-1" id="copyUrlBtn">
          <i class="bi-clipboard"></i> 复制
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2 pt-2">
      <button type="button" class="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg shadow-sm transition" id="btnBrowserDl">
        <i class="bi-cloud-download text-sm"></i> 浏览器直接下载
      </button>
      <button type="button" class="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg shadow-sm transition" id="btnMotrixPush">
        <i class="bi-rocket-takeoff text-sm"></i> 推送到 Motrix / Aria2
      </button>
      <button type="button" class="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition" id="btnCopyCurl">
        <i class="bi-terminal text-sm"></i> 复制 cURL 命令
      </button>
      <button type="button" class="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition" id="btnConfigAria2">
        <i class="bi-gear text-sm"></i> 配置 Aria2 RPC
      </button>
    </div>

    <div class="text-right pt-2 border-t border-slate-100">
      <button type="button" class="px-4 py-1.5 text-xs text-slate-500 hover:text-slate-700" id="btnCloseModal">关闭</button>
    </div>
  `;

  modalEl.querySelector('#copyUrlBtn').addEventListener('click', async () => {
    const ok = await copyToClipboard(url);
    toast(ok ? '直链已复制到剪贴板' : '复制失败，请手动长按复制');
  });

  modalEl.querySelector('#btnBrowserDl').addEventListener('click', () => {
    triggerBrowserDownload(url, outName);
  });

  modalEl.querySelector('#btnMotrixPush').addEventListener('click', async () => {
    const isAlive = await checkConnection();
    if (!isAlive) {
      toast('Motrix 未启动或 RPC 无法连接，正在打开配置');
      showConfigDialog();
      return;
    }
    const pushRes = await addDownloadTask(url, info);
    if (pushRes.code === 0) {
      toast('已成功推送到 Motrix 下载队列！');
      xdialog();
    } else {
      toast(`推送失败: ${pushRes.message}`);
    }
  });

  modalEl.querySelector('#btnCopyCurl').addEventListener('click', async () => {
    const ok = await copyToClipboard(curlCmd);
    toast(ok ? 'cURL 下载命令已复制' : '复制失败');
  });

  modalEl.querySelector('#btnConfigAria2').addEventListener('click', () => {
    showConfigDialog();
  });

  modalEl.querySelector('#btnCloseModal').addEventListener('click', xdialog);

  dialog(modalEl);
}

/**
 * Initialize Home Page Interactions
 */
function initHomePage() {
  const urlInput = document.querySelector('input[name="url"]');
  const pwdInput = document.querySelector('input[name="pwd"]');
  const openBtn = document.querySelector('button[name="dupan"]');
  const filesContainer = document.querySelector('tbody[data-json="files"]');

  if (!urlInput || !openBtn) return;

  // Clear unrendered template placeholder row from home.html
  reactiveData.files = [];

  // Select all on focus
  urlInput.addEventListener('focus', e => e.target.select());

  // Smart paste handler: parses shared links with extract codes
  urlInput.addEventListener('paste', e => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.includes('pan.baidu.com')) return;

    e.preventDefault();
    const { surl, pwd } = parseBaiduShareText(text);

    if (surl) {
      urlInput.value = `https://pan.baidu.com/s/1${surl}`;
      state.si.surl = surl;
    }
    if (pwd) {
      pwdInput.value = pwd;
      state.si.pwd = pwd;
    }
    urlInput.blur();
  });

  // Right-click "打开" button to configure Motrix / Aria2 RPC
  openBtn.addEventListener('contextmenu', e => {
    e.preventDefault();
    showConfigDialog();
  });

  // Search button click handler
  openBtn.addEventListener('click', async e => {
    e.preventDefault();
    if (state.wait) {
      toast('正在解析中，请稍候...');
      return;
    }

    const rawUrl = urlInput.value.trim();
    if (!isValidBaiduUrl(rawUrl)) {
      dialog('请输入有效的百度网盘分享链接 (https://pan.baidu.com/s/...)');
      return;
    }

    const { surl, pwd } = parseBaiduShareText(rawUrl);
    const formPwd = pwdInput.value.trim();

    state.si.surl = surl || cut(rawUrl, '/s/1', '?') || cut(rawUrl, '/s/', '?');
    state.si.pwd = formPwd || pwd;
    state.si.site = location.hostname;

    let sign = load('sign', null);
    if (!sign) {
      sign = random();
      save('sign', sign);
    }
    state.si.sign = sign;

    // Loading indicator on button
    const originalBtnHtml = openBtn.innerHTML;
    openBtn.innerHTML = '<i class="bi-arrow-clockwise animate-spin mr-1"></i> 解析中';
    state.wait = true;

    try {
      const res = await fetchShareInfo(state.si);
      if (res.code !== 0) {
        dialog(`解析失败：\n${res.message || '未知错误'}`);
        return;
      }

      if (res.share) {
        Object.assign(state.si, res.share);
      }

      const list = res.list || [];
      if (list.length === 0) {
        dialog('该分享链接中没有检测到可解析的根目录文件。\n提示：子目录中的文件会被直接忽略，请将文件直接放在分享根目录。');
      }

      reactiveData.files = list;
    } finally {
      openBtn.innerHTML = originalBtnHtml;
      state.wait = false;
    }
  });

  // Table row actions delegator
  if (filesContainer) {
    filesContainer.addEventListener('click', async e => {
      const target = e.target;
      const row = target.closest('tr');
      if (!row) return;

      const fid = target.dataset.fid || row.dataset.fid || row.querySelector('[data-fid]')?.dataset.fid;
      if (!fid) return;

      const fileName = row.dataset.name || row.querySelector('td.name-col')?.textContent?.trim() || '';
      const fileSize = row.dataset.size || row.querySelector('td.size-col')?.textContent?.trim() || '';

      // Direct download button clicked
      if (target.closest('.action-browser')) {
        e.stopPropagation();
        const btn = target.closest('.action-browser');
        const prev = btn.innerHTML;
        btn.innerHTML = '<i class="bi-arrow-clockwise animate-spin"></i>';
        const res = await resolveDirectLink(fid);
        btn.innerHTML = prev;
        if (res.ok) {
          triggerBrowserDownload(res.url, res.info.out || fileName);
        } else {
          dialog(`获取直链失败：${res.message}`);
        }
        return;
      }

      // Motrix push button clicked
      if (target.closest('.action-motrix')) {
        e.stopPropagation();
        const btn = target.closest('.action-motrix');
        const prev = btn.innerHTML;
        btn.innerHTML = '<i class="bi-arrow-clockwise animate-spin"></i>';

        const isAlive = await checkConnection();
        if (!isAlive) {
          btn.innerHTML = prev;
          showConfigDialog();
          toast('Motrix 未连接，请确认 Motrix 是否启动或配置 RPC 地址');
          return;
        }

        const res = await resolveDirectLink(fid);
        btn.innerHTML = prev;
        if (!res.ok) {
          dialog(`获取直链失败：${res.message}`);
          return;
        }

        const pushRes = await addDownloadTask(res.url, res.info);
        if (pushRes.code === 0) {
          toast('已推送到 Motrix 下载列表');
        } else {
          dialog(`推送到 Motrix 失败：${pushRes.message}`);
        }
        return;
      }

      // Action more or click row/file name opens options modal
      showDownloadOptionsModal(fid, fileName, fileSize);
    });
  }
}

// Router initialization
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  new Router({
    basePath: document.body?.dataset?.site || '',
    pages: {
      home: initHomePage,
    },
  });
}

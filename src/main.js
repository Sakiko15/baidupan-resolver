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
  buildIdmCommand,
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
        el.innerHTML = Array.isArray(value) && value.length === 0 ? '' : tpl(el.dataset.html, value);
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
export function triggerBrowserDownload(url, filename) {
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
 * Prompt confirmation before browser direct download to prevent unexpected 31362 errors
 */
export function confirmBrowserDownload({ url, outName, info, onBack }) {
  const safeOutName = escapeHtml(outName || '未命名文件');
  const ua = info?.['user-agent'] || 'netdisk';
  const safeUa = escapeHtml(ua);

  const confirmEl = document.createElement('div');
  confirmEl.className = 'confirm-download-modal space-y-4';
  confirmEl.innerHTML = `
    <div class="border-b border-slate-200 pb-3">
      <h3 class="text-base font-bold text-slate-800 flex items-center gap-2">
        <i class="bi-shield-exclamation text-amber-500 text-lg"></i>
        <span>浏览器直接下载提示 (防 31362 错误)</span>
      </h3>
      <p class="text-xs text-slate-500 mt-1 truncate" title="${safeOutName}">目标文件：${safeOutName}</p>
    </div>

    <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-2">
      <div class="font-semibold text-amber-900 flex items-center gap-1.5">
        <i class="bi-exclamation-triangle-fill text-amber-600"></i>
        <span>为什么直接下载会报错 sign error (31362)？</span>
      </div>
      <p class="text-amber-700 leading-relaxed">
        百度网盘要求下载请求头必须为 <code>User-Agent: ${safeUa}</code>。普通浏览器点击下载无法修改该请求头（默认为浏览器标识），将返回 <b>{"error_code":31362,"error_msg":"sign error"}</b> 并导致下载失败。
      </p>
      <p class="text-amber-700 font-medium">
        推荐方案：直接使用 Motrix 推送下载，无需任何插件且支持多线程高速断点续传。
      </p>
    </div>

    <div class="space-y-2 pt-1">
      <button type="button" class="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition" id="confirmBtnMotrix">
        <i class="bi-rocket-takeoff text-sm"></i> 改用 Motrix 推送 (推荐·无报错)
      </button>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition" id="confirmBtnCopyUaAndDl" title="复制 UA: ${safeUa} 到剪贴板并打开链接">
          <i class="bi-clipboard-check text-blue-600"></i> 复制 UA 并打开
        </button>
        <button type="button" class="flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition" id="confirmBtnDirectDl" title="直接在浏览器新标签页打开下载链接">
          <i class="bi-box-arrow-up-right text-slate-500"></i> 仍尝试直接打开
        </button>
      </div>
    </div>

    <div class="text-right pt-2 border-t border-slate-100">
      <button type="button" class="px-4 py-1.5 text-xs text-slate-500 hover:text-slate-700" id="confirmBtnBack">
        ${onBack ? '返回下载选项' : '关闭'}
      </button>
    </div>
  `;

  confirmEl.querySelector('#confirmBtnMotrix').addEventListener('click', async () => {
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

  confirmEl.querySelector('#confirmBtnCopyUaAndDl').addEventListener('click', async () => {
    await copyToClipboard(ua);
    toast(`已复制 User-Agent: ${ua}`);
    triggerBrowserDownload(url, outName);
  });

  confirmEl.querySelector('#confirmBtnDirectDl').addEventListener('click', () => {
    triggerBrowserDownload(url, outName);
  });

  confirmEl.querySelector('#confirmBtnBack').addEventListener('click', () => {
    if (onBack) {
      onBack();
    } else {
      xdialog();
    }
  });

  dialog(confirmEl);
}

/**
 * Show comprehensive download options modal
 */
export function showDownloadOptionsModal(fid, fileName, fileSize) {
  dialog(`
    <div class="center flex-col py-6">
      <div class="loader"></div>
      <p class="text-sm text-slate-500 mt-4">正在解析文件直链...</p>
    </div>
  `);

  resolveDirectLink(fid).then(resolved => {
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
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100">
          <span>大小: <b class="text-slate-700 font-mono">${safeFileSize} MB</b></span>
          <div class="flex items-center gap-1.5">
            <span>User-Agent:</span>
            <code class="px-1.5 py-0.5 bg-slate-100 text-indigo-700 rounded font-mono font-medium">${safeUa}</code>
            <button type="button" class="px-1.5 py-0.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition flex items-center gap-0.5" id="copyUaBtn" title="复制 User-Agent">
              <i class="bi-clipboard"></i> 复制 UA
            </button>
          </div>
        </div>
      </div>

      <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
        <i class="bi-exclamation-triangle-fill text-amber-600 shrink-0 mt-0.5"></i>
        <div class="space-y-1">
          <p class="font-semibold text-amber-900">为什么直接下载会报错 sign error (31362)？</p>
          <p class="text-amber-700 leading-relaxed">
            百度直链服务端强制校验 <code>User-Agent: netdisk</code>。普通浏览器点击下载无法修改该请求头，会导致签名校验失败。推荐优先使用 Motrix 一键推送；或配合 IDM / 浏览器 UA 插件进行下载。
          </p>
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

      <div class="space-y-2 pt-1">
        <button type="button" class="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-semibold rounded-lg shadow-sm transition" id="btnMotrixPush">
          <i class="bi-rocket-takeoff text-base"></i>
          <span>推送到 Motrix / Aria2 (推荐·自动携带 UA)</span>
        </button>

        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition" id="btnBrowserDl" title="需注意 UA 校验限制">
            <i class="bi-cloud-download text-sm text-blue-600"></i> 浏览器直接下载
          </button>
          <button type="button" class="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition" id="btnCopyIdm">
            <i class="bi-download text-sm text-emerald-600"></i> 复制 IDM 参数
          </button>
          <button type="button" class="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition" id="btnCopyCurl">
            <i class="bi-terminal text-sm text-purple-600"></i> 复制 cURL 命令
          </button>
          <button type="button" class="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg transition" id="btnConfigAria2">
            <i class="bi-gear text-sm text-slate-600"></i> 配置 Aria2 RPC
          </button>
        </div>
      </div>

      <div class="text-right pt-2 border-t border-slate-100">
        <button type="button" class="px-4 py-1.5 text-xs text-slate-500 hover:text-slate-700" id="btnCloseModal">关闭</button>
      </div>
    `;

    modalEl.querySelector('#copyUaBtn').addEventListener('click', async () => {
      const ok = await copyToClipboard(ua);
      toast(ok ? `User-Agent (${ua}) 已复制` : '复制失败');
    });

    modalEl.querySelector('#copyUrlBtn').addEventListener('click', async () => {
      const ok = await copyToClipboard(url);
      toast(ok ? '直链已复制到剪贴板' : '复制失败，请手动长按复制');
    });

    modalEl.querySelector('#btnBrowserDl').addEventListener('click', () => {
      confirmBrowserDownload({
        url,
        outName,
        info,
        onBack: () => showDownloadOptionsModal(fid, fileName, fileSize),
      });
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

    modalEl.querySelector('#btnCopyIdm').addEventListener('click', async () => {
      const idmCmd = buildIdmCommand(url, outName);
      const ok = await copyToClipboard(idmCmd);
      toast(ok ? 'IDM 命令行参数已复制 (请确保 IDM 的 UA 设置为 netdisk)' : '复制失败');
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
  }).catch(err => {
    dialog(`
      <div class="text-center py-4">
        <div class="text-red-500 text-3xl mb-2"><i class="bi-exclamation-triangle"></i></div>
        <h3 class="text-base font-semibold text-slate-800 mb-2">解析失败</h3>
        <p class="text-sm text-slate-600 mb-4">${escapeHtml(err?.message || '直链解析异常')}</p>
        <button type="button" class="px-4 py-1.5 bg-slate-800 text-white text-sm rounded-lg" onclick="document.getElementById('liveDialog').close()">关闭</button>
      </div>
    `);
  });
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

      // Direct download button clicked (prompts warning to prevent 31362 sign error)
      if (target.closest('.action-browser')) {
        e.stopPropagation();
        const btn = target.closest('.action-browser');
        const prev = btn.innerHTML;
        btn.innerHTML = '<i class="bi-arrow-clockwise animate-spin"></i>';
        const res = await resolveDirectLink(fid);
        btn.innerHTML = prev;
        if (res.ok) {
          confirmBrowserDownload({
            url: res.url,
            outName: res.info.out || fileName,
            info: res.info,
            onBack: () => showDownloadOptionsModal(fid, fileName, fileSize),
          });
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

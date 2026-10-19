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
import {
  getHistoryList,
  addHistoryItem,
  clearHistory,
  removeHistoryItem,
  initHistoryPage,
} from './history.js';

// Application State
export const state = {
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
  autoOpen: false,
};

// Direct link session cache (avoids repeated API calls for the same file in a session)
export const DIRECT_LINK_TTL = 3600 * 1000 * 2; // 2 hours in ms
export const directLinkCache = new Map();

// Global box instance for debugging / console inspection
const box = {
  si: state.si,
  data: {},
  aria2: getAria2Config(),
  directLinkCache,
  getSign: () => getSignCredential(),
  resetSign: () => resetSignCredential(),
  history: {
    get: getHistoryList,
    clear: clearHistory,
    remove: removeHistoryItem,
  },
  state,
};
globalThis.box = box;

/**
 * Get current sign credential
 */
export function getSignCredential() {
  return load('sign', '') || '';
}

/**
 * Reset sign credential:
 * 1. Generates a new 32-hex character sign
 * 2. Persists to localStorage.sign
 * 3. Updates state.si.sign and clears bound session uid/sid
 * 4. Clears directLinkCache
 * @returns {string} The newly generated 32-hex sign
 */
export function resetSignCredential() {
  const newSign = random(16);
  save('sign', newSign);
  state.si.sign = newSign;
  state.si.uid = '';
  state.si.sid = '';
  directLinkCache.clear();
  return newSign;
}

/**
 * Display categorized API error modal with actionable remedies
 * @param {string} rawMsg - Raw error message from backend
 * @param {string} [title] - Fallback title
 * @param {Function} [onResetSuccess] - Callback executed when sign is reset via dialog
 */
export function showSmartErrorDialog(rawMsg = '', title = '请求失败', onResetSuccess) {
  if (typeof document === 'undefined') return;

  const msg = String(rawMsg || '');
  const isBindingConflict =
    msg.includes('sign 与 uid') ||
    msg.includes('存在绑定') ||
    (msg.includes('绑定') && (msg.includes('不匹配') || msg.includes('冲突')));
  const isQuotaLimit =
    msg.includes('配额') ||
    msg.includes('每小时') ||
    msg.includes('5个') ||
    msg.includes('频繁') ||
    ((msg.includes('超过') || msg.includes('达到') || msg.includes('已达')) && (msg.includes('上限') || msg.includes('限制') || msg.includes('配额'))) ||
    (msg.includes('解析') && (msg.includes('次数') || msg.includes('限制')));

  if (isBindingConflict) {
    dialog(`
      <div class="space-y-3.5 py-1 text-left">
        <div class="flex items-center gap-2 text-amber-600">
          <i class="bi-exclamation-octagon-fill text-2xl"></i>
          <h3 class="text-base font-bold text-slate-800">解析凭证与网盘账号绑定冲突</h3>
        </div>
        <div class="text-xs text-slate-600 leading-relaxed bg-amber-50/80 border border-amber-200/80 rounded-lg p-3 space-y-1.5">
          <p class="font-medium text-amber-900">服务端报错：${escapeHtml(msg)}</p>
          <p>当前客户端的 <code>Sign</code> 凭证已与此前解析过的网盘账号（UID）在服务端绑定（有效期 1 小时）。检测到您当前分享链接来自不同的网盘账号，因此被服务端拦截。</p>
        </div>
        <div class="text-xs text-slate-600 space-y-1">
          <p class="font-medium text-slate-700">解决对策：</p>
          <p>点击下方按钮<b>立即重置客户端凭证</b>，重新生成随机 Sign 并解除旧 UID 绑定，即可正常解析新分享链接。</p>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" class="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg" onclick="document.getElementById('liveDialog').close()">取消</button>
          <button type="button" id="btnDialogResetSign" class="px-3.5 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg shadow-xs flex items-center gap-1 cursor-pointer">
            <i class="bi-arrow-repeat"></i> 重置凭证并重试
          </button>
        </div>
      </div>
    `);
    const btn = document.getElementById('btnDialogResetSign');
    if (btn) {
      btn.onclick = () => {
        const newSign = resetSignCredential();
        xdialog();
        toast(`凭证已重置 (Sign: ${newSign.slice(0, 8)}...)`);
        if (typeof onResetSuccess === 'function') onResetSuccess();
      };
    }
    return;
  }

  if (isQuotaLimit) {
    dialog(`
      <div class="space-y-3.5 py-1 text-left">
        <div class="flex items-center gap-2 text-red-600">
          <i class="bi-shield-exclamation text-2xl"></i>
          <h3 class="text-base font-bold text-slate-800">每小时解析配额已达上限</h3>
        </div>
        <div class="text-xs text-slate-600 leading-relaxed bg-red-50/80 border border-red-200/80 rounded-lg p-3 space-y-1.5">
          <p class="font-medium text-red-900">服务端反馈：${escapeHtml(msg)}</p>
          <p>第三方解析服务为保护其百度网盘 SVIP 账号免遭官方风控，限制<b>单个网盘账号（UID）每小时约解析 5 个文件</b>。</p>
          <p class="text-red-700"><b>特别说明：</b>使用代理 IP（如 SOCKS5）无法突破限制，因为服务端的配额基于网盘文件的创建者 <code>UID</code> 计数，而非客户端 IP。</p>
        </div>
        <div class="text-xs text-slate-600 space-y-1.5">
          <p class="font-medium text-slate-700">推荐突破对策：</p>
          <ul class="list-disc list-inside space-y-1 pl-1 text-slate-600">
            <li><b>多账号轮换法（推荐）</b>：将待下载的后续文件转存至<b>另一个百度网盘账号（小号）</b>并创建新分享。转存完成后，点击下方「重置解析凭证」即可立刻继续解析！</li>
            <li><b>稍后重试</b>：等待约 1 小时后服务端将自动刷新解绑当前网盘账号。</li>
          </ul>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" class="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg" onclick="document.getElementById('liveDialog').close()">我知道了</button>
          <button type="button" id="btnDialogResetSign" class="px-3.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-xs flex items-center gap-1 cursor-pointer">
            <i class="bi-arrow-repeat"></i> 重置凭证（切换小号）
          </button>
        </div>
      </div>
    `);
    const btn = document.getElementById('btnDialogResetSign');
    if (btn) {
      btn.onclick = () => {
        const newSign = resetSignCredential();
        xdialog();
        toast(`凭证已重置 (Sign: ${newSign.slice(0, 8)}...)，请粘贴小号分享链接`);
        if (typeof onResetSuccess === 'function') onResetSuccess();
      };
    }
    return;
  }

  const isInvalidShare =
    msg.toLowerCase() === 'invalid' ||
    msg.toLowerCase().includes('invalid') ||
    msg.includes('失效') ||
    msg.includes('不存在') ||
    msg.includes('分享不存在');

  if (isInvalidShare) {
    dialog(`
      <div class="space-y-3.5 py-1 text-left">
        <div class="flex items-center gap-2 text-amber-600">
          <i class="bi-exclamation-triangle-fill text-2xl"></i>
          <h3 class="text-base font-bold text-slate-800">分享链接解析失败 (服务端反馈: ${escapeHtml(msg)})</h3>
        </div>
        <div class="text-xs text-slate-600 leading-relaxed bg-amber-50/80 border border-amber-200/80 rounded-lg p-3 space-y-1.5">
          <p class="font-semibold text-amber-900 flex items-center gap-1.5">
            <i class="bi-info-circle-fill text-amber-600"></i>
            <span>诊断提示：当前并非每小时 5 个文件的频次配额限制</span>
          </p>
          <p>服务端返回 <code>${escapeHtml(msg)}</code> 说明第三方解析接口向百度网盘开放接口查询分享元数据时校验失败（无效分享），<b>无需更换小号或重置 Sign 凭证</b>。请按以下核心要点排查：</p>
        </div>
        <div class="text-xs text-slate-600 space-y-2">
          <p class="font-medium text-slate-800">核心排查与解决步骤：</p>
          <ol class="list-decimal list-inside space-y-1.5 pl-0.5 text-slate-600">
            <li>
              <b class="text-slate-800">必须先转存再分享（最常见原因）</b>：第三方解析服务<b>无法直接解析他人分享的原链接</b>。请务必先将文件“保存至自己网盘”，在自己网盘中创建新的公开或带密分享链接后再粘贴解析。
            </li>
            <li>
              <b class="text-slate-800">检查 4 位提取码</b>：确认提取码是否填写正确，确认是否有多余字符或前后空格。
            </li>
            <li>
              <b class="text-slate-800">必须为根目录纯文件</b>：接口仅遍历分享链接根目录下的文件；若分享的是<b>文件夹</b>，子目录内的文件将被直接忽略或导致解析异常。
            </li>
            <li>
              <b class="text-slate-800">原分享已被百度官方屏蔽或失效</b>：建议在浏览器无痕窗口中打开分享链接，确认是否提示“分享文件已取消”或“页面不存在”。
            </li>
          </ol>
        </div>
        <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" class="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition" onclick="document.getElementById('liveDialog').close()">我知道了</button>
          <button type="button" id="btnDialogClearInput" class="px-3.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg shadow-xs flex items-center gap-1 cursor-pointer transition">
            <i class="bi-eraser"></i> 清空重填
          </button>
        </div>
      </div>
    `);
    const clearBtn = document.getElementById('btnDialogClearInput');
    if (clearBtn) {
      clearBtn.onclick = () => {
        xdialog();
        const urlInput = document.querySelector('input[name="url"]');
        const pwdInput = document.querySelector('input[name="pwd"]');
        if (urlInput) {
          urlInput.value = '';
          urlInput.focus();
        }
        if (pwdInput) {
          pwdInput.value = '';
        }
        state.si.surl = '';
        state.si.pwd = '';
        if (typeof onResetSuccess === 'function') {
          onResetSuccess();
        }
      };
    }
    return;
  }

  // General error dialog
  dialog(`
    <div class="text-center py-3">
      <div class="text-red-500 text-2xl mb-2"><i class="bi-exclamation-triangle"></i></div>
      <h3 class="text-base font-semibold text-slate-800 mb-1.5">${escapeHtml(title)}</h3>
      <p class="text-xs text-slate-600 mb-4 whitespace-pre-wrap break-words">${escapeHtml(msg || '未知异常，请检查网络或稍后重试')}</p>
      <button type="button" class="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded-lg transition cursor-pointer" onclick="document.getElementById('liveDialog').close()">关闭</button>
    </div>
  `);
}

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
export function isValidBaiduUrl(url = '') {
  return url.includes('pan.baidu.com/s/') || url.includes('pan.baidu.com/share/init');
}

/**
 * Extract surl and pwd from text
 */
export function parseBaiduShareText(text = '') {
  const clean = text.replaceAll(/[^\x20-\x7E\u4e00-\u9fa5]/g, ' ');
  let surl = '';
  let pwd = '';

  // 1. Match mobile/init URL: pan.baidu.com/share/init?...surl=xxxx
  const initMatch = clean.match(/(?:https?:\/\/)?pan\.baidu\.com\/share\/init[^\s]*[?&]surl=([a-zA-Z0-9_.-]+)/i);
  if (initMatch) {
    surl = initMatch[1];
  } else {
    // 2. Match standard URL: pan.baidu.com/s/1xxxx or pan.baidu.com/s/xxxx
    const urlMatch = clean.match(/(?:https?:\/\/)?pan\.baidu\.com\/s\/([a-zA-Z0-9_.-]+)/i);
    if (urlMatch) {
      surl = urlMatch[1];
    }
  }

  if (surl) {
    // Strip trailing punctuation or brackets that might adhere to the share code
    surl = surl.replace(/[.,;:!?，。！？)\]>》）/]+$/, '');
    if (surl.startsWith('1')) {
      surl = surl.slice(1);
    }
    surl = surl.replace(/[.,;:!?，。！？)\]>》）/]+$/, '');
  }

  // Check pwd in query param ?pwd=xxxx or &pwd=xxxx
  const pwdParamMatch = clean.match(/[?&]pwd=([a-zA-Z0-9]{4})/i);
  if (pwdParamMatch) {
    pwd = pwdParamMatch[1];
  } else {
    // Check pwd in text like 提取码: abcd / 密码: abcd / 访问码: abcd / pwd: abcd
    const pwdTextMatch = clean.match(/(?:提取码|密码|访问码|pwd|code)[:：\s【\(\[]*([a-zA-Z0-9]{4})/i);
    if (pwdTextMatch) {
      pwd = pwdTextMatch[1];
    }
  }

  if (pwd) {
    pwd = pwd.trim().replace(/^[:：\s]+|[:：\s]+$/g, '');
    if (pwd.length > 4) {
      pwd = pwd.slice(0, 4);
    }
  }

  return { surl, pwd };
}

/**
 * Update history count badge on navigation link
 */
export function updateHistoryBadge() {
  if (typeof document === 'undefined') return;
  const badge = document.getElementById('historyCountBadge');
  if (!badge) return;
  const count = getHistoryList().length;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/**
 * Fetch or get cached direct download link
 */
export async function resolveDirectLink(fid) {
  const cached = directLinkCache.get(fid);
  if (cached && Date.now() - (cached.createdAt || 0) < DIRECT_LINK_TTL) {
    return { ok: true, ...cached };
  }

  const sign = load('sign', null) || random();
  save('sign', sign);
  const site = typeof location !== 'undefined' ? location.hostname : '';
  state.si.sign = sign;
  state.si.site = site;

  const params = {
    ...state.si,
    fid: String(fid),
    site,
    sign,
  };

  const res = await fetchDirectLink(params);
  if (res.code !== 0 || !res.data?.url?.[0]) {
    return { ok: false, message: res.message || '直链获取失败' };
  }

  const { url: urls, info } = res.data;
  info.out = fixpath(info.out || '');
  const result = {
    url: urls[0],
    urls,
    info,
    createdAt: Date.now(),
  };
  directLinkCache.set(fid, result);

  // Auto persist to history
  try {
    const fileMeta = (state.files || box.data.files || []).find(f => String(f.fid) === String(fid));
    addHistoryItem({
      fid,
      name: info.out || fileMeta?.name || '未知文件',
      size: fileMeta?.size || '',
      url: urls[0],
      ua: info['user-agent'] || 'netdisk',
      surl: state.si.surl || '',
      pwd: state.si.pwd || '',
    });
    updateHistoryBadge();
  } catch (err) {
    console.warn('Failed to save to history:', err);
  }

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
      showSmartErrorDialog(resolved.message, '获取直链失败');
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
    showSmartErrorDialog(err?.message || '直链解析异常', '解析失败');
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

  // Update history count badge on navigation link
  updateHistoryBadge();

  // Restore form values and parsed files when navigating back from history page
  if (state.si.surl && urlInput) {
    urlInput.value = `https://pan.baidu.com/s/1${state.si.surl}`;
  }
  if (state.si.pwd && pwdInput) {
    pwdInput.value = state.si.pwd;
  }
  const isAutoOpen = Boolean(state.autoOpen || box.autoOpen);
  if (!isAutoOpen && Array.isArray(state.files) && state.files.length > 0) {
    reactiveData.files = state.files;
  } else {
    state.files = [];
    // Clear unrendered template placeholder row from home.html
    reactiveData.files = [];
  }
  // Reset Sign button handler
  const resetSignBtn = document.getElementById('btnResetSign');
  if (resetSignBtn) {
    resetSignBtn.addEventListener('click', () => {
      const newSign = resetSignCredential();
      toast(`已重置解析凭证 (Sign: ${newSign.slice(0, 8)}...)`);
    });
  }

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
      dialog('请输入有效的百度网盘分享链接 (https://pan.baidu.com/s/... 或 pan.baidu.com/share/init?surl=...)');
      return;
    }

    const { surl, pwd } = parseBaiduShareText(rawUrl);
    const formPwd = pwdInput.value.trim();

    state.si.surl = surl || cut(rawUrl, '/s/1', '?') || cut(rawUrl, '/s/', '?') || cut(rawUrl, 'surl=', '&') || cut(rawUrl, 'surl=', ' ');
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
        showSmartErrorDialog(res.message, '解析分享链接失败', () => {
          urlInput.focus();
        });
        return;
      }

      if (res.share) {
        Object.assign(state.si, res.share);
      }

      const list = res.list || [];
      if (list.length === 0) {
        dialog('该分享链接中没有检测到可解析的根目录文件。\n提示：子目录中的文件会被直接忽略，请将文件直接放在分享根目录。');
      }

      state.files = list;
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
          showSmartErrorDialog(res.message, '获取直链失败');
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
          showSmartErrorDialog(res.message, '获取直链失败');
          return;
        }

        const pushRes = await addDownloadTask(res.url, res.info);
        if (pushRes.code === 0) {
          toast('已推送到 Motrix 下载列表');
        } else {
          dialog(`推送到 Motrix 失败：${escapeHtml(pushRes.message)}`);
        }
        return;
      }

      // Action more or click row/file name opens options modal
      showDownloadOptionsModal(fid, fileName, fileSize);
    });
  }

  // Check if requested to auto open from history re-parsing
  if (state.autoOpen || box.autoOpen) {
    state.autoOpen = false;
    box.autoOpen = false;
    setTimeout(() => {
      openBtn.click();
    }, 50);
  }
}

// Router initialization
export let router = null;
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  router = new Router({
    basePath: document.body?.dataset?.site || '',
    pages: {
      home: initHomePage,
      history: initHistoryPage,
    },
  });
  box.router = router;
}

export { initHomePage, initHistoryPage };

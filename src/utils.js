/**
 * Utility functions for Baidu Netdisk Link Resolver
 */

export const now = () => Math.floor(Date.now() / 1000);
export const uid = () => Date.now().toString(36);

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeShellArg(str) {
  return "'" + String(str ?? '').replace(/'/g, "'\\''") + "'";
}
export function buildIdmCommand(url = '', filename = '') {
  const safeUrl = String(url || '').replaceAll('"', '').replaceAll(/[\r\n]/g, '');
  const safeFile = String(filename || 'download').replaceAll('"', '').replaceAll(/[\r\n]/g, '');
  return `idman /d "${safeUrl}" /f "${safeFile}"`;
}

export function random(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export function fixpath(str = '') {
  return str.replaceAll(/[:*?"<>|]/g, '').replaceAll(/\/{2,}/g, '/').replace(/[\s.]+$/, '');
}

export function cut(str, start, end) {
  if (typeof str !== 'string' || !str.length) return '';
  let startIdx = 0;
  if (typeof start === 'string') {
    const pos = str.lastIndexOf(start);
    if (pos === -1) return '';
    startIdx = pos + start.length;
  }
  let endIdx = str.length;
  if (typeof end === 'string') {
    const pos = str.indexOf(end, startIdx);
    endIdx = pos === -1 ? str.length : pos;
  }
  return startIdx >= endIdx ? '' : str.slice(startIdx, endIdx);
}

export function xbody(form) {
  const fd = new FormData(form);
  form.querySelectorAll('input[type=checkbox]').forEach(cb => {
    fd.set(cb.name, +!!cb.checked);
  });
  for (const [key, val] of [...fd.entries()]) {
    if (val === '') fd.delete(key);
  }
  return Object.fromEntries(fd);
}

export function save(key, val) {
  if (val !== undefined) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      // Ignore quota exceeded or private browsing errors
    }
  }
}

export function load(key, defaultVal) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : defaultVal;
  } catch {
    return defaultVal;
  }
}

export function tpl(template, data, escape = true) {
  if (typeof template !== 'string' || !template.length) return '';
  const items = Array.isArray(data) ? data : [data];
  const chunks = [];
  let lastIndex = 0;
  const matches = Array.from(template.matchAll(/\[([a-zA-Z0-9_-]{2,20})\]/g));
  for (const match of matches) {
    chunks.push(template.slice(lastIndex, match.index), { key: match[1], raw: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (template.length > lastIndex) {
    chunks.push(template.slice(lastIndex));
  }
  return items.map(item =>
    chunks.map(chunk => {
      if (typeof chunk === 'string') return chunk;
      if (item && typeof item === 'object' && Object.hasOwn(item, chunk.key)) {
        const val = item[chunk.key];
        return escape ? escapeHtml(val) : (val ?? '');
      }
      return chunk.raw;
    }).join('')
  ).join('');
}

export function dialog(content) {
  let dlg = document.getElementById('liveDialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'liveDialog';
    dlg.addEventListener('click', e => {
      if (e.target !== e.currentTarget) return;
      const { top, right, bottom, left } = e.currentTarget.getBoundingClientRect();
      if (!(e.clientX > left && e.clientX < right && e.clientY > top && e.clientY < bottom)) {
        e.target.close();
      }
    });
    document.body.appendChild(dlg);
  }

  if (content instanceof HTMLElement) {
    dlg.replaceChildren(content);
  } else {
    const raw = (content ?? '').toString();
    const sanitized = raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').replace(/<script[^>]*>/gi, '');
    dlg.innerHTML = sanitized.includes('<') ? sanitized : sanitized.replaceAll('\n', '<br>');
  }

  if (!dlg.open) {
    dlg.showModal();
    requestAnimationFrame(() => {
      document.activeElement?.blur();
    });
  }
}

export function xdialog(e) {
  if (e instanceof Event) {
    e.preventDefault();
    e.stopPropagation();
  }
  const dlg = document.getElementById('liveDialog');
  if (dlg && dlg.hasAttribute('open')) {
    dlg.close();
  }
}

export function form(selector, data) {
  if (typeof selector !== 'string' || typeof data !== 'object' || !data) return;
  document.querySelectorAll(`${selector} [name]`).forEach(el => {
    const name = el.getAttribute('name');
    if (!Object.hasOwn(data, name)) return;
    const val = data[name] ?? '';
    if (el.type === 'checkbox') {
      el.checked = Number(val) === 1;
    } else if (el.type === 'radio') {
      el.checked = el.value === String(val);
    } else {
      el.value = String(val);
    }
  });
}

export function toast(message, duration = 2500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none';
    document.body.appendChild(container);
  }
  const item = document.createElement('div');
  item.className = 'bg-stone-900/90 text-stone-100 text-sm px-4 py-2 rounded-lg shadow-lg backdrop-blur border border-stone-700/50 pointer-events-auto transition-all duration-200 transform translate-y-2 opacity-0';
  item.textContent = message;
  container.appendChild(item);
  requestAnimationFrame(() => {
    item.classList.remove('translate-y-2', 'opacity-0');
  });
  setTimeout(() => {
    item.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => item.remove(), 250);
  }, duration);
}

export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Lightweight SPA Micro-Router
 */

export class Router {
  constructor({ basePath = '', pages = {}, onRender } = {}) {
    if (typeof document === 'undefined') return;
    this.mainEl = document.querySelector('main');
    if (!this.mainEl) return;

    this.pages = pages;
    this.onRender = onRender;
    this.wait = false;
    this.basePath = basePath ? `${location.origin}/${basePath}/` : '';

    const initial = this.resolvePage(location.href);
    history.replaceState(initial.name, '', initial.href);
    this.navigate(initial.name);

    window.addEventListener('popstate', e => {
      if (this.wait) return;
      this.navigate(e.state || this.resolvePage(location.href).name);
    });

    window.addEventListener('hashchange', () => {
      if (this.wait) return;
      const current = this.resolvePage(location.href);
      this.navigate(current.name);
    });

    document.body.addEventListener('click', e => {
      const target = e.target?.closest?.('[href],[data-url]');
      if (!target) return;
      if (target.hasAttribute('download') || target.hasAttribute('target') || target.classList.contains('no-route')) {
        return;
      }
      const url = target.getAttribute('href') || target.dataset.url;
      if (!url || url.startsWith('javascript:') || url === '#') return;

      // Only intercept internal links
      try {
        const dest = new URL(url, location.href);
        if (dest.origin === location.origin) {
          e.preventDefault();
          e.stopPropagation();
          this.push(url);
        }
      } catch {}
    });
  }

  resolvePage(urlStr) {
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost';
    const url = new URL(urlStr, base);
    url.name = 'home';

    // 1. Priority: check hash route (e.g. #/history, #/home, #history, #)
    let candidate = '';
    if (url.hash && url.hash.length > 1) {
      let h = url.hash.slice(1);
      if (h.startsWith('/')) h = h.slice(1);
      const qIdx = h.indexOf('?');
      if (qIdx !== -1) h = h.slice(0, qIdx);
      const dotIdx = h.indexOf('.');
      if (dotIdx !== -1) h = h.slice(0, dotIdx);
      candidate = h.trim();
    }

    // 2. Fallback: check pathname (e.g. /history.html, /about)
    if (!candidate) {
      const path = url.pathname;
      if (path && path.length) {
        const slashIdx = path.lastIndexOf('/');
        const start = slashIdx === -1 ? 0 : slashIdx + 1;
        const dotIdx = path.indexOf('.', start);
        const end = dotIdx === -1 ? path.length : dotIdx;
        if (start < end) {
          candidate = path.slice(start, end);
        }
      }
    }

    // 3. Validate candidate name
    if (candidate && /^[a-z0-9_-]{2,24}$/i.test(candidate) && candidate.toLowerCase() !== 'index') {
      url.name = candidate;
    } else {
      url.name = 'home';
    }

    // 4. Normalize URL pathname & hash
    if (candidate && url.pathname.endsWith(`/${candidate}.html`)) {
      url.pathname = url.pathname.slice(0, -(`${candidate}.html`.length));
    } else if (candidate && url.pathname.endsWith(`/${candidate}`)) {
      url.pathname = url.pathname.slice(0, -candidate.length);
    } else if (url.pathname.endsWith('/index.html')) {
      url.pathname = url.pathname.slice(0, -('index.html'.length));
    }

    if (url.name === 'home') {
      url.hash = '';
    } else {
      url.hash = `#/${url.name}`;
    }

    return url;
  }

  push(urlStr) {
    if (this.wait) return;
    const dest = this.resolvePage(urlStr);
    history.pushState(dest.name, '', dest.href);
    this.navigate(dest.name);
  }

  async navigate(pageName) {
    if (this.wait) return;
    this.wait = true;
    try {
      const url = `${this.basePath}${pageName}.html`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Failed to fetch page fragment: ${url}`);
        return;
      }
      const text = await res.text();
      // Ignore full HTML documents (e.g. 404 rewrite fallback)
      if (text.includes('</html>')) {
        return;
      }

      this.mainEl.innerHTML = text;

      if (typeof this.pages[pageName] === 'function') {
        this.pages[pageName]();
      }
      if (typeof this.onRender === 'function') {
        this.onRender(pageName);
      }
    } catch (err) {
      console.error(`Router error loading ${pageName}:`, err);
    } finally {
      this.wait = false;
    }
  }
}

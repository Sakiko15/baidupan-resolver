/**
 * Lightweight SPA Micro-Router
 */

export class Router {
  constructor({ basePath = '', pages = {}, onRender } = {}) {
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
      this.navigate(e.state || 'home');
    });

    document.body.addEventListener('click', e => {
      const target = e.target?.closest?.('[href],[data-url]');
      if (!target) return;
      if (target.hasAttribute('download') || target.hasAttribute('target') || target.classList.contains('no-route')) {
        return;
      }
      const url = target.getAttribute('href') || target.dataset.url;
      if (!url || url.startsWith('javascript:') || url.startsWith('#')) return;

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
    const url = new URL(urlStr, location.href);
    url.name = 'home';
    const path = url.pathname;
    if (path.length) {
      const slashIdx = path.lastIndexOf('/');
      const start = slashIdx === -1 ? 0 : slashIdx + 1;
      const dotIdx = path.indexOf('.', start);
      const end = dotIdx === -1 ? path.length : dotIdx;
      if (start < end) {
        url.name = path.slice(start, end);
      }
      if (!/^[a-z0-9_-]{2,24}$/i.test(url.name)) {
        url.name = 'home';
      }
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

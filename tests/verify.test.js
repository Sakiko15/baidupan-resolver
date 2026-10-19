/**
 * Automated Verification Test Suite
 * Tests unit utilities, API routing logic, Aria2 payload construction,
 * share link parser, router fallback, and infrastructure configs.
 */

import assert from 'node:assert';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { random, fixpath, cut, tpl, xbody, escapeHtml, escapeShellArg, buildIdmCommand } from '../src/utils.js';
import { parseBaiduShareText, getSignCredential, resetSignCredential, showSmartErrorDialog } from '../src/main.js';
import { buildAria2Payload } from '../src/aria2.js';
import { Router } from '../src/router.js';
import { API_BASE } from '../src/api.js';
import {
  getHistoryList,
  addHistoryItem,
  removeHistoryItem,
  clearHistory,
  formatHistoryTime,
  filterHistory,
  STORAGE_KEY,
  MAX_HISTORY,
} from '../src/history.js';

const baseDir = import.meta.dirname || process.cwd();

describe('1. Utility Functions & Security Sanitization', () => {
  test('random() generates 32-hex character sign', () => {
    const sign = random(16);
    assert.strictEqual(typeof sign, 'string');
    assert.strictEqual(sign.length, 32);
    assert.match(sign, /^[0-9a-f]{32}$/);

    const sign2 = random(16);
    assert.notStrictEqual(sign, sign2, 'Random signs should be unique');
  });

  test('fixpath() removes forbidden filesystem characters and double slashes', () => {
    const input = 'my:test*file?"name<test>|path//sub///file.mp4';
    const output = fixpath(input);
    assert.strictEqual(output, 'mytestfilename<test>path/sub/file.mp4'.replace(/<test>/g, 'test'));
    assert.doesNotMatch(output, /[:*?"<>|]/);
    assert.doesNotMatch(output, /\/{2,}/);
  });

  test('cut() slices between delimiters correctly and returns empty string if delimiter missing', () => {
    const url = 'https://pan.baidu.com/s/1abcdef123?pwd=abcd';
    const surl = cut(url, '/s/1', '?');
    assert.strictEqual(surl, 'abcdef123');

    const pwd = cut(url, 'pwd=');
    assert.strictEqual(pwd, 'abcd');

    // Missing delimiter returns empty string, avoiding accidental startIdx=0 fallback
    const missing = cut('https://pan.baidu.com/s/1abcdef123', '/s/2', '?');
    assert.strictEqual(missing, '');
  });

  test('escapeHtml() correctly escapes &, <, >, ", and \'', () => {
    assert.strictEqual(
      escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
    assert.strictEqual(escapeHtml("Tom & 'Jerry'"), 'Tom &amp; &#39;Jerry&#39;');
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
  });

  test('escapeShellArg() safely wraps arguments and neutralizes command injection payloads', () => {
    assert.strictEqual(escapeShellArg('video$(whoami).mp4'), "'video$(whoami).mp4'");
    assert.strictEqual(escapeShellArg('file`id`.mp4'), "'file`id`.mp4'");
    assert.strictEqual(escapeShellArg('file; rm -rf /;'), "'file; rm -rf /;'");
    assert.strictEqual(escapeShellArg("O'Reilly.mp4"), "'O'\\''Reilly.mp4'");
  });
  test('buildIdmCommand() constructs valid idman download command and strips quotes and newlines', () => {
    const cmd = buildIdmCommand('https://d.pcs.baidu.com/file/123" & calc.exe', 'my "cool"\r\nvideo.mp4');
    assert.strictEqual(cmd, 'idman /d "https://d.pcs.baidu.com/file/123 & calc.exe" /f "my coolvideo.mp4"');
    assert.strictEqual(buildIdmCommand(null, null), 'idman /d "" /f "download"');
    assert.strictEqual(buildIdmCommand('https://example.com/dl', ''), 'idman /d "https://example.com/dl" /f "download"');
  });

  test('tpl() correctly renders template placeholders and protects against null items and XSS', () => {
    const template = '<tr><td>[size] MB</td><td>[name]</td><td data-fid="[fid]">[fid]</td></tr>';
    const data = [
      { size: '1024', name: '<script>evil.js</script>', fid: '101' },
      null,
      undefined,
      { size: '256', name: 'doc.pdf', fid: '102' },
    ];
    const rendered = tpl(template, data);
    // Escaped XSS
    assert.ok(rendered.includes('&lt;script&gt;evil.js&lt;/script&gt;'));
    assert.ok(!rendered.includes('<script>evil.js</script>'));
    // Safe items rendered
    assert.ok(rendered.includes('1024 MB'));
    assert.ok(rendered.includes('data-fid="101"'));
    assert.ok(rendered.includes('256 MB'));
    assert.ok(rendered.includes('doc.pdf'));
    assert.ok(rendered.includes('data-fid="102"'));
  });

  test('tpl() supports escape=false when raw rendering is desired', () => {
    const template = '<div>[content]</div>';
    const rendered = tpl(template, { content: '<b>bold</b>' }, false);
    assert.strictEqual(rendered, '<div><b>bold</b></div>');
  });
});

describe('2. API Base & Relative Path Configuration', () => {
  test('API_BASE defaults to empty string for relative proxying', () => {
    // Empty string ensures fetch('/api/...') is same-origin, avoiding Mixed Content and CORS
    assert.strictEqual(API_BASE, '');
  });
});

describe('3. Baidu Netdisk Link Parsing & Extraction (Production Module)', () => {
  test('Parses plain standard link', () => {
    const res = parseBaiduShareText('https://pan.baidu.com/s/1ab_CD-12');
    assert.strictEqual(res.surl, 'ab_CD-12');
    assert.strictEqual(res.pwd, '');
  });

  test('Parses link without https:// protocol scheme', () => {
    const res = parseBaiduShareText('pan.baidu.com/s/1noProtocolCode 提取码: 5678');
    assert.strictEqual(res.surl, 'noProtocolCode');
    assert.strictEqual(res.pwd, '5678');
  });

  test('Parses link without leading 1 in surl', () => {
    const res = parseBaiduShareText('https://pan.baidu.com/s/directCode123?pwd=abcd');
    assert.strictEqual(res.surl, 'directCode123');
    assert.strictEqual(res.pwd, 'abcd');
  });

  test('Parses link with ?pwd= query parameter', () => {
    const res = parseBaiduShareText('https://pan.baidu.com/s/1ab_CD-12?pwd=8899');
    assert.strictEqual(res.surl, 'ab_CD-12');
    assert.strictEqual(res.pwd, '8899');
  });

  test('Parses pasted text with Chinese extraction code', () => {
    const pasted = '通过网盘分享的文件：视频.mp4\n链接: https://pan.baidu.com/s/1xyz890 提取码: 6688\n复制这段内容打开百度网盘手机App';
    const res = parseBaiduShareText(pasted);
    assert.strictEqual(res.surl, 'xyz890');
    assert.strictEqual(res.pwd, '6688');
  });

  test('Parses pasted text with English pwd: code', () => {
    const pasted = 'https://pan.baidu.com/s/1myShareCode pwd: a1b2';
    const res = parseBaiduShareText(pasted);
    assert.strictEqual(res.surl, 'myShareCode');
    assert.strictEqual(res.pwd, 'a1b2');
  });
});

describe('4. Aria2 / Motrix RPC Payload Generation & Secret Token Protocol', () => {
  test('Constructs valid aria2.addUri payload with secret token', () => {
    const urls = ['https://d.pcs.baidu.com/file/sample_download_url'];
    const info = { out: fixpath('Sample:Movie*2025.mp4'), 'user-agent': 'netdisk' };
    const payload = buildAria2Payload('aria2.addUri', [urls, info], 'secret_rpc_token');

    assert.strictEqual(payload.method, 'aria2.addUri');
    assert.strictEqual(payload.params.length, 3);
    assert.strictEqual(payload.params[0], 'token:secret_rpc_token');
    assert.deepStrictEqual(payload.params[1], ['https://d.pcs.baidu.com/file/sample_download_url']);
    assert.strictEqual(payload.params[2].out, 'SampleMovie2025.mp4');
    assert.strictEqual(payload.params[2]['user-agent'], 'netdisk');
  });

  test('Omits token: prefix entirely when token is empty or whitespace (Aria2 spec compliance)', () => {
    const urls = ['https://d.pcs.baidu.com/file/sample_download_url'];
    const info = { out: 'video.mp4', 'user-agent': 'netdisk' };
    const payloadNoToken = buildAria2Payload('aria2.addUri', [urls, info], '');

    assert.strictEqual(payloadNoToken.method, 'aria2.addUri');
    assert.strictEqual(payloadNoToken.params.length, 2);
    assert.deepStrictEqual(payloadNoToken.params[0], urls);
    assert.deepStrictEqual(payloadNoToken.params[1], info);

    const payloadWhitespaceToken = buildAria2Payload('aria2.addUri', [urls, info], '   ');
    assert.strictEqual(payloadWhitespaceToken.params.length, 2);
    assert.deepStrictEqual(payloadWhitespaceToken.params[0], urls);
  });
});

describe('5. cURL Download Command Generation & Shell Injection Prevention', () => {
  test('Generates single-quote wrapped cURL download command resistant to injection', () => {
    const url = 'https://d.pcs.baidu.com/file/sample.mp4?sign=abc';
    const filename = 'Test; rm -rf /; `id` $(whoami).mp4';
    const ua = 'netdisk; bash -i';
    const cmd = `curl -L -A ${escapeShellArg(ua)} -o ${escapeShellArg(filename)} ${escapeShellArg(url)}`;

    assert.strictEqual(
      cmd,
      "curl -L -A 'netdisk; bash -i' -o 'Test; rm -rf /; `id` $(whoami).mp4' 'https://d.pcs.baidu.com/file/sample.mp4?sign=abc'"
    );
  });
});

describe('6. SPA Micro-Router Navigation & Fallback', () => {
  const router = new Router();

  test('resolvePage() falls back to "home" when visiting index.html to prevent infinite spinner', () => {
    assert.strictEqual(router.resolvePage('http://localhost:5173/index.html').name, 'home');
    assert.strictEqual(router.resolvePage('http://localhost:5173/index').name, 'home');
    assert.strictEqual(router.resolvePage('http://localhost:5173/').name, 'home');
    assert.strictEqual(router.resolvePage('http://localhost:5173').name, 'home');
  });

  test('resolvePage() resolves valid subpage names correctly', () => {
    assert.strictEqual(router.resolvePage('http://localhost:5173/settings.html').name, 'settings');
    assert.strictEqual(router.resolvePage('http://localhost:5173/about').name, 'about');
  });

  test('resolvePage() rejects invalid/malicious page names and falls back to "home"', () => {
    assert.strictEqual(router.resolvePage('http://localhost:5173/..%2F..%2Fetc%2Fpasswd').name, 'home');
    assert.strictEqual(router.resolvePage('http://localhost:5173/x').name, 'home'); // min length 2
  });
});

describe('7. Nginx Configuration Rules Verification', () => {
  const confPath = path.resolve(baseDir, '../nginx/default.conf');
  const conf = fs.readFileSync(confPath, 'utf-8');

  test('Contains upstream reverse proxy with HTTP 1.1 keep-alive and IP forwarding for /api/ to mxd.indevs.in', () => {
    assert.ok(conf.includes('location /api/'));
    assert.ok(conf.includes('proxy_pass http://mxd.indevs.in/api/;'));
    assert.ok(conf.includes('proxy_http_version 1.1;'));
    assert.ok(conf.includes('proxy_set_header Connection "";'));
    assert.ok(conf.includes('proxy_set_header Host mxd.indevs.in;'));
    assert.ok(conf.includes('proxy_set_header X-Real-IP $remote_addr;'));
  });

  test('Contains essential security headers globally and in scoped locations to avoid inheritance suppression', () => {
    assert.ok(conf.includes('add_header X-Content-Type-Options "nosniff" always;'));
    assert.ok(conf.includes('add_header X-Frame-Options "SAMEORIGIN" always;'));

    // Verify location ~* \.html$ has explicit security headers
    const htmlLocation = conf.match(/location\s+~\*\s+\\\.html\$\s*\{([^}]+)\}/)?.[1] || '';
    assert.ok(htmlLocation.includes('add_header X-Content-Type-Options "nosniff" always;'));
    assert.ok(htmlLocation.includes('add_header X-Frame-Options "SAMEORIGIN" always;'));

    // Verify location /assets/ has explicit security headers
    const assetsLocation = conf.match(/location\s+\/assets\/\s*\{([^}]+)\}/)?.[1] || '';
    assert.ok(assetsLocation.includes('add_header X-Content-Type-Options "nosniff" always;'));
    assert.ok(assetsLocation.includes('add_header X-Frame-Options "SAMEORIGIN" always;'));
  });

  test('Configures Gzip compression', () => {
    assert.ok(conf.includes('gzip on;'));
    assert.ok(conf.includes('application/javascript'));
  });

  test('Configures no-cache for HTML files and 1-year cache for assets', () => {
    assert.ok(conf.includes('location ~* \\.html$'));
    assert.ok(conf.includes('no-cache, must-revalidate'));
    assert.ok(conf.includes('location /assets/'));
    assert.ok(conf.includes('expires 1y;'));
  });

  test('Does NOT contain global try_files fallback that breaks micro-router', () => {
    // Should NOT have try_files $uri $uri/ /index.html;
    assert.doesNotMatch(conf, /try_files\s+[^;]+\/index\.html;/);
  });
});

describe('8. Docker & Infrastructure Configuration Verification', () => {
  const dockerfilePath = path.resolve(baseDir, '../Dockerfile');
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8');

  test('Dockerfile has multi-stage build with --platform=$BUILDPLATFORM optimization (node builder -> nginx runner)', () => {
    assert.ok(dockerfile.includes('FROM --platform=$BUILDPLATFORM node:20-alpine AS builder'));
    assert.ok(dockerfile.includes('AS builder'));
    assert.ok(dockerfile.includes('FROM nginx:alpine'));
    assert.ok(dockerfile.includes('COPY --from=builder /app/dist /usr/share/nginx/html'));
    assert.ok(dockerfile.includes('COPY nginx/default.conf /etc/nginx/conf.d/default.conf'));
  });

  test('Dockerfile installs tzdata package in Alpine runner for timezone support', () => {
    assert.ok(dockerfile.includes('apk add --no-cache tzdata'));
  });

  const composePath = path.resolve(baseDir, '../docker-compose.yml');
  const compose = fs.readFileSync(composePath, 'utf-8');

  test('docker-compose.yml defines web service, port 8080:80, and does not contain deprecated version key', () => {
    assert.ok(compose.includes('services:'));
    assert.ok(compose.includes('8080:80'));
    assert.ok(compose.includes('TZ=Asia/Shanghai'));
    assert.doesNotMatch(compose, /^version:/m);
  });

  const dockerignorePath = path.resolve(baseDir, '../.dockerignore');
  const dockerignore = fs.readFileSync(dockerignorePath, 'utf-8');

  test('.dockerignore does not contain internal tool protocol local://*', () => {
    assert.doesNotMatch(dockerignore, /local:\/\//);
  });
});

describe('9. Build & Project Configuration Verification', () => {
  const viteConfigPath = path.resolve(baseDir, '../vite.config.js');
  const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8');

  test('vite.config.js uses fileURLToPath for robust cross-platform path resolution', () => {
    assert.ok(viteConfig.includes("import { fileURLToPath } from 'node:url';"));
    assert.ok(viteConfig.includes("fileURLToPath(new URL('.', import.meta.url))"));
  });

  const readmePath = path.resolve(baseDir, '../README.md');
  const readme = fs.readFileSync(readmePath, 'utf-8');

  test('README.md deployment methods have unique sequential numbering (A, B, C, D)', () => {
    assert.ok(readme.includes('### 方式 A：1Panel 容器编排一键部署'));
    assert.ok(readme.includes('### 方式 B：本地 Docker Compose 部署'));
    assert.ok(readme.includes('### 方式 C：单独构建 Docker 镜像'));
    assert.ok(readme.includes('### 方式 D：传统 Nginx 宿主机部署'));
    const matches = readme.match(/### 方式 B：/g);
    assert.strictEqual(matches?.length, 1, 'Should not have duplicate "方式 B"');
  });
});

describe('10. Baidu 31362 Sign Error Remediation, Direct Download Protection & UX Enhancement', () => {
  const mainJsPath = path.resolve(baseDir, '../src/main.js');
  const mainJs = fs.readFileSync(mainJsPath, 'utf-8');

  test('src/main.js contains 31362 sign error explanation, UA copy and IDM parameters logic', () => {
    assert.ok(mainJs.includes('31362'), 'src/main.js should explicitly mention error code 31362');
    assert.ok(mainJs.includes('sign error'), 'src/main.js should explain sign error');
    assert.ok(mainJs.includes('copyUaBtn'), 'src/main.js should have User-Agent copy button handler');
    assert.ok(mainJs.includes('btnCopyIdm'), 'src/main.js should have IDM command copy button handler');
    assert.ok(mainJs.includes('confirmBrowserDownload'), 'src/main.js should provide confirmBrowserDownload');
  });

  test('src/main.js intercepts direct download clicks with confirmBrowserDownload dialog', () => {
    assert.ok(
      mainJs.includes("target.closest('.action-browser')") && mainJs.includes('confirmBrowserDownload'),
      'Action browser click must trigger confirmBrowserDownload rather than unconditional download'
    );
  });

  const homeHtmlPath = path.resolve(baseDir, '../home.html');
  const homeHtml = fs.readFileSync(homeHtmlPath, 'utf-8');

  test('home.html displays 31362 error warning in notice and places Motrix push as first recommendation', () => {
    assert.ok(homeHtml.includes('sign error (31362)'), 'home.html should warn about 31362 error in notice');
    assert.ok(homeHtml.includes('User-Agent: netdisk'), 'home.html should specify netdisk UA requirement');
    const motrixIdx = homeHtml.indexOf('action-motrix');
    const browserIdx = homeHtml.indexOf('action-browser');
    assert.ok(motrixIdx > 0 && browserIdx > 0, 'Both action buttons should exist in template');
    assert.ok(motrixIdx < browserIdx, 'action-motrix should be placed before action-browser as primary recommendation');
  });

  const readmePath = path.resolve(baseDir, '../README.md');
  const readme = fs.readFileSync(readmePath, 'utf-8');

  test('README.md contains FAQ chapter explaining 31362 sign error and 4 download schemes', () => {
    assert.ok(readme.includes('常见问题与下载指南 (FAQ)'));
    assert.ok(readme.includes('31362'));
    assert.ok(readme.includes('sign error'));
    assert.ok(readme.includes('方案一（强烈推荐）：Motrix'));
    assert.ok(readme.includes('方案二：IDM'));
    assert.ok(readme.includes('方案三：浏览器安装 User-Agent 切换插件'));
    assert.ok(readme.includes('方案四：终端 cURL 命令行导出'));
  });

  const readDocPath = path.resolve(baseDir, '../read.md');
  const readDoc = fs.readFileSync(readDocPath, 'utf-8');

  test('read.md API spec includes 31362 sign error in error handling section', () => {
    assert.ok(readDoc.includes('31362'));
    assert.ok(readDoc.includes('sign error'));
    assert.ok(readDoc.includes('User-Agent'));
  });
});

describe('11. Baidu Quota Limit Analysis, Sign Credential Management & Multi-Account Rotation', () => {
  test('resetSignCredential() generates 32-hex sign, updates global state, and clears uid/sid/cache', () => {
    // Mock localStorage
    const storage = new Map();
    const origLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
      clear: () => storage.clear(),
    };

    try {
      // Populate state with existing session data and cache
      globalThis.box.si.uid = 'mock_uid_12345';
      globalThis.box.si.sid = 'mock_sid_67890';
      globalThis.box.directLinkCache.set('mock_fid_1', { url: 'https://pcs.baidu.com/file' });

      const initialSign = resetSignCredential();
      assert.strictEqual(typeof initialSign, 'string');
      assert.strictEqual(initialSign.length, 32);
      assert.match(initialSign, /^[0-9a-f]{32}$/);
      assert.strictEqual(globalThis.box.si.sign, initialSign);
      assert.strictEqual(globalThis.box.si.uid, '', 'Session uid must be cleared on reset');
      assert.strictEqual(globalThis.box.si.sid, '', 'Session sid must be cleared on reset');
      assert.strictEqual(globalThis.box.directLinkCache.size, 0, 'Link cache must be cleared on reset');

      // Check getSignCredential()
      assert.strictEqual(getSignCredential(), initialSign);

      // Second reset produces a distinct new sign
      const secondSign = resetSignCredential();
      assert.notStrictEqual(initialSign, secondSign);
      assert.strictEqual(globalThis.box.si.sign, secondSign);
      assert.strictEqual(getSignCredential(), secondSign);
    } finally {
      if (origLocalStorage !== undefined) {
        globalThis.localStorage = origLocalStorage;
      } else {
        delete globalThis.localStorage;
      }
    }
  });

  test('home.html contains #btnResetSign button and displays UID restriction and alt-account guidance', () => {
    const homeHtml = fs.readFileSync(path.resolve(baseDir, '../home.html'), 'utf-8');
    assert.ok(homeHtml.includes('id="btnResetSign"'), 'home.html should contain #btnResetSign button');
    assert.ok(homeHtml.includes('重置解析凭证'), 'home.html should have reset sign text');
    assert.ok(homeHtml.includes('网盘 UID 限制'), 'home.html should explain UID limitation');
    assert.ok(homeHtml.includes('代理 IP 无法绕过'), 'home.html should explicitly mention proxy IP inability to bypass');
  });

  test('src/aria2.js includes #btnConfigResetSign, #configSignPreview, and properly scoped cancel button', () => {
    const aria2Js = fs.readFileSync(path.resolve(baseDir, '../src/aria2.js'), 'utf-8');
    assert.ok(aria2Js.includes('btnConfigResetSign'), 'src/aria2.js should include reset button in config modal');
    assert.ok(aria2Js.includes('configSignPreview'), 'src/aria2.js should include sign preview');
    assert.ok(aria2Js.includes(".group button[type=button]"), 'Cancel button in .group should be specifically targeted');
  });
  test('src/main.js implements showSmartErrorDialog for quota limit and binding conflict handling', () => {
    assert.strictEqual(typeof showSmartErrorDialog, 'function');
    const mainJs = fs.readFileSync(path.resolve(baseDir, '../src/main.js'), 'utf-8');
    assert.ok(mainJs.includes('showSmartErrorDialog'), 'src/main.js should define showSmartErrorDialog');
    assert.ok(mainJs.includes('解析凭证与网盘账号绑定冲突'), 'src/main.js should detect binding conflict');
    assert.ok(mainJs.includes('每小时解析配额已达上限'), 'src/main.js should detect quota limit');
    assert.ok(mainJs.includes('多账号轮换法'), 'src/main.js should recommend multi-account rotation in modal');
  });

  test('read.md documents 4.2 section with quota mechanism, SOCKS5 proxy inefficacy, and multi-account rotation', () => {
    const readDoc = fs.readFileSync(path.resolve(baseDir, '../read.md'), 'utf-8');
    assert.ok(readDoc.includes('4.2 每小时 5 个文件配额与凭证绑定限制说明'));
    assert.ok(readDoc.includes('核心统计维度为网盘 `uid`'));
    assert.ok(readDoc.includes('为什么增加 SOCKS5 / 代理 IP 无法绕过'));
    assert.ok(readDoc.includes('多账号轮换法'));
    assert.ok(readDoc.includes('自建直链解析后端'));
  });

  test('README.md FAQ details SOCKS5 inefficacy, multi-account rotation guide, and self-hosted backend architecture', () => {
    const readme = fs.readFileSync(path.resolve(baseDir, '../README.md'), 'utf-8');
    assert.ok(readme.includes('服务端每小时约 5 个文件配额限制能通过 SOCKS5 / HTTP 代理绕过吗'));
    assert.ok(readme.includes('为什么配置 SOCKS5 / 代理 IP 池无法绕过限制'));
    assert.ok(readme.includes('核心瓶颈在 `uid` 而非 `IP`'));
    assert.ok(readme.includes('多账号轮换法 (Multi-Account Rotation)'));
    assert.ok(readme.includes('自建直链解析后端 (Self-Hosted Resolver)'));
  });
});

describe('12. History Management & Parsing Persistence', () => {
  function withMockStorage(fn) {
    const storage = new Map();
    const orig = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k),
      clear: () => storage.clear(),
      _storage: storage,
    };
    try {
      fn(storage);
    } finally {
      if (orig !== undefined) {
        globalThis.localStorage = orig;
      } else {
        delete globalThis.localStorage;
      }
    }
  }

  test('addHistoryItem() writes record idempotently, validates required fields, and updates existing item to top', () => {
    withMockStorage(() => {
      // Missing name or url returns current list without adding
      const emptyRes = addHistoryItem({ fid: '123' });
      assert.strictEqual(emptyRes.length, 0);

      // Add first item
      const list1 = addHistoryItem({
        fid: 'fid_101',
        name: 'test_file_1.zip',
        size: '128.5',
        url: 'https://pcs.baidu.com/file1?sign=abc',
        ua: 'netdisk',
        surl: 'share101',
        pwd: 'abcd',
      });
      assert.strictEqual(list1.length, 1);
      assert.strictEqual(list1[0].fid, 'fid_101');
      assert.strictEqual(list1[0].name, 'test_file_1.zip');
      assert.strictEqual(list1[0].size, '128.5');
      assert.strictEqual(list1[0].url, 'https://pcs.baidu.com/file1?sign=abc');
      assert.strictEqual(list1[0].ua, 'netdisk');
      assert.strictEqual(list1[0].surl, 'share101');
      assert.strictEqual(list1[0].pwd, 'abcd');
      assert.strictEqual(typeof list1[0].id, 'string');
      assert.strictEqual(typeof list1[0].time, 'number');

      // Add second item
      const list2 = addHistoryItem({
        fid: 'fid_102',
        name: 'test_file_2.mp4',
        size: '500.0',
        url: 'https://pcs.baidu.com/file2?sign=def',
        ua: 'netdisk',
        surl: 'share102',
        pwd: '1234',
      });
      assert.strictEqual(list2.length, 2);
      assert.strictEqual(list2[0].fid, 'fid_102');
      assert.strictEqual(list2[1].fid, 'fid_101');

      // Re-add first item with updated url (idempotent update & move to front)
      const list3 = addHistoryItem({
        fid: 'fid_101',
        name: 'test_file_1.zip',
        size: '128.5',
        url: 'https://pcs.baidu.com/file1?sign=refreshed_sign',
        ua: 'netdisk',
        surl: 'share101',
        pwd: 'abcd',
      });
      assert.strictEqual(list3.length, 2, 'Should not duplicate existing file record');
      assert.strictEqual(list3[0].fid, 'fid_101', 'Updated record should move to front');
      assert.strictEqual(list3[0].url, 'https://pcs.baidu.com/file1?sign=refreshed_sign');
      assert.strictEqual(list3[1].fid, 'fid_102');
    });
  });

  test('addHistoryItem() truncates exceeding records to MAX_HISTORY (100) via FIFO', () => {
    withMockStorage(() => {
      assert.strictEqual(MAX_HISTORY, 100);
      for (let i = 1; i <= 105; i++) {
        addHistoryItem({
          fid: `fid_${i}`,
          name: `file_${i}.dat`,
          size: '1.0',
          url: `https://pcs.baidu.com/file_${i}`,
          surl: `share_${i}`,
        });
      }
      const list = getHistoryList();
      assert.strictEqual(list.length, 100, 'History list must be capped at MAX_HISTORY=100');
      // Most recent should be at index 0 (fid_105), oldest kept should be fid_6 (fid_1 to fid_5 pruned)
      assert.strictEqual(list[0].fid, 'fid_105');
      assert.strictEqual(list[99].fid, 'fid_6');
      assert.strictEqual(list.some(x => x.fid === 'fid_1'), false, 'Oldest item fid_1 should have been pruned');
    });
  });

  test('getHistoryList() gracefully handles corrupted JSON and non-array storage values', () => {
    withMockStorage(storage => {
      // Empty storage returns empty array
      assert.deepStrictEqual(getHistoryList(), []);

      // Corrupted JSON returns empty array
      storage.set(STORAGE_KEY, '{invalid json');
      assert.deepStrictEqual(getHistoryList(), []);

      // Non-array JSON (e.g. object or number) returns empty array
      storage.set(STORAGE_KEY, JSON.stringify({ name: 'not an array' }));
      assert.deepStrictEqual(getHistoryList(), []);
    });
  });

  test('removeHistoryItem() removes single record by id and clearHistory() empties all records', () => {
    withMockStorage(() => {
      addHistoryItem({ fid: '1', name: 'f1.txt', url: 'https://pcs/1' });
      addHistoryItem({ fid: '2', name: 'f2.txt', url: 'https://pcs/2' });
      addHistoryItem({ fid: '3', name: 'f3.txt', url: 'https://pcs/3' });

      const list = getHistoryList();
      assert.strictEqual(list.length, 3);
      const targetId = list[1].id;

      const afterRemove = removeHistoryItem(targetId);
      assert.strictEqual(afterRemove.length, 2);
      assert.strictEqual(afterRemove.some(x => x.id === targetId), false);
      assert.strictEqual(getHistoryList().length, 2);

      const afterClear = clearHistory();
      assert.deepStrictEqual(afterClear, []);
      assert.deepStrictEqual(getHistoryList(), []);
    });
  });

  test('formatHistoryTime() and filterHistory() format and search correctly', () => {
    const formatted = formatHistoryTime(1700000000000);
    assert.match(formatted, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.strictEqual(formatHistoryTime(null), '');
    assert.strictEqual(formatHistoryTime('invalid-date'), '');

    const sample = [
      { id: '1', name: 'Document.pdf', surl: 'doc123' },
      { id: '2', name: 'Tutorial_Video.mp4', surl: 'video456' },
      { id: '3', name: 'archive.tar.gz', surl: 'arch789' },
    ];
    // Filter by name
    assert.strictEqual(filterHistory('doc', sample).length, 1);
    assert.strictEqual(filterHistory('video', sample).length, 1);
    // Filter by surl
    assert.strictEqual(filterHistory('arch789', sample).length, 1);
    // Case-insensitive
    assert.strictEqual(filterHistory('TUTORIAL', sample).length, 1);
    // Empty keyword returns all
    assert.strictEqual(filterHistory('', sample).length, 3);
  });

  test('vite.config.js includes history.html entry configuration', () => {
    const viteConfig = fs.readFileSync(path.resolve(baseDir, '../vite.config.js'), 'utf-8');
    assert.ok(viteConfig.includes('history:'), 'vite.config.js should define history entry');
    assert.ok(viteConfig.includes('history.html'), 'vite.config.js should point to history.html');
  });

  test('home.html and history.html contain required navigation, templates, and buttons', () => {
    const homeHtml = fs.readFileSync(path.resolve(baseDir, '../home.html'), 'utf-8');
    assert.ok(homeHtml.includes('id="btnNavHistory"'), 'home.html should contain #btnNavHistory');
    assert.ok(homeHtml.includes('id="historyCountBadge"'), 'home.html should contain #historyCountBadge');
    assert.ok(homeHtml.includes('href="history.html"'), 'home.html should link to history.html');

    const historyHtml = fs.readFileSync(path.resolve(baseDir, '../history.html'), 'utf-8');
    assert.ok(historyHtml.includes('id="btnBackHome"'), 'history.html should contain #btnBackHome');
    assert.ok(historyHtml.includes('id="historyTotalCount"'), 'history.html should contain #historyTotalCount');
    assert.ok(historyHtml.includes('id="btnClearAllHistory"'), 'history.html should contain #btnClearAllHistory');
    assert.ok(historyHtml.includes('id="historySearchInput"'), 'history.html should contain #historySearchInput');
    assert.ok(historyHtml.includes('id="historyTableContainer"'), 'history.html should contain #historyTableContainer');
    assert.ok(historyHtml.includes('id="historyTableBody"'), 'history.html should contain #historyTableBody');
    assert.ok(historyHtml.includes('id="historyEmptyState"'), 'history.html should contain #historyEmptyState');
  });

  test('src/main.js integrates history persistence in resolveDirectLink and registers history page in Router', () => {
    const mainJs = fs.readFileSync(path.resolve(baseDir, '../src/main.js'), 'utf-8');
    assert.ok(mainJs.includes('addHistoryItem'), 'src/main.js should import and call addHistoryItem');
    assert.ok(mainJs.includes('updateHistoryBadge'), 'src/main.js should define updateHistoryBadge');
    assert.ok(mainJs.includes('initHistoryPage'), 'src/main.js should import and register initHistoryPage');
    assert.ok(mainJs.includes('history: initHistoryPage'), 'src/main.js should register history page in Router');
    assert.ok(mainJs.includes('history: {'), 'src/main.js should expose history operations on box');
  });
});

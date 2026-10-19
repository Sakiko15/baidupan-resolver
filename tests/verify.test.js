/**
 * Automated Verification Test Suite
 * Tests unit utilities, API routing logic, Aria2 payload construction,
 * share link parser, router fallback, and infrastructure configs.
 */

import assert from 'node:assert';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { random, fixpath, cut, tpl, xbody, escapeHtml, escapeShellArg } from '../src/utils.js';
import { parseBaiduShareText } from '../src/main.js';
import { buildAria2Payload } from '../src/aria2.js';
import { Router } from '../src/router.js';
import { API_BASE } from '../src/api.js';

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

  test('Contains upstream reverse proxy with HTTP 1.1 keep-alive for /api/ to mxd.indevs.in', () => {
    assert.ok(conf.includes('location /api/'));
    assert.ok(conf.includes('proxy_pass http://mxd.indevs.in/api/;'));
    assert.ok(conf.includes('proxy_http_version 1.1;'));
    assert.ok(conf.includes('proxy_set_header Connection "";'));
    assert.ok(conf.includes('proxy_set_header Host mxd.indevs.in;'));
  });

  test('Contains essential security headers (X-Content-Type-Options, X-Frame-Options)', () => {
    assert.ok(conf.includes('add_header X-Content-Type-Options "nosniff" always;'));
    assert.ok(conf.includes('add_header X-Frame-Options "SAMEORIGIN" always;'));
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

  test('Dockerfile has multi-stage build (node builder -> nginx runner)', () => {
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

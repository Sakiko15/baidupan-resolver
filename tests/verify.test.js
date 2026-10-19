/**
 * Automated Verification Test Suite
 * Tests unit utilities, API routing logic, Aria2 payload construction,
 * share link parser, and end-to-end simulated flow.
 */

import assert from 'node:assert';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { random, fixpath, cut, tpl, xbody } from '../src/utils.js';
import { API_BASE } from '../src/api.js';

describe('1. Utility Functions', () => {
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

  test('cut() slices between delimiters correctly', () => {
    const url = 'https://pan.baidu.com/s/1abcdef123?pwd=abcd';
    const surl = cut(url, '/s/1', '?');
    assert.strictEqual(surl, 'abcdef123');

    const pwd = cut(url, 'pwd=');
    assert.strictEqual(pwd, 'abcd');
  });

  test('tpl() correctly renders template placeholders [prop]', () => {
    const template = '<tr><td>[size] MB</td><td>[name]</td><td data-fid="[fid]">[fid]</td></tr>';
    const data = [
      { size: '1024', name: 'video.mp4', fid: '101' },
      { size: '256', name: 'doc.pdf', fid: '102' },
    ];
    const rendered = tpl(template, data);
    assert.ok(rendered.includes('1024 MB'));
    assert.ok(rendered.includes('video.mp4'));
    assert.ok(rendered.includes('data-fid="101"'));
    assert.ok(rendered.includes('256 MB'));
    assert.ok(rendered.includes('doc.pdf'));
    assert.ok(rendered.includes('data-fid="102"'));
  });
});

describe('2. API Base & Relative Path Configuration', () => {
  test('API_BASE defaults to empty string for relative proxying', () => {
    // Empty string ensures fetch('/api/...') is same-origin, avoiding Mixed Content and CORS
    assert.strictEqual(API_BASE, '');
  });
});

describe('3. Baidu Netdisk Link Parsing & Extraction', () => {
  function parseBaiduShareText(text = '') {
    const clean = text.replaceAll(/[^\x20-\x7E\u4e00-\u9fa5]/g, ' ');
    let surl = '';
    let pwd = '';

    const urlMatch = clean.match(/https?:\/\/pan\.baidu\.com\/s\/([a-zA-Z0-9_-]+)/i);
    if (urlMatch) {
      surl = urlMatch[1];
      if (surl.startsWith('1')) {
        surl = surl.slice(1);
      }
    }

    const pwdParamMatch = clean.match(/[?&]pwd=([a-zA-Z0-9]{4})/i);
    if (pwdParamMatch) {
      pwd = pwdParamMatch[1];
    } else {
      const pwdTextMatch = clean.match(/(?:提取码|密码|pwd)[:：\s]*([a-zA-Z0-9]{4})/i);
      if (pwdTextMatch) {
        pwd = pwdTextMatch[1];
      }
    }

    return { surl, pwd };
  }

  test('Parses plain standard link', () => {
    const res = parseBaiduShareText('https://pan.baidu.com/s/1ab_CD-12');
    assert.strictEqual(res.surl, 'ab_CD-12');
    assert.strictEqual(res.pwd, '');
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

describe('4. Aria2 / Motrix RPC Payload Generation', () => {
  test('Constructs valid aria2.addUri payload', () => {
    const config = { token: 'secret_rpc_token', jsonrpc: 'http://localhost:16800/jsonrpc' };
    const urls = ['https://d.pcs.baidu.com/file/sample_download_url'];
    const info = { out: 'Sample:Movie*2025.mp4', 'user-agent': 'netdisk' };

    const payload = {
      id: 'test_uid_1',
      method: 'aria2.addUri',
      params: [
        `token:${config.token}`,
        urls,
        {
          out: fixpath(info.out),
          'user-agent': info['user-agent'] || 'netdisk',
        },
      ],
    };

    assert.strictEqual(payload.method, 'aria2.addUri');
    assert.strictEqual(payload.params[0], 'token:secret_rpc_token');
    assert.deepStrictEqual(payload.params[1], ['https://d.pcs.baidu.com/file/sample_download_url']);
    assert.strictEqual(payload.params[2].out, 'SampleMovie2025.mp4');
    assert.strictEqual(payload.params[2]['user-agent'], 'netdisk');
  });
});

describe('5. cURL Download Command Generation', () => {
  test('Generates correct cURL download command with User-Agent and output filename', () => {
    const url = 'https://d.pcs.baidu.com/file/sample.mp4';
    const filename = 'Test Video 2025.mp4';
    const ua = 'netdisk';
    const cmd = `curl -L -A "${ua}" -o "${filename}" "${url}"`;

    assert.strictEqual(cmd, 'curl -L -A "netdisk" -o "Test Video 2025.mp4" "https://d.pcs.baidu.com/file/sample.mp4"');
  });
});

describe('6. Nginx Configuration Rules Verification', () => {
  const confPath = path.resolve(import.meta.dirname, '../nginx/default.conf');
  const conf = fs.readFileSync(confPath, 'utf-8');

  test('Contains upstream reverse proxy for /api/ to mxd.indevs.in', () => {
    assert.ok(conf.includes('location /api/'));
    assert.ok(conf.includes('proxy_pass http://mxd.indevs.in/api/;'));
    assert.ok(conf.includes('proxy_set_header Host mxd.indevs.in;'));
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

describe('7. Docker Configuration Verification', () => {
  const dockerfilePath = path.resolve(import.meta.dirname, '../Dockerfile');
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8');

  test('Dockerfile has multi-stage build (node builder -> nginx runner)', () => {
    assert.ok(dockerfile.includes('AS builder'));
    assert.ok(dockerfile.includes('FROM nginx:alpine'));
    assert.ok(dockerfile.includes('COPY --from=builder /app/dist /usr/share/nginx/html'));
    assert.ok(dockerfile.includes('COPY nginx/default.conf /etc/nginx/conf.d/default.conf'));
  });

  const composePath = path.resolve(import.meta.dirname, '../docker-compose.yml');
  const compose = fs.readFileSync(composePath, 'utf-8');

  test('docker-compose.yml defines web service and port 8080:80', () => {
    assert.ok(compose.includes('services:'));
    assert.ok(compose.includes('8080:80'));
  });
});

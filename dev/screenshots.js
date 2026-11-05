#!/usr/bin/env node
'use strict';
/**
 * テーマ別スクリーンショット撮影（目視確認用）
 * 事前に chrome-headless-shell --headless --remote-debugging-port=9222 を起動しておく。
 *
 *   APP_URL=http://127.0.0.1:8123/index.html node dev/screenshots.js
 */
const fs = require('fs');
const path = require('path');

const APP = process.env.APP_URL || 'http://127.0.0.1:8123/index.html';
const CDP = process.env.CDP || 'http://127.0.0.1:9222';
const OUT = path.join(__dirname, '..', 'artifacts');
const W = +(process.env.VIEW_W || 390);
const H = +(process.env.VIEW_H || 844);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const target = await (await fetch(`${CDP}/json/new?${encodeURIComponent(APP)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (!m.id || !pending.has(m.id)) return;
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = async name => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
    console.log('  saved artifacts/' + name);
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: APP });
  await wait(2200);
  await ev('document.getElementById("btnCloseSettings").click()');

  const geom = JSON.parse(await ev('JSON.stringify(document.getElementById("cv").getBoundingClientRect())'));
  const pad = geom.width * 0.06, cell = (geom.width - pad * 2) / 8;
  const ptXY = (vr, vc) => ({ x: geom.left + pad + vc * cell, y: geom.top + pad + vr * cell });
  const sqXY = (vr, vc) => ({ x: geom.left + pad + (vc + 0.5) * cell, y: geom.top + pad + (vr + 0.5) * cell });
  async function clickAt(p) {
    await ev(`(function(){const cv=document.getElementById('cv');
      cv.dispatchEvent(new MouseEvent('click',{clientX:${p.x},clientY:${p.y},bubbles:true}));})()`);
    await wait(130);
  }

  // 駒・取り・端の交点の石を混ぜて撮る（既定テーマ）
  await clickAt(sqXY(6, 4)); await clickAt(sqXY(4, 4)); // e4
  await clickAt(sqXY(1, 3)); await clickAt(sqXY(3, 3)); // d5
  await clickAt(sqXY(4, 4)); await clickAt(sqXY(3, 3)); // exd5（駒を取る）
  await clickAt(ptXY(0, 4));                            // 上端の交点に黒石
  await clickAt(sqXY(7, 5)); await clickAt(sqXY(4, 2)); // Bc4
  await clickAt(ptXY(8, 4));                            // 下端の交点に黒石
  await clickAt(ptXY(4, 0));                            // 左端の交点に白石
  await clickAt(ptXY(4, 8));                            // 右端の交点に黒石
  await clickAt(ptXY(5, 5));
  await shot('hybrid-board.png');

  // ダークテーマ
  await ev(`[...document.querySelectorAll('#themeList button')].find(b=>b.textContent.includes('ダーク')).click()`);
  await wait(350);
  await shot('hybrid-dark.png');

  // 和風テーマ
  await ev(`[...document.querySelectorAll('#themeList button')].find(b=>b.textContent.includes('和風')).click()`);
  await wait(350);
  await shot('hybrid-wa.png');

  // 結果モーダル（投了）
  await ev('document.getElementById("btnResign").click()');
  await wait(150);
  await ev('document.getElementById("btnResign").click()');
  await wait(400);
  await shot('hybrid-result.png');

  ws.close();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });

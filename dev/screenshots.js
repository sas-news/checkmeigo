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

  // 囲碁: 数手だけ打って見た目を確認
  await ev('document.getElementById("tabGo").click()');
  await wait(150);
  const goClick = async (r, c) => {
    await ev(`(function(){
      const cv=document.getElementById('cv'), R=cv.getBoundingClientRect();
      const pad=R.width*0.085, cell=(R.width-pad*2)/8;
      cv.dispatchEvent(new MouseEvent('click',{clientX:R.left+pad+${c}*cell,clientY:R.top+pad+${r}*cell,bubbles:true}));
    })()`);
    await wait(120);
  };
  await goClick(4, 4); await goClick(3, 4); await goClick(4, 3); await goClick(2, 4); await goClick(4, 5);
  await shot('go-mobile.png');

  // ダークテーマ
  await ev(`[...document.querySelectorAll('#themeList button')].find(b=>b.textContent.includes('ダーク')).click()`);
  await wait(300);
  await shot('dark-go-mobile.png');

  // チェス（同じダークテーマのまま）
  await ev('document.getElementById("tabChess").click()');
  await wait(200);
  const sqClick = async (r, c) => {
    await ev(`(function(){
      const cv=document.getElementById('cv'), R=cv.getBoundingClientRect();
      const pad=R.width*0.06, cell=(R.width-pad*2)/8;
      cv.dispatchEvent(new MouseEvent('click',{clientX:R.left+pad+${c+0.5}*cell,clientY:R.top+pad+${r+0.5}*cell,bubbles:true}));
    })()`);
    await wait(120);
  };
  await sqClick(6, 4); await sqClick(4, 4); // e4
  await sqClick(1, 3); await sqClick(3, 3); // d5
  await shot('dark-chess-mobile.png');

  // 和風テーマの囲碁
  await ev('document.getElementById("tabGo").click()');
  await wait(150);
  await ev(`[...document.querySelectorAll('#themeList button')].find(b=>b.textContent.includes('和風')).click()`);
  await wait(300);
  await shot('go-wa-mobile.png');

  ws.close();
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });

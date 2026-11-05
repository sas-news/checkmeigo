#!/usr/bin/env node
'use strict';
/**
 * チェックメイゴ E2E スモークテスト（CDP / chrome-headless-shell）
 * 事前に HTTP サーバーと chrome-headless-shell を起動しておく。
 *
 *   node dev/smoke-cdp.js
 *   APP_URL=https://sas-news.github.io/checkmeigo/ node dev/smoke-cdp.js
 */
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8123/index.html';
const CDP = process.env.CDP || 'http://127.0.0.1:9222';
const OUT_DIR = path.join(__dirname, '..', 'artifacts');

let pass = 0, fail = 0;
const failures = [];
function check(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label + (extra ? ' — ' + extra : '')); console.log('  ✗ ' + label + (extra ? ' — ' + extra : '')); }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const target = await (await fetch(`${CDP}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const issues = [];

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      issues.push('例外: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      issues.push('console.error: ' + msg.params.args.map(a => a.value || a.description).join(' '));
    }
  });

  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: APP_URL });
  await wait(1600);

  // ---- 初期表示 ----
  check((await evalJs('document.title')).includes('チェックメイゴ'), 'title に チェックメイゴ');
  check(await evalJs('!!window.__checkmeigo'), '__checkmeigo フックあり');
  check(await evalJs('document.querySelectorAll("[data-game]").length') === 0, 'ゲーム切替タブは無い（混合のみ）');
  check(await evalJs('document.getElementById("setModal").classList.contains("hidden") === false'), '初回は設定モーダル表示');
  check(await evalJs('document.getElementById("cv").getBoundingClientRect().width') > 300, 'canvas が描画サイズを持つ');
  await evalJs('document.getElementById("btnCloseSettings").click()');
  await wait(120);

  const R = JSON.parse(await evalJs('JSON.stringify(document.getElementById("cv").getBoundingClientRect())'));
  const pad = R.width * 0.06, cell = (R.width - pad * 2) / 8;
  const ptPoint = (vr, vc) => ({ x: R.left + pad + vc * cell, y: R.top + pad + vr * cell });
  const sqPoint = (vr, vc) => ({ x: R.left + pad + (vc + 0.5) * cell, y: R.top + pad + (vr + 0.5) * cell });
  async function clickAt(p) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await wait(120);
  }
  const clickIntersection = (vr, vc) => clickAt(ptPoint(vr, vc));
  const clickSquare = (vr, vc) => clickAt(sqPoint(vr, vc));
  async function clickEl(sel) {
    await evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`);
    await wait(140);
  }
  const stones = async () => JSON.parse(await evalJs('JSON.stringify(window.__checkmeigo.stones())'));

  // ---- 石を交点に置く（白番なので白石）----
  await clickIntersection(4, 4);
  let st = await stones();
  check(st[4 * 9 + 4] === 2, '交点タップで石が置ける（白石）', JSON.stringify(st.filter(Boolean)));
  check((await evalJs('window.__checkmeigo.turn()')) === 'b', '石を置くと手番が黒へ');
  check((await evalJs('document.getElementById("turnInd").textContent')).includes('黒'), '手番表示が黒');
  check((await evalJs('document.getElementById("moveLog").textContent')).includes('石'), '棋譜に石の着手');

  // ---- 1手戻る ----
  await clickEl('#btnUndo');
  await clickEl('#btnUndoOk');
  st = await stones();
  check(st.every(v => v === 0), '待ったで石が消える');
  check((await evalJs('window.__checkmeigo.turn()')) === 'w', '待ったで手番が白へ');

  // ---- 駒を動かす（e2-e4）----
  await clickSquare(6, 4);
  await clickSquare(4, 4);
  const fen = await evalJs('window.__checkmeigo.fen()');
  check(fen.split(' ')[1] === 'b', '駒を動かすと手番が黒へ', fen);
  check((await evalJs('window.__checkmeigo.log().length')) === 1, '棋譜が1手');

  // 黒 d5 → 白 exd5 で駒を取る
  await clickSquare(1, 3); await clickSquare(3, 3);
  await clickSquare(4, 4); await clickSquare(3, 3);
  check((await evalJs('window.__checkmeigo.log().length')) === 3, '取り込みで3手');

  // ---- 取った駒の表示が画像（絵文字ではない）----
  check((await evalJs('document.getElementById("dmg").innerHTML')).includes('<img'), '取った駒が画像で表示');
  check(!/[♚♛♜♝♞♟♕♖♗♘]/.test(await evalJs('document.documentElement.innerHTML')), '絵文字グリフ不使用');

  // ---- 交点とマス中央の判定が分かれている ----
  await clickIntersection(0, 0);
  st = await stones();
  check(st[0] === 1, '交点タップは黒石（マス選択と競合しない）');
  const before = (await stones()).filter(Boolean).length;
  await clickSquare(0, 0);
  const afterCount = (await stones()).filter(Boolean).length;
  check(afterCount === before, 'マス中央タップでは石は増えない');

  // ---- 実戦手順（石と駒の交互操作が壊れないか）----
  await evalJs('document.getElementById("btnNew").click()');
  await wait(200);
  const seq = [
    [6,4],[4,4], // e4
    [1,4],[3,4], // e5
    [7,5],[4,2], // Bc4
    [0,6],[2,5]  // Nc6
  ];
  for (const [r,c] of seq) await clickSquare(r, c);
  await clickIntersection(5, 2); // 黒の石を1つ
  const state = JSON.parse(await evalJs('JSON.stringify({turn:window.__checkmeigo.turn(),over:window.__checkmeigo.over(),log:window.__checkmeigo.log()})'));
  check(state.turn === 'b' && !state.over, '石を挟んでも対局が継続', JSON.stringify(state.log));
  check(state.log.some(x => x.includes('石')), '棋譜に石が混在');

  // ---- プロモーションUI（画像で選択）----
  await evalJs('document.getElementById("btnNew").click()');
  await wait(200);
  const promoSeq = [
    [6,7],[4,7], [1,0],[2,0],
    [4,7],[3,7], [2,0],[3,0],
    [3,7],[2,7], [3,0],[4,0],
    [2,7],[1,6], [4,0],[5,0],
    [1,6],[0,7]
  ];
  for (const [r,c] of promoSeq) await clickSquare(r,c);
  const promoOpen = await evalJs('document.getElementById("promoModal").classList.contains("hidden") === false');
  check(promoOpen, 'プロモーション選択モーダル表示');
  const promoImgs = await evalJs('document.querySelectorAll("#promoBtns img").length');
  check(promoImgs === 4, 'プロモーションの選択肢が画像になっている', String(promoImgs));
  await clickEl('#promoBtns button[data-promo="q"]');
  const fen3 = await evalJs('window.__checkmeigo.fen()');
  check(fen3.split(' ')[0].startsWith('rnbqkbnQ'), 'プロモーションでクイーン配置', fen3);

  // ---- タッチ操作: 石は1タップでは確定せず、同じ交点の2タップで確定 ----
  await evalJs('document.getElementById("btnNew").click()');
  await wait(200);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await evalsetMetricsTouch();
  async function tapAt(p) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(180);
  }
  async function evalsetMetricsTouch() {
    await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 2, mobile: true });
    await wait(250);
  }
  const R2 = JSON.parse(await evalJs('JSON.stringify(document.getElementById("cv").getBoundingClientRect())'));
  const pad2 = R2.width * 0.06, cell2 = (R2.width - pad2 * 2) / 8;
  const tapPt = (vr, vc) => ({ x: R2.left + pad2 + vc * cell2, y: R2.top + pad2 + vr * cell2 });
  await tapAt(tapPt(3, 3));
  let stTouch = JSON.parse(await evalJs('JSON.stringify(window.__checkmeigo.stones())'));
  check(stTouch.every(v => v === 0), 'タッチ1回目では石は置かれない（プレビュー）');
  await tapAt(tapPt(3, 3));
  stTouch = JSON.parse(await evalJs('JSON.stringify(window.__checkmeigo.stones())'));
  check(stTouch[3 * 9 + 3] === 2, '同じ交点の2タップ目で石が置かれる');
  check((await evalJs('window.__checkmeigo.turn()')) === 'b', 'タッチ着手後は手番が黒');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 2, mobile: false });
  await wait(250);

  // ---- 盤面反転 ----
  const fen2 = await evalJs('window.__checkmeigo.fen()');
  await clickEl('#btnFlip');
  check((await evalJs('window.__checkmeigo.fen()')) === fen2, '盤面反転しても局面は不変');
  await clickEl('#btnFlip');

  // ---- ルール・設定モーダル ----
  await clickEl('#btnOpenRules');
  check(await evalJs('document.getElementById("rulesModal").classList.contains("hidden") === false'), 'ルールモーダルが開く');
  check((await evalJs('document.getElementById("rulesModal").textContent')).includes('未定'), 'ルールに未定項目の記載');
  await clickEl('#btnRulesDone');
  check(await evalJs('document.getElementById("rulesModal").classList.contains("hidden")'), 'ルールモーダルが閉じる');

  // ---- テーマ切替 ----
  await clickEl('#btnOpenSettings');
  await evalJs(`[...document.querySelectorAll('#themeList button')].find(b=>b.textContent.includes('和風')).click()`);
  await wait(250);
  check((await evalJs('window.__checkmeigo.themeId()')) === 'go', '和風テーマに切替');
  await clickEl('#btnCloseSettings');

  // ---- スクリーンショット ----
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'hybrid-board.png'), Buffer.from(shot.data, 'base64'));

  // ---- リロードで局面保持 ----
  const fenBefore = await evalJs('window.__checkmeigo.fen()');
  const stonesBefore = JSON.stringify(await stones());
  await send('Page.reload', {});
  await wait(1500);
  await evalJs('document.getElementById("btnCloseSettings").click()');
  check((await evalJs('window.__checkmeigo.fen()')) === fenBefore, 'リロードで局面が保持される');
  check(JSON.stringify(await stones()) === stonesBefore, 'リロードで石が保持される');

  // ---- 投了（2タップ確認）----
  await clickEl('#btnResign');
  check((await evalJs('document.getElementById("btnResign").textContent')).includes('本当'), '投了は1タップ目で確認');
  await clickEl('#btnResign');
  await wait(300);
  check(await evalJs('window.__checkmeigo.over()'), '投了で対局終了');
  check(await evalJs('document.getElementById("resModal").classList.contains("hidden") === false'), '結果モーダル表示');
  await clickEl('#btnAgain');
  check((await evalJs('window.__checkmeigo.stones()')).every(v => v === 0), 'もう一度遊ぶでリセット');

  check(issues.length === 0, 'JS例外/console.error なし', issues.join(' | '));

  console.log(`\nE2E smoke: ${pass} passed, ${fail} failed`);
  if (fail) { failures.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
  ws.close();
}

main().catch(e => { console.error('E2E fatal:', e); process.exit(1); });

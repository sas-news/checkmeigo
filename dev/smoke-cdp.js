#!/usr/bin/env node
'use strict';
/**
 * チェックメイゴ E2E スモークテスト（CDP / chrome-headless-shell）
 * 事前に: python3 -m http.server 8123 --directory chess-go と
 *         chrome-headless-shell --remote-debugging-port=9222 ...
 *
 *   node dev/smoke-cdp.js
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
  const events = [];
  let issues = [];

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
      if (msg.method === 'Runtime.exceptionThrown') {
        issues.push('例外: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        issues.push('console.error: ' + msg.params.args.map(a => a.value || a.description).join(' '));
      }
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
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.reload', { ignoreCache: true });
  await wait(1200);

  // ---- 初期表示 ----
  check((await evalJs('document.title')).includes('チェックメイゴ'), 'title に チェックメイゴ');
  check((await evalJs('!!window.__checkmeigo')) , '__checkmeigo フックあり');
  check(await evalJs('window.__checkmeigo.game()') === 'chess', '初期表示はチェス');
  check(await evalJs('document.getElementById("setModal").classList.contains("hidden") === false'), '初回は設定モーダル表示');
  const canvasW = await evalJs('document.getElementById("cv").getBoundingClientRect().width');
  check(canvasW > 300, 'canvas が描画サイズを持つ', String(canvasW));
  check(await evalJs('document.getElementById("cv").width') > 0, 'canvas 実ピクセルあり');

  // 設定モーダルを閉じる
  await evalJs('document.getElementById("btnCloseSettings").click()');
  await wait(150);
  check(await evalJs('document.getElementById("setModal").classList.contains("hidden")'), '設定モーダルを閉じられる');

  const rect = await evalJs('JSON.stringify(document.getElementById("cv").getBoundingClientRect())');
  const R = JSON.parse(rect);
  const pad = R.width * 0.06, cell = (R.width - pad * 2) / 8;
  const sqPoint = (r, c) => ({ x: R.left + pad + (c + 0.5) * cell, y: R.top + pad + (r + 0.5) * cell });
  async function clickSquare(r, c) {
    const p = sqPoint(r, c);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await wait(120);
  }
  async function clickEl(sel) {
    await evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`);
    await wait(150);
  }

  // ---- チェス: e2-e4（白ポーン） ----
  await clickSquare(6, 4);
  check((await evalJs('document.getElementById("hint").dataset.sel || ""')) !== undefined, '駒タップ後に例外なし');
  await clickSquare(4, 4);
  let fen = await evalJs('window.__checkmeigo.fen()');
  check(fen.split(' ')[0].includes('P') && fen.split(' ')[1] === 'b', 'e2-e4 で手番が黒に', fen);
  check((await evalJs('window.__checkmeigo.chessLog().length')) === 1, '棋譜が1手');
  check((await evalJs('document.getElementById("turnInd").textContent')).includes('黒'), '手番表示が黒');

  // ---- チェス: 駒を取る（黒 d7-d5, 白 e4xd5）----
  await clickSquare(1, 3); // d7
  await clickSquare(3, 3); // d5
  await clickSquare(4, 4); // e4 pawn
  await clickSquare(3, 3); // capture d5
  check((await evalJs('window.__checkmeigo.chessLog().length')) === 3, '取り込みで3手');
  check((await evalJs('document.getElementById("dmg").textContent')).includes('♟'), '取った駒表示にポーン');

  // ---- 待った ----
  await clickEl('#btnUndo');
  check(await evalJs('document.getElementById("undoModal").classList.contains("hidden") === false'), '待った確認モーダル');
  await clickEl('#btnUndoOk');
  check((await evalJs('window.__checkmeigo.chessLog().length')) === 2, '待ったで1手戻る');

  // ---- プロモーションUI（hポーンを成らせる）----
  await clickEl('#btnOpenSettings');
  await clickEl('#btnNew');   // チェスを初期局面へ
  check((await evalJs('document.getElementById("setModal").classList.contains("hidden")')) === true, 'ニューゲームで設定が閉じる');
  check((await evalJs('window.__checkmeigo.chessLog().length')) === 0, 'ニューゲームで棋譜クリア');
  // 1.h4 a6 2.h5 a5 3.h6 a4 4.hxg7 a3 5.gxh8=Q
  const seq = [
    [6,7],[4,7], [1,0],[2,0],
    [4,7],[3,7], [2,0],[3,0],
    [3,7],[2,7], [3,0],[4,0],
    [2,7],[1,6], [4,0],[5,0],
    [1,6],[0,7]
  ];
  for (const [r,c] of seq) await clickSquare(r,c);
  check(await evalJs('document.getElementById("promoModal").classList.contains("hidden") === false'), 'プロモーション選択モーダル表示');
  await clickEl('#promoBtns button[data-promo="q"]');
  let fen2 = await evalJs('window.__checkmeigo.fen()');
  check(fen2.split(' ')[0].startsWith('rnbqkbnQ'), 'プロモーションでクイーン配置', fen2);
  check((await evalJs('window.__checkmeigo.chessLog().slice(-1)[0]')).includes('=Q'), '棋譜に =Q');

  // ---- 盤面反転 ----
  await clickEl('#btnPass');
  check((await evalJs('document.getElementById("btnPass").textContent')).includes('盤面'), '反転ボタン表示切替');
  await clickEl('#btnPass');
  check((await evalJs('window.__checkmeigo.game()')) === 'chess', '反転後もチェス');

  const shotChess = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'chess-board.png'), Buffer.from(shotChess.data, 'base64'));

  // ---- 囲碁に切替 ----
  await clickEl('#tabGo');
  check(await evalJs('window.__checkmeigo.game()') === 'go', '囲碁タブに切替');
  check((await evalJs('document.getElementById("btnPass").textContent')) === 'パス', '囲碁ではボタンがパス');

  const goRect = JSON.parse(await evalJs('JSON.stringify(document.getElementById("cv").getBoundingClientRect())'));
  const gpad = goRect.width * 0.085, gcell = (goRect.width - gpad * 2) / 8;
  async function clickGo(r, c) {
    const x = goRect.left + gpad + c * gcell, y = goRect.top + gpad + r * gcell;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await wait(150);
  }
  await clickGo(4, 4);
  const board = await evalJs('JSON.stringify(window.__checkmeigo.goBoard())');
  const gb = JSON.parse(board);
  check(gb[4 * 9 + 4] === 1, '囲碁: 天元に黒石');
  check((await evalJs('window.__checkmeigo.goTurn()')) === 2, '囲碁: 手番が白へ');
  check((await evalJs('document.getElementById("turnInd").textContent')).includes('白'), '囲碁: 手番表示が白');

  await clickGo(4, 3);
  check((await evalJs('window.__checkmeigo.goTurn()')) === 1, '囲碁: 白石で黒番へ');

  // パス２回で終局確認（黒パス→白パス）
  await clickEl('#btnPass');
  await wait(150);
  check((await evalJs('window.__checkmeigo.goPhase()')) === 'playing', '囲碁: 1回目のパスでは継続');
  await clickEl('#btnPass');
  await wait(200);
  check((await evalJs('window.__checkmeigo.goPhase()')) === 'dead', '囲碁: 連続パスで終局確認');
  check(await evalJs('document.getElementById("bnDead").classList.contains("hidden") === false'), '囲碁: 死に石バナー表示');

  const shotGo = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'go-board.png'), Buffer.from(shotGo.data, 'base64'));

  // 集計
  await clickEl('#btnDeadOk');
  check((await evalJs('document.getElementById("resModal").classList.contains("hidden") === false')), '囲碁: 結果モーダル表示');
  const shotRes = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'go-result.png'), Buffer.from(shotRes.data, 'base64'));

  // 結果を閉じてニューゲーム
  await clickEl('#btnAgain');
  check((await evalJs('window.__checkmeigo.goBoard().every(v => v === 0)')), 'ニューゲームで盤面クリア');

  // 例外・エラーログ
  check(issues.length === 0, 'JS例外/console.error なし', issues.join(' | '));

  console.log(`\nE2E smoke: ${pass} passed, ${fail} failed`);
  if (fail) { failures.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
  ws.close();
}

main().catch(e => { console.error('E2E fatal:', e); process.exit(1); });

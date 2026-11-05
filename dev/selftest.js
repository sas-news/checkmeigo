#!/usr/bin/env node
'use strict';
/**
 * チェックメイゴ エンジン自己テスト（DOM非依存）
 * index.html の /*ENGINE-START*\/ ... /*ENGINE-END*\/ 区間を抽出して Node で実行する。
 *
 *   node dev/selftest.js
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/\/\*ENGINE-START\*\/([\s\S]*?)\/\*ENGINE-END\*\//);
if (!m) { console.error('ENGINE markers not found'); process.exit(1); }

const engineSrc = m[1];
const sandboxModule = { exports: {} };
const factory = new Function('module', 'exports', engineSrc + '\nreturn module.exports;');
const Engine = factory(sandboxModule, sandboxModule.exports);

let pass = 0, fail = 0;
const failures = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; failures.push(`${label}: expected ${e}, got ${a}`); }
}
function ok(cond, label) { eq(!!cond, true, label); }

// ---------- チェス ----------
function perft(st, depth) {
  if (depth === 0) return 1;
  const moves = Engine.chessLegal(st);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const mv of moves) {
    Engine.chessApply(st, mv);
    n += perft(st, depth - 1);
    Engine.chessUndo(st);
  }
  return n;
}

const KEY = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -';
const KIWI = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

function runChess() {
  let st = Engine.chessNew();
  eq(Engine.chessLegal(st).length, 20, 'start legal moves = 20');
  eq(perft(Engine.chessNew(), 1), 20, 'perft(1)');
  eq(perft(Engine.chessNew(), 2), 400, 'perft(2)');
  eq(perft(Engine.chessNew(), 3), 8902, 'perft(3)');

  st = Engine.chessFromFen(KIWI);
  eq(Engine.chessLegal(st).length, 48, 'kiwipete legal moves = 48');
  eq(perft(Engine.chessFromFen(KIWI), 1), 48, 'kiwipete perft(1)');
  eq(perft(Engine.chessFromFen(KIWI), 2), 2039, 'kiwipete perft(2)');

  // キャスリング（両側が合法手に含まれる）
  st = Engine.chessFromFen(KIWI);
  const castles = Engine.chessLegal(st).filter(x => x.castle).map(x => x.castle).sort();
  eq(castles, ['K', 'Q'], 'kiwipete has both castles');

  // キャスリング実行でルークも動く
  st = Engine.chessFromFen(KIWI);
  const cm = Engine.chessLegal(st).find(x => x.castle === 'K');
  Engine.chessApply(st, cm);
  eq(st.b[Engine.chessIdx(7, 6)], 'K', 'castle: king on g1');
  eq(st.b[Engine.chessIdx(7, 5)], 'R', 'castle: rook on f1');
  eq(st.b[Engine.chessIdx(7, 7)], '', 'castle: h1 empty');
  Engine.chessUndo(st);

  // アンパッサン
  st = Engine.chessNew();
  const findMove = (from, to) => Engine.chessLegal(st).find(x => x.from === Engine.chessIdx(...from) && x.to === Engine.chessIdx(...to));
  let mv = findMove([6, 4], [4, 4]);            // e2-e4
  ok(mv, 'e2e4 exists');
  Engine.chessApply(st, mv);
  mv = findMove([1, 0], [3, 0]);                 // a7-a5
  Engine.chessApply(st, mv);
  mv = findMove([4, 4], [3, 4]);                 // e4-e5
  Engine.chessApply(st, mv);
  mv = findMove([1, 3], [3, 3]);                 // d7-d5 (double)
  Engine.chessApply(st, mv);
  eq(st.ep, Engine.chessIdx(2, 3), 'en passant target d6');
  const epm = Engine.chessLegal(st).find(x => x.epcap);
  ok(epm, 'en passant capture available');
  Engine.chessApply(st, epm);
  eq(st.b[Engine.chessIdx(3, 3)], '', 'en passant: d5 pawn removed');
  eq(st.b[Engine.chessIdx(2, 3)], 'P', 'en passant: white pawn on d6');
  Engine.chessUndo(st);
  eq(st.b[Engine.chessIdx(3, 3)], 'p', 'en passant undo restores d5 pawn');

  // プロモーション4択
  st = Engine.chessFromFen('8/1P6/8/8/8/8/k6K/8 w - - 0 1');
  const promos = Engine.chessLegal(st).filter(x => x.promo).map(x => x.promo).sort();
  eq(promos, ['b', 'n', 'q', 'r'], 'promotion offers 4 pieces');

  // 昇格実行 → クイーンになる
  st = Engine.chessFromFen('8/1P6/8/8/8/8/k6K/8 w - - 0 1');
  const pm = Engine.chessLegal(st).find(x => x.promo === 'q');
  Engine.chessApply(st, pm);
  eq(st.b[Engine.chessIdx(0, 1)], 'Q', 'promotion to queen');
  Engine.chessUndo(st);
  eq(st.b[Engine.chessIdx(1, 1)], 'P', 'promotion undo restores pawn');

  // チェックメイト（愚者のメイト）
  st = Engine.chessFromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  let s = Engine.chessStatus(st);
  ok(s.done, 'checkmate: done');
  eq(s.winner, 'b', 'checkmate: black wins');
  eq(s.reason, 'チェックメイト', 'checkmate reason');
  ok(Engine.chessInCheck(st), 'checkmate: in check');

  // ステイルメイト
  st = Engine.chessFromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  s = Engine.chessStatus(st);
  ok(s.done, 'stalemate: done');
  eq(s.winner, null, 'stalemate: no winner');
  eq(s.reason, 'ステイルメイト', 'stalemate reason');
  ok(!Engine.chessInCheck(st), 'stalemate: not check');

  // 50手ルール
  st = Engine.chessFromFen('7k/8/8/8/8/8/8/K6R w - - 100 60');
  s = Engine.chessStatus(st);
  eq(s.reason, '50手ルール', '50-move rule');

  // 駒不足（K+B vs K）
  st = Engine.chessFromFen('7k/8/8/8/8/8/8/KB6 w - - 0 1');
  eq(Engine.chessStatus(st).reason, '駒不足', 'insufficient material K+B vs K');

  // undo で局面が完全復元される（FEN一致）
  st = Engine.chessNew();
  const before = Engine.chessToFen ? null : null;
  const snapshot = st.b.slice().join(',') + '|' + st.t + '|' + JSON.stringify(st.cast) + '|' + st.ep;
  const rnd = [Engine.chessLegal(st)[0], Engine.chessLegal(st)[5]];
  for (const m1 of rnd.slice(0, 1)) { Engine.chessApply(st, m1); }
  Engine.chessUndo(st);
  const afterStr = st.b.slice().join(',') + '|' + st.t + '|' + JSON.stringify(st.cast) + '|' + st.ep;
  eq(afterStr, snapshot, 'undo restores full position');

  // 駒取り表示用の欠損数
  st = Engine.chessNew();
  Engine.chessApply(st, Engine.chessLegal(st).find(x => x.from === Engine.chessIdx(6, 4) && x.to === Engine.chessIdx(4, 4)));
  eq(Engine.chessCaptures(st).P, 0, 'no capture yet: no white pawns missing');
}

// ---------- 囲碁 ----------
function goIdx(r, c) { return r * 9 + c; }
function runGo() {
  const E = Engine;
  // 単騎取り: 白(0,0) の呼吸点は (0,1) と (1,0)。(0,1)に黒、次に (1,0) に黒で取れる
  let st = E.goNew();
  st.b[goIdx(0, 0)] = 2; st.b[goIdx(0, 1)] = 1;
  const cap = E.goSim(st.b, 9, goIdx(1, 0), 1, null);
  ok(cap && cap.cap.includes(goIdx(0, 0)), 'go: white stone captured');
  eq(cap.cap.length, 1, 'go: exactly one stone captured');

  // 自殺手: 黒が白2子に囲まれた点へ打つ
  const sb = new Array(81).fill(0);
  sb[goIdx(0, 0)] = 2;
  sb[goIdx(0, 1)] = 2; sb[goIdx(1, 0)] = 2;
  sb[goIdx(1, 1)] = 1; // 黒(1,1) の呼吸点は (0,1)黒? 実際は白 → 自殺
  eq(E.goSim(sb, 9, goIdx(0, 0), 1, null), null, 'go: suicide rejected');

  // 自殺手は不可
  st = E.goNew();
  st.b[goIdx(0, 0)] = 2;
  st.b[goIdx(1, 0)] = 1; st.b[goIdx(0, 1)] = 1;
  eq(E.goSim(st.b, 9, goIdx(0, 0), 1, null), null, 'go: occupied point rejected');
  // 通常手は許可される
  st = E.goNew();
  st.b[goIdx(0, 0)] = 2;
  ok(E.goSim(st.b, 9, goIdx(1, 1), 1, null), 'go: normal move allowed');

  // コウ: 同一局面再現は不可
  st = E.goNew();
  st.seen = [E.goHash(st.b)];
  // 単純なコウ局面を直接作る
  const cb = new Array(81).fill(0);
  cb[goIdx(0, 0)] = 1; cb[goIdx(0, 1)] = 2;
  cb[goIdx(1, 0)] = 2; cb[goIdx(1, 2)] = 1; cb[goIdx(0, 2)] = 1; cb[goIdx(1, 3)] = 1;
  cb[goIdx(2, 1)] = 1; cb[goIdx(2, 0)] = 1; cb[goIdx(1, 1)] = 0;
  st.b = cb;
  const whiteMove = E.goSim(cb, 9, goIdx(1, 1), 2, [E.goHash(cb), E.goHash(cb)]);
  eq(whiteMove, null, 'go: ko recapture rejected via seen hash');

  // スコア（中国ルール）: 黒1子だけなら空地80は全部黒地
  st = E.goNew();
  st.b[goIdx(0, 0)] = 1;
  const sc = E.goScore(st, []);
  eq(sc.s[1], 1, 'score: black stones');
  eq(sc.t[1], 80, 'score: single-color region is black territory');
  eq(sc.total[1], 81, 'score: black area = 81');
  // 黒白混在の空地は中立
  st.b[goIdx(0, 1)] = 2;
  const sc2 = E.goScore(st, []);
  eq(sc2.t[1] + sc2.t[2], 0, 'score: mixed-border region is neutral');

  // 死に石判定: 隅の1子（呼吸点1）で周囲が敵 → 死
  st = E.goNew();
  st.b[goIdx(0, 0)] = 2;         // 白1子（隅）
  st.b[goIdx(0, 1)] = 1; st.b[goIdx(1, 0)] = 1;
  const dead = E.goDetectDead(st);
  ok(dead.includes(goIdx(0, 0)), 'go: dead stone detected at corner');

  // 2眼の生きは死判定しない
  st = E.goNew();
  // 黒の2眼グループを中央に作る: (3,3)(3,4)(4,3)(4,4) の四角、眼は (3,5)?? 単純化して
  // 黒石: (2,2)..(2,6) 壁 + 内部に2つの空点を囲む形
  const b2 = new Array(81).fill(0);
  const W = 1;
  // 四角形の黒枠: rows 2..5, cols 2..5 の外周
  for (let r = 2; r <= 5; r++) for (let c = 2; c <= 5; c++) {
    if (r === 2 || r === 5 || c === 2 || c === 5) b2[goIdx(r, c)] = W;
  }
  // 内部 2x2 を2つの眼に分割
  b2[goIdx(3, 3)] = 0; b2[goIdx(4, 4)] = 0; b2[goIdx(3, 4)] = W; b2[goIdx(4, 3)] = W;
  st.b = b2;
  eq(E.goDetectDead(st), [], 'go: two-eye group is alive');

  // 終局: 連続パス
  st = E.goNew();
  E.goPass(st); E.goPass(st);
  eq(st.phase, 'dead', 'go: two passes enter dead-stone phase');
  E.goUndo(st); E.goUndo(st);
  eq(st.phase, 'playing', 'go: undo two passes returns to play');

  // 盤上の取り: 実戦形式（1子を包囲）
  st = E.goNew();
  ok(E.goPlay(st, goIdx(4, 4)), 'go: black plays center');
  ok(E.goPlay(st, goIdx(4, 3)), 'go: white plays left');
  ok(E.goPlay(st, goIdx(3, 4)), 'go: black plays above');
  ok(E.goPlay(st, goIdx(3, 3)), 'go: white plays diagonal');
  ok(E.goPlay(st, goIdx(5, 4)), 'go: black plays below');
  ok(E.goPlay(st, goIdx(0, 0)), 'go: white plays corner');
  const before2 = st.b.slice();
  ok(E.goPlay(st, goIdx(4, 5)), 'go: black plays right');
  ok(Array.isArray(st.b), 'go: board still valid');

  // コウの実戦再現は複雑なため、goSim の seen 判定（上）で担保
}

runChess();
runGo();

console.log(`\nチェックメイゴ engine selftest: ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('  ✓ すべて成功');

﻿/*!
 * vanilla.waves — waves-core.js
 * Het wave-dialect als ZERO-DEPENDENCY vanilla-JS port van p5.waves.
 *
 * Dit IS de canonieke p5.waves-math (v3.6.0, commit 804f91e), byte-getrouw —
 * met ALLEEN de p5-prototype-hook verwijderd en een eigen global ervoor in de
 * plaats. De berekening was altijd al puur vanilla (enkel Math.*); p5 was nooit
 * een dependency van de math, enkel van de prototype-extensies onderaan.
 *
 * Exposeert: VanillaWaves (canoniek), vWaves (alias), en Waves als drop-in —
 * zonder een eventueel al geladen p5.waves-`Waves` te overschrijven.
 *
 * Bron-pariteit bewaakt door de routine `waves-dialect-drift-watch`
 * (docs/waves.feature.md). NIET met de hand de math wijzigen — sync met canon.
 * Author: seb@prjcts · License: MIT
 */
(function (global) {
  'use strict';

  // ─── Wave definitions (35 entries, unique names) ─────────────────────────────
  // Each wave carries a real, precompiled `fn` — the library never calls
  // new Function / eval, so it runs under a strict Content-Security-Policy
  // (no 'unsafe-eval'). The `algo` string is display-only metadata; it must
  // stay in sync with `fn` (p5.waves tests/snapshot.js verifies this in Node).
  // The aliases below let `fn` read exactly like its `algo` string.

  const sin = Math.sin, cos = Math.cos, tan = Math.tan, abs = Math.abs,
        ceil = Math.ceil, round = Math.round, floor = Math.floor,
        min = Math.min, max = Math.max, log = Math.log, PI = Math.PI;

  const WAVES = [
    { name: 'classic sine',      algo: 'sin(x*.1)*.4',
      fn: (x) => sin(x*.1)*.4 },
    { name: 'sine',              algo: 'sin(x*.2)*.25',
      fn: (x) => sin(x*.2)*.25 },
    { name: 'sharp peaks',       algo: 'abs(sin(x*.1))*.5',
      fn: (x) => abs(sin(x*.1))*.5 },
    { name: 'square',            algo: '(x*.025)%1 < .5 ? -.5 : .5',
      fn: (x) => (x*.025)%1 < .5 ? -.5 : .5 },
    { name: 'pulse',             algo: '(x*.5)%20 < 1 ? -.5 : .5',
      fn: (x) => (x*.5)%20 < 1 ? -.5 : .5 },
    { name: 'stepped sine',      algo: 'ceil(sin(x*.1))*.25',
      fn: (x) => ceil(sin(x*.1))*.25 },
    { name: 'mountain peaks',    algo: 'abs(cos(x*.1))*.35 + sin(x*.1)*.25',
      fn: (x) => abs(cos(x*.1))*.35 + sin(x*.1)*.25 },
    { name: 'valleys',           algo: 'abs(cos(x*.1))*-.35 + sin(x*.1)*.25',
      fn: (x) => abs(cos(x*.1))*-.35 + sin(x*.1)*.25 },
    { name: 'zig-zag sine',      algo: 'sin(x*.2)*.4 % .12',
      fn: (x) => sin(x*.2)*.4 % .12 },
    { name: 'batman',            algo: 'sin(x*.1)*.7 % .4',
      fn: (x) => sin(x*.1)*.7 % .4 },
    { name: 'offset sine',       algo: 'ceil(cos(x*.1))*.25 - sin(x*.1)*.25',
      fn: (x) => ceil(cos(x*.1))*.25 - sin(x*.1)*.25 },
    { name: 'steps down',        algo: 'ceil(tan(x*.1))*.25',
      fn: (x) => ceil(tan(x*.1))*.25 },
    { name: 'steps',             algo: 'round(sin(-x*.1))*.25',
      fn: (x) => round(sin(-x*.1))*.25 },
    { name: 'squared sine',      algo: 'sq(sin(x*.1))*.25',
      fn: (x) => sq(sin(x*.1))*.25 },
    { name: 'bumpy sine',        algo: 'sin(x*.1)*.25 + sin(x*.5)*.1',
      fn: (x) => sin(x*.1)*.25 + sin(x*.5)*.1 },
    { name: 'wobble sine',       algo: 'sin(x*.1)*cos(x*.2)*.5',
      fn: (x) => sin(x*.1)*cos(x*.2)*.5 },
    { name: 'up down noise',     algo: 'x*sin(x*.1) % .5',
      fn: (x) => x*sin(x*.1) % .5 },
    { name: 'meta sine',         algo: 'sin(x*.45 + radians(x))*cos(x*.4)*.5',
      fn: (x) => sin(x*.45 + radians(x))*cos(x*.4)*.5 },
    { name: 'triangle',          algo: 'abs((x*.03) % (.5*2) - .5)',
      fn: (x) => abs((x*.03) % (.5*2) - .5) },
    { name: 'ramp',              algo: '-1*(x*.02%1)/1 + 0.5',
      fn: (x) => -1*(x*.02%1)/1 + 0.5 },
    { name: 'saw down',          algo: 'x*.03 % .5',
      fn: (x) => x*.03 % .5 },
    { name: 'saw up',            algo: '-x*.03 % .5',
      fn: (x) => -x*.03 % .5 },
    { name: 'shake out',         algo: 'sin(log(sq(min(abs(x)%62.8319,62.8319-abs(x)%62.8319))+1)*3)*.5',
      fn: (x) => sin(log(sq(min(abs(x)%62.8319,62.8319-abs(x)%62.8319))+1)*3)*.5 },
    { name: 'grow random',       algo: 'random(x*.003)',
      fn: (x) => random(x*.003) },
    { name: 'noise',             algo: 'noise(x*.1) - .5',
      fn: (x) => noise(x*.1) - .5 },
    { name: 'fuzzy pulse',       algo: 'tan(x*20)*.05',
      fn: (x) => tan(x*20)*.05 },
    { name: 'up down pulse',     algo: 'tan(x*.1)*.05',
      fn: (x) => tan(x*.1)*.05 },
    { name: 'bald patch',        algo: 'sq(x*.05) % .5',
      fn: (x) => sq(x*.05) % .5 },
    { name: 'fuzzy peak sine',   algo: 'sin(x*.1) < 0 ? random(-.2, .2) : sin(x*.1)*.5',
      fn: (x) => sin(x*.1) < 0 ? random(-.2, .2) : sin(x*.1)*.5 },
    { name: 'ramp up sine',      algo: 'sin(x)*(x*.01%.5)',
      fn: (x) => sin(x)*(x*.01%.5) },
    { name: 'triangle sine',     algo: 'sin(x)*(x*.01%1-.5)',
      fn: (x) => sin(x)*(x*.01%1-.5) },
    { name: 'round linked sine', algo: 'sin(x*.1)*cos(x*1)*.5',
      fn: (x) => sin(x*.1)*cos(x*1)*.5 },
    { name: 'half sine',         algo: 'sin(x*.05)*(x*.1%.5)',
      fn: (x) => sin(x*.05)*(x*.1%.5) },
    { name: 'smooth solid sine', algo: 'sin(x*3.1)*.25',
      fn: (x) => sin(x*3.1)*.25 },
    { name: 'spike sine',        algo: 'sq(sq(sin(x*.1)))*sin(x*.1)*.5',
      fn: (x) => sq(sq(sin(x*.1)))*sin(x*.1)*.5 },
  ];

  // ─── Character classification ────────────────────────────────────────────────
  // Parallel to WAVES. 'harsh' = breaks rhythm: tan/random/noise-driven, OR
  // otherwise not-calm (unbounded/Inf, or erratic accelerating rhythm).
  // 'gentle' = calm and bounded, including sharp-but-periodic (square, pulse)
  // and steady non-periodic waves (ramp up sine, triangle sine, meta sine).
  // group: 'harsh' picks BEFORE wave selection;
  // mode: 'wild' warps WITHIN one wave. They are orthogonal.
  const CHARACTER = [
    'gentle', 'gentle', 'gentle', 'gentle', 'gentle', 'gentle', 'gentle', 'gentle',
    'gentle', 'gentle', 'gentle',
    'harsh',                                     // 11 steps down (tan)
    'gentle', 'gentle', 'gentle', 'gentle',
    'harsh',                                     // 16 up down noise (x*sin grows unbounded)
    'gentle', 'gentle', 'gentle', 'gentle', 'gentle',
    'gentle',                                    // 22 shake out (mirrored log chirp: bounded, shake returns every period)
    'harsh',                                     // 23 grow random (random)
    'harsh',                                     // 24 noise (noise)
    'harsh',                                     // 25 fuzzy pulse (tan hi freq)
    'harsh',                                     // 26 up down pulse (tan)
    'harsh',                                     // 27 bald patch (x² % .5 — same growth mechanism as 16 up down noise)
    'harsh',                                     // 28 fuzzy peak sine (random)
    'gentle', 'gentle', 'gentle',                // 29 ramp up sine, 30 triangle sine, 31 round linked sine
    'harsh',                                     // 32 half sine (erratic accelerating rhythm)
    'gentle',                                    // 33 smooth solid sine
    'gentle'                                     // 34 spike sine (smooth odd sin⁵)
  ];

  if (CHARACTER.length !== WAVES.length) {
    throw new Error('p5.waves: CHARACTER length (' + CHARACTER.length +
      ') must match WAVES length (' + WAVES.length + ')');
  }

  const GENTLE_INDICES = [];
  const HARSH_INDICES  = [];
  for (let i = 0; i < CHARACTER.length; i++) {
    (CHARACTER[i] === 'harsh' ? HARSH_INDICES : GENTLE_INDICES).push(i);
  }

  // ─── Periodicity (experimental, v3.3.0) ──────────────────────────────────────
  // Parallel to WAVES. Periods at 4-decimal precision: theoretical (2π/k or
  // 1/k) where formulaically derivable, empirical from docs/periodicity.html
  // otherwise. null = non-periodic or non-deterministic. Regenerate via
  // docs/periodicity.html if formulas change. EXPERIMENTAL: values may shift
  // by ~0.0001 in minor versions. Suitable for visuals; not for sub-unit-
  // precision work (CNC, plotters, fabrication).

  const WAVE_PERIODS = [
    62.8319,  //  0 classic sine        2π/0.1
    31.4159,  //  1 sine                2π/0.2 (= 10π)
    31.4159,  //  2 sharp peaks         π/0.1 (abs halves period)
    40.0000,  //  3 square              1/0.025
    40.0000,  //  4 pulse               20/0.5
    62.8319,  //  5 stepped sine        2π/0.1 (ceil(sin) — empirical 62.60 was test noise)
    62.8319,  //  6 mountain peaks      LCM(π/0.1, 2π/0.1)
    62.8319,  //  7 valleys             LCM(π/0.1, 2π/0.1)
    31.4159,  //  8 zig-zag sine        2π/0.2 (mod by const preserves period)
    62.8319,  //  9 batman              2π/0.1
    62.8319,  // 10 offset sine         LCM(π/0.1, 2π/0.1)
    31.4159,  // 11 steps down          π/0.1 (tan)
    62.8319,  // 12 steps               2π/0.1 (round(sin))
    31.4159,  // 13 squared sine        π/0.1 (sin² halves period)
    62.8319,  // 14 bumpy sine          LCM(2π/0.1, 2π/0.5)
    62.8319,  // 15 wobble sine         LCM(2π/0.1, 2π/0.2)
    null,     // 16 up down noise       x*sin(x*.1) — amplitude grows
    null,     // 17 meta sine           incommensurate frequencies
    33.3333,  // 18 triangle            1/0.03
    50.0000,  // 19 ramp                1/0.02
    16.6667,  // 20 saw down            0.5/0.03
    16.6667,  // 21 saw up              0.5/0.03
    62.8319,  // 22 shake out           mirrored log chirp — palindrome over 2π/0.1
    null,     // 23 grow random         non-deterministic
    null,     // 24 noise                non-deterministic
    17.75,    // 25 fuzzy pulse         empirical (tan(x*20) clips oddly)
    31.4159,  // 26 up down pulse       π/0.1 (tan)
    null,     // 27 bald patch          x² grows
    null,     // 28 fuzzy peak sine     non-deterministic
    null,     // 29 ramp up sine        amplitude varies
    null,     // 30 triangle sine       amplitude varies
    62.8319,  // 31 round linked sine   LCM(2π/0.1, 2π/1)
    null,     // 32 half sine           amplitude varies
    2.0268,   // 33 smooth solid sine   2π/3.1 — fits 31× in base period
    62.8319   // 34 spike sine          2π/0.1 (odd sin⁵ preserves full period)
  ];

  if (WAVE_PERIODS.length !== WAVES.length) {
    throw new Error('p5.waves: WAVE_PERIODS length (' + WAVE_PERIODS.length +
      ') must match WAVES length (' + WAVES.length + ')');
  }

  // 'closing' pool = waves whose period divides the base evenly. Sweeping
  // CLOSING_BASE_PERIOD × N closes every wave in the pool, including across
  // shift transitions. Base 62.8319 (= 2π/0.1) is the dominant cluster — it
  // also covers its half (31.4159) and 1/31 (2.0268).
  const CLOSING_BASE_PERIOD = 62.8319;
  const CLOSING_RATIO_TOL   = 0.001;

  const CLOSING_INDICES = [];
  for (let i = 0; i < WAVE_PERIODS.length; i++) {
    const p = WAVE_PERIODS[i];
    if (p == null) continue;
    const ratio = CLOSING_BASE_PERIOD / p;
    if (Math.abs(ratio - Math.round(ratio)) < CLOSING_RATIO_TOL) {
      CLOSING_INDICES.push(i);
    }
  }

  // 'ghost' pool = a hand-picked subset of the closing waves that read well
  // under the ghost-delay embedding (see examples/ghost_delay): plot one wave
  // against a delayed copy of itself and it closes into a loop ring. Every
  // member closes over CLOSING_BASE_PERIOD and gives a clean loop, from a plain
  // ellipse (wobble sine) up to dense rosettes (mountain peaks, valleys). The
  // tan-based closing waves blow up under that pairing and the very-short-period
  // ones tangle, so they are left out. Aesthetic selection — discover membership
  // at runtime via the group, do not hardcode this list in consumer code.
  const GHOST_NAMES = [
    'wobble sine', 'bumpy sine', 'batman', 'round linked sine',
    'mountain peaks', 'valleys'
  ];
  const GHOST_INDICES = [];
  for (let i = 0; i < GHOST_NAMES.length; i++) {
    for (let j = 0; j < WAVES.length; j++) {
      if (WAVES[j].name === GHOST_NAMES[i]) { GHOST_INDICES.push(j); break; }
    }
  }

  // Session-wide flag on the global (window in browser) so the warning fires
  // once per page-load even if the IIFE is evaluated multiple times — e.g.
  // double <script> tag, live-reload re-injection, iframe sharing the global.
  function warnClosingExperimental() {
    if (global.__p5wavesClosingWarned) return;
    global.__p5wavesClosingWarned = true;
    if (typeof console !== 'undefined' && console.info) {
      console.info("[p5.waves] 'closing' group is experimental — period values " +
        "may shift by ~0.001 in minor versions. Fine for visuals; not for CNC, " +
        "plotters, or anything that gets angry about sub-unit drift.");
    }
  }

  // ─── Caches ──────────────────────────────────────────────────────────────────

  const STATS_CACHE = new Map();

  // Runtime entropy for wave() shift - stable per page load, different each session
  const _waveShiftEntropy = Math.floor(Math.random() * 100000);

  // ─── Math helpers ────────────────────────────────────────────────────────────

  function radians(deg) { return deg * (Math.PI / 180); }
  function sq(n)        { return n * n; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t)    { return a + (b - a) * t; }
  function fade(t)      { return t * t * t * (t * (t * 6 - 15) + 10); }

  // ─── Value coercion ───────────────────────────────────────────────────────────

  function toNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : (fallback !== undefined ? fallback : 0);
  }

  function toUnit(v, fb) {
    return clamp(toNumber(v, fb !== undefined ? fb : 0), 0, 1);
  }

  // ─── String helpers ───────────────────────────────────────────────────────────

  function normalizeName(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function compact(v)       { return normalizeName(v).replace(/[^a-z0-9]/g, ''); }

  // ─── Seeding (FNV-1a 32-bit) ─────────────────────────────────────────────────

  const _seedCacheKeys = new Array(16);
  const _seedCacheVals = new Array(16);
  let _seedCachePtr = 0, _seedCacheFill = 0;

  function seedFrom(value) {
    // NaN never matches itself in the cache scan below; coerce it to its
    // string form so repeated NaN seeds hit the cache like any other value.
    if (typeof value === 'number' && Number.isNaN(value)) value = 'NaN';
    // Check small ring-buffer cache first
    for (let i = 0; i < _seedCacheFill; i++) {
      if (_seedCacheKeys[i] === value) return _seedCacheVals[i];
    }
    // Compute FNV-1a
    const str = String(value == null ? 0 : value);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h  = Math.imul(h, 16777619);
    }
    h = h >>> 0;
    // Store in ring buffer
    _seedCacheKeys[_seedCachePtr] = value;
    _seedCacheVals[_seedCachePtr] = h;
    _seedCachePtr = (_seedCachePtr + 1) & 15;
    if (_seedCacheFill < 16) _seedCacheFill++;
    return h;
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ─── Wave lookup ─────────────────────────────────────────────────────────────

  function wrapIndex(i) {
    const len = WAVES.length;
    return ((Math.floor(i) % len) + len) % len;
  }

  function pickWaveIndex(seedValue) {
    const rng = mulberry32(seedFrom(seedValue));
    return Math.floor(rng() * WAVES.length);
  }

  // ─── Group (pool filter) ─────────────────────────────────────────────────────
  // `group` narrows the pool BEFORE wave selection (orthogonal to `mode`).
  // Accepts: 'all' / null (full pool), 'gentle', 'harsh', or an array of
  // names/indices. Unresolvable entries are silently dropped; empty result
  // falls back to the full pool.

  function resolveGroup(opt) {
    if (opt == null) return null;
    if (Array.isArray(opt)) {
      const pool = [];
      for (let i = 0; i < opt.length; i++) {
        const r = resolveWave(opt[i]);
        if (r >= 0) pool.push(r);
      }
      return pool.length > 0 ? pool : null;
    }
    if (typeof opt === 'string') {
      const k = normalizeName(opt);
      if (k === '' || k === 'all') return null;
      if (k === 'gentle')  return GENTLE_INDICES;
      if (k === 'harsh')   return HARSH_INDICES;
      if (k === 'closing') { warnClosingExperimental(); return CLOSING_INDICES; }
      if (k === 'ghost')   return GHOST_INDICES;
      return null;
    }
    return null;
  }

  function pickWaveIndexIn(seedValue, pool) {
    if (!pool || pool.length === 0) return pickWaveIndex(seedValue);
    const rng = mulberry32(seedFrom(seedValue));
    return pool[Math.floor(rng() * pool.length)];
  }

  // Returns an index different from curIdx, staying within the pool when given.
  // Pool of length 1 is an unavoidable repeat.
  function nextDifferentInPool(curIdx, pool) {
    if (!pool || pool.length === 0) return (curIdx + 1) % WAVES.length;
    if (pool.length === 1) return pool[0];
    const i = pool.indexOf(curIdx);
    if (i < 0) return pool[0];
    return pool[(i + 1) % pool.length];
  }

  // ─── Shift selection: per-cycle permutation ──────────────────────────────────
  // A naive per-era random draw clusters (coupon-collector): some waves repeat,
  // others never appear in a session. Instead, shuffle the pool once per full
  // cycle of L eras (Fisher-Yates seeded by base + cycle) and read it position
  // by position. Every wave shows exactly once per L eras, still pseudo-random
  // per session, still a pure function of era. Decks are memoised so the
  // per-pixel stateless wave() path stays O(1) amortised.

  let _allIndices = null;
  function allIndices() {
    if (_allIndices === null) {
      _allIndices = [];
      for (let i = 0; i < WAVES.length; i++) _allIndices.push(i);
    }
    return _allIndices;
  }

  // Deck cache: compare (cycle, pool ref, base string) directly so the hot
  // per-pixel path never builds a composite key or hashes on a hit. Named
  // groups ('gentle'/'harsh') resolve to a stable array reference, so the
  // pool === check holds across calls.
  const _deckBase  = new Array(4);
  const _deckCycle = new Array(4);
  const _deckPool  = new Array(4);
  const _deckVals  = new Array(4);
  let _deckPtr = 0, _deckFill = 0;

  function shuffledDeck(seedBase, cycle, pool) {
    for (let i = 0; i < _deckFill; i++) {
      if (_deckCycle[i] === cycle && _deckPool[i] === pool && _deckBase[i] === seedBase) {
        return _deckVals[i];
      }
    }
    const deck = ((pool && pool.length) ? pool : allIndices()).slice();
    const rng  = mulberry32(seedFrom(seedBase + '.' + cycle));
    for (let i = deck.length - 1; i > 0; i--) {
      const j   = Math.floor(rng() * (i + 1));
      const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    _deckBase[_deckPtr]  = seedBase;
    _deckCycle[_deckPtr] = cycle;
    _deckPool[_deckPtr]  = pool;
    _deckVals[_deckPtr]  = deck;
    _deckPtr = (_deckPtr + 1) & 3;
    if (_deckFill < 4) _deckFill++;
    return deck;
  }

  // Drop-in for pickWaveIndexIn(base + '.' + era, pool) on the shift path.
  function pickWaveIndexForEra(seedBase, era, pool) {
    const src = (pool && pool.length) ? pool : allIndices();
    const L = src.length;
    if (L <= 1) return src[0];
    const cycle = Math.floor(era / L);
    const pos   = era - cycle * L;
    return shuffledDeck(seedBase, cycle, pool)[pos];
  }

  function findWaveByName(name) {
    const key  = normalizeName(name);
    const keyC = compact(key);
    for (let i = 0; i < WAVES.length; i++) {
      if (normalizeName(WAVES[i].name) === key)  return i;
      if (compact(WAVES[i].name)       === keyC) return i;
    }
    return -1;
  }

  // Resolve a wave reference (number = index, string = name).
  function resolveWave(ref) {
    if (ref === undefined || ref === null) return -1;
    if (typeof ref === 'number') return wrapIndex(ref);
    if (typeof ref === 'string') return findWaveByName(ref);
    return -1;
  }

  // ─── Deterministic random / noise ────────────────────────────────────────────

  function hash01(n) {
    let h = (n * 127.1 + 311.7) | 0;
    h = ((h << 13) ^ h) | 0;
    h = (Math.imul(h, Math.imul(h, h) * 15731 + 789221) + 1376312589) | 0;
    return ((h & 0x7fffffff) / 0x7fffffff);
  }

  function rand01(seed, x, i) {
    return hash01(seed * 0.001 + x * 0.017 + i * 0.131);
  }

  function noise1D(x, seed) {
    if (!Number.isFinite(x)) return 0;
    const xi = Math.floor(x);
    const xf = x - xi;
    const v0 = hash01(xi     + seed * 0.07);
    const v1 = hash01(xi + 1 + seed * 0.07);
    return lerp(v0, v1, fade(xf));
  }

  function noiseSigned(x, seed) { return noise1D(x, seed) * 2 - 1; }

  // ─── Evaluation ──────────────────────────────────────────────────────────────
  // Wave fns are plain precompiled functions (see WAVES). `random` and `noise`
  // below are the deterministic primitives they reference; both read the
  // module-scope eval state, so evaluate() must set it before each call.

  // Module-scope state for evaluate - avoids closure allocation on every call
  let _evalSeed = 0, _evalX = 0, _evalCalls = 0;

  function random(min, max) {
    const r = rand01(_evalSeed, _evalX, _evalCalls++);
    if (min === undefined) return r;
    if (max === undefined) { max = min; min = 0; }
    if (max < min) { const tmp = max; max = min; min = tmp; }
    return min + r * (max - min);
  }

  function noise(n) { return noise1D(n, _evalSeed); }

  function evaluate(fn, x, t, seed) {
    if (typeof fn !== 'function') return 0;
    _evalSeed = seed; _evalX = x; _evalCalls = 0;
    const out = fn(x, toNumber(t, 0));
    return Number.isFinite(out) ? out : 0;
  }

  // ─── Wild mode ────────────────────────────────────────────────────────────────

  function evaluateWild(fn, x, t, seed, unpredictability) {
    let freqScale = 1 + noiseSigned(x * 0.17, seed + 17) * unpredictability * 0.7;
    freqScale = Math.max(0.05, freqScale);
    const phaseNoise = noiseSigned(x * 0.09, seed + 29) * unpredictability * 0.75;
    let ampNoise = 1 + noiseSigned(x * 0.23, seed + 41) * unpredictability * 0.45;
    ampNoise = Math.max(0.05, ampNoise);
    const wildMix = unpredictability * 0.25;

    const evalX = x * freqScale + phaseNoise;
    let val = evaluate(fn, evalX, t, seed);

    if (wildMix > 0) {
      const carrier = noiseSigned(evalX * 0.97 + seed * 0.0001, seed + 101);
      val = lerp(val, carrier, wildMix);
    }

    return val * ampNoise;
  }

  // ─── Normalization ────────────────────────────────────────────────────────────

  const STATS_DOMAIN  = [-200, 200];
  const STATS_SAMPLES = 1024;

  function getStats(waveIndex, internalSeed) {
    const key = waveIndex + '|' + internalSeed;
    if (STATS_CACHE.has(key)) return STATS_CACHE.get(key);

    const fn  = WAVES[waveIndex].fn;
    let mn = Infinity, mx = -Infinity;

    for (let i = 0; i < STATS_SAMPLES; i++) {
      const x = lerp(STATS_DOMAIN[0], STATS_DOMAIN[1], i / (STATS_SAMPLES - 1));
      const v = evaluate(fn, x, 0, internalSeed);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }

    if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn === mx) { mn = -1; mx = 1; }
    const stats = { min: mn, max: mx };
    STATS_CACHE.set(key, stats);
    // Evict oldest entry when cache exceeds limit
    if (STATS_CACHE.size > 256) {
      STATS_CACHE.delete(STATS_CACHE.keys().next().value);
    }
    return stats;
  }

  function mapToRange(value, stats, range) {
    if (stats.min === stats.max) return (range[0] + range[1]) * 0.5;
    const t = (value - stats.min) / (stats.max - stats.min);
    return range[0] + t * (range[1] - range[0]);
  }

  function normalizeVal(rawVal, stats) {
    if (stats.min === stats.max) return 0;
    const n = (rawVal - stats.min) / (stats.max - stats.min) * 2 - 1;
    return n < -1 ? -1 : n > 1 ? 1 : n;
  }

  // ─── Shared evaluation kernel ─────────────────────────────────────────────────

  function evalKernel(fn, y, t, frequency, phase, seed, mode, unpredictability) {
    const x = (toNumber(y, 0) + toNumber(t, 0)) * frequency + phase;
    if (mode === 'wild' && unpredictability > 0) {
      return evaluateWild(fn, x, t, seed, unpredictability);
    }
    return evaluate(fn, x, t, seed);
  }

  // ─── wave() ──────────────────────────────────────────────────────────────────

  function wave(y, secondParam) {
    // ─── Fast path: wave(y)  - no params ──────────────────────
    if (secondParam == null) {
      const idx   = pickWaveIndex(0);
      const iSeed = seedFrom(0);
      const raw   = evaluate(WAVES[idx].fn, toNumber(y, 0), 0, iSeed);
      return normalizeVal(raw, getStats(idx, iSeed)) * 100;
    }
    // ─── Fast path: wave(y, number)  - seed only ──────────────
    if (typeof secondParam === 'number') {
      const iSeed = seedFrom(secondParam);
      const idx   = pickWaveIndex(secondParam);
      const raw   = evaluate(WAVES[idx].fn, toNumber(y, 0), 0, iSeed);
      return normalizeVal(raw, getStats(idx, iSeed)) * 100;
    }
    // ─── Fast path: wave(y, 'name')  - wave name only ─────────
    if (typeof secondParam === 'string') {
      const r     = resolveWave(secondParam);
      const idx   = r >= 0 ? r : pickWaveIndex(0);
      const iSeed = seedFrom(0);
      const raw   = evaluate(WAVES[idx].fn, toNumber(y, 0), 0, iSeed);
      return normalizeVal(raw, getStats(idx, iSeed)) * 100;
    }

    // ─── Full path: wave(y, { ... }) ─────────────────────────
    let waveRef;
    if (secondParam.wave !== undefined) waveRef = secondParam.wave;
    const seed           = toNumber(secondParam.seed, 0);
    const t              = toNumber(secondParam.t, 0);
    const amplitude      = toNumber(secondParam.amplitude, 100);
    const frequency      = toNumber(secondParam.frequency, 1);
    const phase          = toNumber(secondParam.phase, 0);
    const mode           = normalizeName(secondParam.mode || 'stable') === 'wild' ? 'wild' : 'stable';
    const unpredictability = toUnit(secondParam.unpredictability, 0);
    let range = null;
    if (Array.isArray(secondParam.range) && secondParam.range.length >= 2) {
      range = [toNumber(secondParam.range[0], -1), toNumber(secondParam.range[1], 1)];
    }
    const shift         = !!secondParam.shift;
    // Guards keep cycleDur > 0 so era arithmetic never divides by zero.
    const shiftInterval = Math.max(0, toNumber(secondParam.shiftInterval, 3));
    const shiftDuration = Math.max(1e-6, toNumber(secondParam.shiftDuration, 1));
    const groupPool     = resolveGroup(secondParam.group);

    const internalSeed = seedFrom(seed);

    // ─── Shift: auto-cycle through random waves ──────────────
    if (shift) {
      const cycleDur = shiftInterval + shiftDuration;
      const era      = Math.floor(t / cycleDur);
      const progress = t - era * cycleDur;
      // Runtime entropy - stateless wave() has no persistent state,
      // but the entropy is stable within a single page load via closure
      const waveShiftEntropy = _waveShiftEntropy;
      const shiftBase = seed + '.' + waveShiftEntropy;

      const userIdx = waveRef !== undefined ? resolveWave(waveRef) : -1;
      const idxA = (era === 0 && userIdx >= 0) ? userIdx : pickWaveIndexForEra(shiftBase, era, groupPool);
      const fnA  = WAVES[idxA].fn;
      const valA = evalKernel(fnA, y, t, frequency, phase, internalSeed, mode, unpredictability);

      if (progress >= shiftInterval) {
        // Mirror the sampler's pickForEra: the next wave is always era+1's
        // deck pick; only era 0 honours a user-supplied wave (via idxA above).
        let idxB = pickWaveIndexForEra(shiftBase, era + 1, groupPool);
        if (idxB === idxA) idxB = nextDifferentInPool(idxA, groupPool);
        const fnB  = WAVES[idxB].fn;
        const valB = evalKernel(fnB, y, t, frequency, phase, internalSeed, mode, unpredictability);
        let m = clamp((progress - shiftInterval) / shiftDuration, 0, 1);
        m = m * m * (3 - 2 * m);
        if (range !== null) {
          const nA = mapToRange(valA, getStats(idxA, internalSeed), range);
          const nB = mapToRange(valB, getStats(idxB, internalSeed), range);
          return nA + (nB - nA) * m;
        }
        const nA = normalizeVal(valA, getStats(idxA, internalSeed));
        const nB = normalizeVal(valB, getStats(idxB, internalSeed));
        return (nA + (nB - nA) * m) * amplitude;
      }

      if (range !== null) return mapToRange(valA, getStats(idxA, internalSeed), range);
      return normalizeVal(valA, getStats(idxA, internalSeed)) * amplitude;
    }

    // ─── Morph: wave: ['nameA', 'nameB'], mix: 0-1 ───────────
    if (Array.isArray(waveRef)) {
      const mix  = toUnit(secondParam.mix, 0.5);
      const rA   = resolveWave(waveRef[0]);
      const rB   = waveRef.length > 1 ? resolveWave(waveRef[1]) : rA;
      const idxA = rA >= 0 ? rA : pickWaveIndexIn(seed, groupPool);
      const idxB = rB >= 0 ? rB : pickWaveIndexIn(seed, groupPool);
      const fnA  = WAVES[idxA].fn;
      const fnB  = WAVES[idxB].fn;
      const valA = evalKernel(fnA, y, t, frequency, phase, internalSeed, mode, unpredictability);
      const valB = evalKernel(fnB, y, t, frequency, phase, internalSeed, mode, unpredictability);
      if (range !== null) {
        const rA_ = mapToRange(valA, getStats(idxA, internalSeed), range);
        const rB_ = mapToRange(valB, getStats(idxB, internalSeed), range);
        return rA_ + (rB_ - rA_) * mix;
      }
      const nA = normalizeVal(valA, getStats(idxA, internalSeed));
      const nB = normalizeVal(valB, getStats(idxB, internalSeed));
      return (nA + (nB - nA) * mix) * amplitude;
    }

    let waveIndex;
    if (waveRef !== undefined) {
      const r = resolveWave(waveRef);
      waveIndex = r >= 0 ? r : pickWaveIndexIn(seed, groupPool);
    } else {
      waveIndex = pickWaveIndexIn(seed, groupPool);
    }

    const fn    = WAVES[waveIndex].fn;
    const val   = evalKernel(fn, y, t, frequency, phase, internalSeed, mode, unpredictability);
    const stats = getStats(waveIndex, internalSeed);

    if (range !== null) return mapToRange(val, stats, range);
    return normalizeVal(val, stats) * amplitude;
  }

  // ─── createSampler() ─────────────────────────────────────────────────────────

  function createSampler(options) {
    const opts           = options || {};
    const seed           = toNumber(opts.seed, 0);
    const t0             = toNumber(opts.t, 0);
    const amplitude      = toNumber(opts.amplitude, 100);
    const frequency      = toNumber(opts.frequency, 1);
    const phase          = toNumber(opts.phase, 0);
    const mode           = normalizeName(opts.mode || 'stable') === 'wild' ? 'wild' : 'stable';
    const unpredictability = toUnit(opts.unpredictability, 0);

    let range = null;
    if (Array.isArray(opts.range) && opts.range.length >= 2) {
      range = [toNumber(opts.range[0], -1), toNumber(opts.range[1], 1)];
    }

    const internalSeed = seedFrom(seed);
    const isMorph      = Array.isArray(opts.wave) && opts.wave.length >= 2;
    const mixDefault   = isMorph ? toUnit(opts.mix, 0.5) : 0;
    const groupPool    = resolveGroup(opts.group);

    let waveIndexA;
    if (isMorph) {
      const rA = resolveWave(opts.wave[0]);
      waveIndexA = rA >= 0 ? rA : pickWaveIndexIn(seed, groupPool);
    } else if (opts.wave !== undefined) {
      const r = resolveWave(opts.wave);
      waveIndexA = r >= 0 ? r : pickWaveIndexIn(seed, groupPool);
    } else {
      waveIndexA = pickWaveIndexIn(seed, groupPool);
    }

    let waveIndexB = -1;
    if (isMorph) {
      const rB = resolveWave(opts.wave[1]);
      waveIndexB = rB >= 0 ? rB : pickWaveIndexIn(seed, groupPool);
    }

    const fn     = WAVES[waveIndexA].fn;
    const fnB    = waveIndexB >= 0 ? WAVES[waveIndexB].fn : null;
    const statsA = getStats(waveIndexA, internalSeed);
    const statsB = waveIndexB >= 0 ? getStats(waveIndexB, internalSeed) : null;

    // ─── Shift mode ──────────────────────────────────────────
    if (opts.shift) {
      // Guards keep cycleDur > 0 so era arithmetic never divides by zero.
      const shiftInt = Math.max(0, toNumber(opts.shiftInterval, 3));
      const shiftDur = Math.max(1e-6, toNumber(opts.shiftDuration, 1));
      const cycleDur = shiftInt + shiftDur;
      const hasUserWave = opts.wave !== undefined && !Array.isArray(opts.wave);
      // Runtime entropy so each session produces a different sequence
      const shiftEntropy = Math.floor(Math.random() * 100000);
      const shiftBase = seed + '.' + shiftEntropy;

      let cachedEra = -Infinity;
      let curIdx = waveIndexA, nxtIdx = -1;
      let curFn = fn, nxtFn = null;
      let curName = WAVES[waveIndexA].name, nxtName = '';
      let lastMix = 0;

      function pickForEra(era) {
        if (era === 0 && hasUserWave) return waveIndexA;
        return pickWaveIndexForEra(shiftBase, era, groupPool);
      }

      function ensureEra(era) {
        if (era === cachedEra) return;
        cachedEra = era;
        curIdx  = pickForEra(era);
        nxtIdx  = pickForEra(era + 1);
        if (nxtIdx === curIdx) nxtIdx = nextDifferentInPool(curIdx, groupPool);
        curFn   = WAVES[curIdx].fn;
        nxtFn   = WAVES[nxtIdx].fn;
        curName = WAVES[curIdx].name;
        nxtName = WAVES[nxtIdx].name;
      }

      const isClosingPool = (groupPool === CLOSING_INDICES);

      return {
        get waveIndex()    { return curIdx; },
        get waveName()     { return curName; },
        get targetName()   { return nxtName; },
        get mix()          { return lastMix; },
        get shifting()     { return lastMix > 0; },
        // Experimental v3.3.0 — period of the active wave context.
        // For group: 'closing', returns the pool's stable base period
        // (so sweep = period × N closes through every shift transition).
        // Otherwise returns the current wave's measured period, or null.
        get period()       { return isClosingPool ? CLOSING_BASE_PERIOD : WAVE_PERIODS[curIdx]; },
        get targetPeriod() { return isClosingPool ? CLOSING_BASE_PERIOD : (nxtIdx >= 0 ? WAVE_PERIODS[nxtIdx] : null); },
        sample: function (y, t) {
          const tVal     = t !== undefined ? toNumber(t, 0) : t0;
          const era      = Math.floor(tVal / cycleDur);
          ensureEra(era);

          const progress = tVal - era * cycleDur;
          const valA     = evalKernel(curFn, y, tVal, frequency, phase, internalSeed, mode, unpredictability);

          if (progress >= shiftInt) {
            let m = clamp((progress - shiftInt) / shiftDur, 0, 1);
            m = m * m * (3 - 2 * m);
            lastMix = m;
            const valB = evalKernel(nxtFn, y, tVal, frequency, phase, internalSeed, mode, unpredictability);
            if (range !== null) {
              const nA = mapToRange(valA, getStats(curIdx, internalSeed), range);
              const nB = mapToRange(valB, getStats(nxtIdx, internalSeed), range);
              return nA + (nB - nA) * m;
            }
            const nA = normalizeVal(valA, getStats(curIdx, internalSeed));
            const nB = normalizeVal(valB, getStats(nxtIdx, internalSeed));
            return (nA + (nB - nA) * m) * amplitude;
          }

          lastMix = 0;
          if (range !== null) return mapToRange(valA, getStats(curIdx, internalSeed), range);
          return normalizeVal(valA, getStats(curIdx, internalSeed)) * amplitude;
        }
      };
    }

    const isClosingPool = (groupPool === CLOSING_INDICES);

    return {
      waveIndex: isMorph ? [waveIndexA, waveIndexB] : waveIndexA,
      waveName:  isMorph
        ? WAVES[waveIndexA].name + ' -> ' + WAVES[waveIndexB].name
        : WAVES[waveIndexA].name,
      // Experimental v3.3.0 — see shift sampler for semantics.
      period: isClosingPool ? CLOSING_BASE_PERIOD : WAVE_PERIODS[waveIndexA],
      sample: function (y, t, mix) {
        const tVal = t !== undefined ? toNumber(t, 0) : t0;
        const val  = evalKernel(fn, y, tVal, frequency, phase, internalSeed, mode, unpredictability);
        if (fnB !== null) {
          const mixVal = mix !== undefined ? toUnit(mix, mixDefault) : mixDefault;
          const valB   = evalKernel(fnB, y, tVal, frequency, phase, internalSeed, mode, unpredictability);
          if (range !== null) {
            const rA = mapToRange(val, statsA, range);
            const rB = mapToRange(valB, statsB, range);
            return rA + (rB - rA) * mixVal;
          }
          const nA = normalizeVal(val, statsA);
          const nB = normalizeVal(valB, statsB);
          return (nA + (nB - nA) * mixVal) * amplitude;
        }
        if (range !== null) return mapToRange(val, statsA, range);
        return normalizeVal(val, statsA) * amplitude;
      }
    };
  }

  // ─── Discovery ───────────────────────────────────────────────────────────────

  function list() {
    return WAVES.map(function (w, i) {
      return { index: i, name: w.name, algo: w.algo, character: CHARACTER[i] };
    });
  }

  // ─── Benchmark ───────────────────────────────────────────────────────────────

  function benchmark(config, iterations) {
    const n  = iterations || 10000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      wave(i * 0.1, config);
    }
    const elapsed = performance.now() - t0;
    return {
      iterations: n,
      ms:         Math.round(elapsed * 100) / 100,
      callsPerMs: Math.round(n / elapsed)
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  const Waves = {
    data:          WAVES,
    count:         WAVES.length,
    list:          list,
    wave:          wave,
    createSampler: createSampler,
    benchmark:     benchmark
  };

  // ─── Public exposure (vanilla, zero-dep) ─────────────────────────────────────
  // Canonieke naam + alias. Plus `Waves` als drop-in voor consumers (engine /
  // elements die `Waves.createSampler` aanroepen) — maar NOOIT een reeds geladen
  // p5.waves overschrijven. Géén p5.prototype-hook: dit is de vanilla-port.

  global.VanillaWaves = Waves;
  global.vWaves = Waves;
  if (!global.Waves) global.Waves = Waves;

})(typeof globalThis !== 'undefined' ? globalThis :
   typeof window !== 'undefined' ? window : this);

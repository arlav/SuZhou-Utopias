/**
 * subdiv-engine.js
 * Core substrate: a recursive rectilinear SUBDIVISION (split grammar) over a
 * rectangular plot. This is the discrete, rule-rewriting, rectilinear dual of
 * the Moore-neighbourhood CA in CADSS.
 *
 * DISCRETISATION AS A GENERATIVE OPERATION
 * ========================================
 * A continuous plot D = [0,DW] x [0,DD] is recursively partitioned by axis-
 * aligned splits. Each split is a rule application in the spirit of a split
 * grammar (Wonka et al., Instant Architecture, 2003; Mueller et al. 2006),
 * which itself sits in the shape-grammar lineage (Stiny). The partition tree
 * is the derivation; its leaves are the discrete cells.
 *
 *   split_x(r)   — divide a node into [r*w | (1-r)*w] along x
 *   split_y(r)   — divide along y
 *   comb(k,axis) — slice into k equal strips (the louvre / slat operator)
 *   stop         — declare a leaf
 *
 * STRUCTURE IS NEVER ASSIGNED
 * ===========================
 * As in CADSS, tectonic structure is DERIVED, never written into the cells.
 * Leaves become PLATES at a Z-register; the FINS, REVEALS and STRATA between
 * them are derived from leaf adjacency + register difference in topology.js.
 * Every derived element carries a dict{} that maps 1:1 to a TopologicPy
 * Dictionary on export.
 *
 * REPRODUCIBILITY
 * ===============
 * A seeded mulberry32 PRNG drives every stochastic choice, so a (seed, params)
 * pair is a deterministic design — essential for a generative *system* rather
 * than a one-off image.
 */

'use strict';

// ── Plot dimensions (metres) ────────────────────────────────────────────
let DW = 60, DD = 60;

// ── Subdivision rule parameters (driven by UI) ──────────────────────────
let MIND   = 3;     // min forced depth — guarantees a base decomposition
let MAXD   = 7;     // max tree depth
let MINC   = 2.4;   // min cell edge (metres) below which a node cannot split
let SPLITP = 0.94;  // base probability a non-terminal node splits
let FALLOFF= 0.09;  // per-depth reduction of split probability
let RHYTHM = 0.55;  // 0 = always halve · 1 = irregular harmonic ratios
let COMBP  = 0.30;  // probability a split becomes an n-ary comb (slats)
let COMBN  = 5;     // max strips in a comb
let OPENR  = 0.28;  // fraction of leaves realised as open frames (not filled)
let AXBIAS = 0.74;  // probability the split takes the LONGER axis (anti-sliver)

// ── Register / elevation parameters ─────────────────────────────────────
let REG    = 7;     // number of discrete Z registers (strata)
let ZSTEP  = 3.2;   // metres of elevation per register
let THICK  = 0.7;   // plate thickness (metres)
let REVEAL = 2.0;   // Z-step (m) at/above which an adjacency reads as a reveal
let STRAT  = 0.55;  // stratifier: 0 = register from depth · 1 = register from noise

// ── Register palette names (semantic, like CADSS communes) ──────────────
const RNAMES  = ['Datum','Plinth','Course','Mid','Cornice','Attic','Crown','Ridge','Spire','Apex'];
const RKINDS  = ['plate','plate','plate','plate','plate','plate','plate','plate','plate','plate'];

// ── Mutable derived state (populated by generate(); consumed downstream) ─
let root   = null;   // partition-tree root node
let leaves = [];     // flat list of leaf nodes (the discrete cells)
let gen    = 0;      // generation counter (re-rolls of the grammar)

// ─────────────────────────────────────────────────────────────────────────
//  SEEDED PRNG (mulberry32)
// ─────────────────────────────────────────────────────────────────────────
let _seed = 0x9e3779b9;
let _s    = _seed;
function reseed(v){ _seed = v >>> 0; _s = _seed; }
function rnd(){
  _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rint(a, b){ return a + Math.floor(rnd() * (b - a + 1)); }

// ─────────────────────────────────────────────────────────────────────────
//  SPLIT-RATIO REPERTOIRE  (the "rhythm" of the facade)
//  Low RHYTHM → bisection dominates; high RHYTHM → harmonic/irregular ratios.
// ─────────────────────────────────────────────────────────────────────────
const HARMONIC = [0.382, 0.618, 0.333, 0.667, 0.25, 0.75, 0.293, 0.707];
function pickRatio(){
  if (rnd() < (1 - RHYTHM)) return 0.5;
  return HARMONIC[rint(0, HARMONIC.length - 1)];
}

// ─────────────────────────────────────────────────────────────────────────
//  NODE FACTORY
// ─────────────────────────────────────────────────────────────────────────
let _nid = 0;
function node(x, y, w, d, depth){
  return { id:_nid++, x, y, w, d, depth, axis:null, ratio:null,
           children:null, leaf:false, reg:0, open:false };
}

// ─────────────────────────────────────────────────────────────────────────
//  RECURSIVE SUBDIVISION  — the grammar derivation
// ─────────────────────────────────────────────────────────────────────────
function canSplit(n){
  if (n.depth >= MAXD) return false;
  if (Math.min(n.w, n.d) < MINC * 2) return false;
  if (n.depth < MIND) return true;          // forced base decomposition
  const p = Math.max(0.04, SPLITP - FALLOFF * n.depth);
  return rnd() < p;
}

function chooseAxis(n){
  // Prefer the longer axis with probability AXBIAS (suppresses slivers).
  const longerX = n.w >= n.d;
  if (rnd() < AXBIAS) return longerX ? 'x' : 'y';
  return rnd() < 0.5 ? 'x' : 'y';
}

function subdivide(n){
  if (!canSplit(n)){ makeLeaf(n); return; }

  const axis = chooseAxis(n);
  const span = axis === 'x' ? n.w : n.d;

  // ── COMB operator: slice into k equal strips (louvres / slats) ──
  if (rnd() < COMBP && span > MINC * 3){
    const kMax = Math.min(COMBN, Math.floor(span / MINC));
    const k = Math.max(2, rint(2, Math.max(2, kMax)));
    n.axis = axis; n.ratio = 'comb'; n.children = [];
    const step = span / k;
    for (let i = 0; i < k; i++){
      const c = axis === 'x'
        ? node(n.x + i * step, n.y, step, n.d, n.depth + 1)
        : node(n.x, n.y + i * step, n.w, step, n.depth + 1);
      // Comb children are usually terminal slats; recurse while below MIND.
      if (rnd() < 0.18 || c.depth < MIND) subdivide(c); else makeLeaf(c, i);
      n.children.push(c);
    }
    return;
  }

  // ── Binary split ──
  const r = pickRatio();
  n.axis = axis; n.ratio = r; n.children = [];
  if (axis === 'x'){
    const w0 = n.w * r;
    n.children.push(node(n.x,        n.y, w0,        n.d, n.depth + 1));
    n.children.push(node(n.x + w0,   n.y, n.w - w0,  n.d, n.depth + 1));
  } else {
    const d0 = n.d * r;
    n.children.push(node(n.x, n.y,        n.w, d0,        n.depth + 1));
    n.children.push(node(n.x, n.y + d0,   n.w, n.d - d0,  n.depth + 1));
  }
  for (const c of n.children) subdivide(c);
}

// ─────────────────────────────────────────────────────────────────────────
//  LEAF REALISATION  — discretisation → tectonic register + fill
//  combIdx (optional) gives slats a corrugated register progression.
// ─────────────────────────────────────────────────────────────────────────
function makeLeaf(n, combIdx){
  n.leaf = true;

  // Register from a blend of subdivision depth (deeper → forward/higher) and
  // spatial noise. Comb slats alternate registers to read as corrugation.
  const depthReg = Math.round((n.depth / Math.max(1, MAXD)) * (REG - 1));
  const noiseReg = Math.floor(rnd() * REG);
  let reg = Math.round(depthReg * (1 - STRAT) + noiseReg * STRAT);
  if (combIdx != null) reg = (reg + combIdx) % REG;
  n.reg = Math.max(0, Math.min(REG - 1, reg));

  // Some leaves are open frames rather than solid plates (porosity).
  n.open = rnd() < OPENR;

  leaves.push(n);
}

// ─────────────────────────────────────────────────────────────────────────
//  GENERATE  — one full derivation of the grammar
// ─────────────────────────────────────────────────────────────────────────
function generate(){
  reseed(_seed);                 // deterministic from current seed
  _nid = 0; leaves = [];
  root = node(0, 0, DW, DD, 0);
  subdivide(root);
  gen++;
  return { root, leaves, gen };
}

/** Re-roll with a fresh random seed. */
function reroll(){
  reseed((Math.random() * 0xffffffff) >>> 0);
  return generate();
}

// ── Convenience accessors ───────────────────────────────────────────────
function zOf(reg){ return reg * ZSTEP; }
function leafCount(){ return leaves.length; }
function maxDepthReached(){ return leaves.reduce((m, l) => Math.max(m, l.depth), 0); }

// Node export for headless test harness (ignored in browser).
if (typeof module !== 'undefined' && module.exports){
  module.exports = {
    generate, reroll, reseed,
    get leaves(){ return leaves; }, get root(){ return root; }, get gen(){ return gen; },
    zOf, leafCount, maxDepthReached,
    setParams(o){ Object.assign(globalThis, o); }
  };
}

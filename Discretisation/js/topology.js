/**
 * topology.js  (Tectonic Discretiser)
 * Derives tectonic elements and a spatial graph from the partition each
 * generation. Faithful to the CADSS ontology: STRUCTURE IS NEVER ASSIGNED.
 *
 * ONTOLOGY (mirrors TopologicPy export)
 * ======================================
 *   Plate    — a realised leaf cell, a thin slab at its Z register   (Face / Cell)
 *   Fin      — vertical face along a boundary shared by two leaves at
 *              different registers; spans the Z step between them       (Face)
 *   Reveal   — a Fin whose Z step ≥ REVEAL (a shadow-gap), flagged in dict
 *   Stratum  — the datum plane of one register                          (Face)
 *   Joint    — coplanar adjacency (ΔZ = 0); carried as a graph edge only
 *
 * Every element carries a dict{} that maps 1:1 to a topologicpy.Dictionary.
 *
 * SPATIAL GRAPH
 * =============
 * Nodes are leaves (cells). Edges are partition adjacencies, classified
 * coplanar / stepped / reveal. Exported via Graph.ByVerticesEdges — the
 * adjacency is known analytically from the partition, so unlike CADSS we do
 * not rely on geometric face-sharing to recover it.
 */

'use strict';

// ── Register palette (cool plinth → warm crown; overridable in render) ──
let RCOLORS = ['#2f5d6e','#3f8a92','#6fae8e','#c8a046','#cf6a37','#b0512f','#7a4a36','#9a7b54','#c9b79a','#e7e1d0'];

// ── Derived collections (rebuilt every generation) ──────────────────────
let plates = [], fins = [], strata = [];
let graphData = { nodes:[], edges:[], stats:{ c:0, avg:'0', max:0 } };

// ── Tectonic signals + derived parameters (analogue of CADSS communes) ──
let sigs = [];              // per-register area fraction (length REG)
let pv   = [];              // derived parameter values 0..1
const TP = [
  { n:'Granularity',  f:'gran'  }, { n:'Layering',     f:'layer' },
  { n:'Porosity',     f:'poro'  }, { n:'Rhythm Reg.',  f:'rhythm'},
  { n:'Reveal Dens.', f:'reveal'}, { n:'Slenderness',  f:'slen'  },
  { n:'Coverage',     f:'cov'   }, { n:'Relief Depth', f:'relief'},
  { n:'Frame Ratio',  f:'frame' }, { n:'Adjacency',    f:'adj'   },
];

// ─────────────────────────────────────────────────────────────────────────
//  GEOMETRY HELPERS
// ─────────────────────────────────────────────────────────────────────────
function aspect(l){ return Math.max(l.w, l.d) / Math.max(1e-3, Math.min(l.w, l.d)); }
function rectVerts(l, z){
  return [[l.x, l.y, z], [l.x + l.w, l.y, z], [l.x + l.w, l.y + l.d, z], [l.x, l.y + l.d, z]];
}

/**
 * Edge-adjacency between two axis-aligned leaves.
 * Returns null, or { axis:'x'|'y', at, lo, hi } describing the shared segment.
 *   axis 'x' → leaves touch along a constant-x line (a north–south boundary)
 *   axis 'y' → leaves touch along a constant-y line (an east–west boundary)
 */
function adjacency(a, b){
  const EPS = 1e-4;
  // Vertical boundary (constant x): a right == b left, or b right == a left
  const touchX = Math.abs((a.x + a.w) - b.x) < EPS ? (a.x + a.w)
              : Math.abs((b.x + b.w) - a.x) < EPS ? a.x : null;
  if (touchX !== null){
    const lo = Math.max(a.y, b.y), hi = Math.min(a.y + a.d, b.y + b.d);
    if (hi - lo > EPS) return { axis:'x', at:touchX, lo, hi };
  }
  // Horizontal boundary (constant y)
  const touchY = Math.abs((a.y + a.d) - b.y) < EPS ? (a.y + a.d)
              : Math.abs((b.y + b.d) - a.y) < EPS ? a.y : null;
  if (touchY !== null){
    const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w);
    if (hi - lo > EPS) return { axis:'y', at:touchY, lo, hi };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
//  DERIVE ALL TECTONIC ELEMENTS
// ─────────────────────────────────────────────────────────────────────────
function derive(){
  plates = []; fins = []; strata = [];

  // ── PLATES ── one per leaf, at its register elevation
  for (const l of leaves){
    const z = zOf(l.reg);
    l._z = z; l._area = l.w * l.d; l._ar = aspect(l);
    plates.push({
      verts: rectVerts(l, z),
      x:l.x, y:l.y, w:l.w, d:l.d, z, reg:l.reg, open:l.open, depth:l.depth,
      cx:l.x + l.w/2, cy:l.y + l.d/2, area:l._area,
      dict:{
        type:'Plate', register:RNAMES[l.reg], register_id:l.reg, z_level:l.reg,
        elevation_m:+z.toFixed(2), realisation:l.open?'frame':'solid',
        area_m2:+l._area.toFixed(2), subdiv_depth:l.depth,
        aspect_ratio:+l._ar.toFixed(2), cell_w:+l.w.toFixed(2), cell_d:+l.d.toFixed(2),
      },
      id:l.id,
    });
  }

  // ── FINS / REVEALS ── derived from adjacency + register difference
  // Bucket leaves to avoid an O(n^2) sweep at high density.
  const grid = {}, GB = Math.max(4, Math.sqrt(Math.max(1, leaves.length)) | 0);
  const bw = DW / GB, bd = DD / GB;
  const bk = (bx, by) => bx + ',' + by;
  for (const l of leaves){
    const x0 = Math.max(0, Math.floor(l.x / bw) - 1), x1 = Math.min(GB, Math.floor((l.x + l.w) / bw) + 1);
    const y0 = Math.max(0, Math.floor(l.y / bd) - 1), y1 = Math.min(GB, Math.floor((l.y + l.d) / bd) + 1);
    for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++){
      (grid[bk(bx, by)] || (grid[bk(bx, by)] = [])).push(l);
    }
  }
  const seen = new Set();
  for (const bucket of Object.values(grid)){
    for (let i = 0; i < bucket.length; i++) for (let j = i + 1; j < bucket.length; j++){
      const a = bucket[i], b = bucket[j];
      const key = Math.min(a.id, b.id) + '_' + Math.max(a.id, b.id);
      if (seen.has(key)) continue; seen.add(key);
      const adj = adjacency(a, b);
      if (!adj) continue;
      const za = zOf(a.reg), zb = zOf(b.reg), dz = Math.abs(za - zb);
      a._deg = (a._deg || 0) + 1; b._deg = (b._deg || 0) + 1;
      const kind = dz < 1e-3 ? 'coplanar' : (dz >= REVEAL ? 'reveal' : 'stepped');
      if (kind === 'coplanar') { a._adj = (a._adj||[]); a._adj.push({to:b.id, kind, len: adj.hi - adj.lo, dz}); b._adj = (b._adj||[]); b._adj.push({to:a.id, kind, len: adj.hi - adj.lo, dz}); continue; }
      // Build the vertical fin rectangle along the shared segment
      const zlo = Math.min(za, zb), zhi = Math.max(za, zb);
      let verts;
      if (adj.axis === 'x'){
        verts = [[adj.at, adj.lo, zlo], [adj.at, adj.hi, zlo], [adj.at, adj.hi, zhi], [adj.at, adj.lo, zhi]];
      } else {
        verts = [[adj.lo, adj.at, zlo], [adj.hi, adj.at, zlo], [adj.hi, adj.at, zhi], [adj.lo, adj.at, zhi]];
      }
      const len = adj.hi - adj.lo;
      fins.push({
        verts, axis:adj.axis, len, dz, reveal:dz >= REVEAL,
        loReg:Math.min(a.reg, b.reg), hiReg:Math.max(a.reg, b.reg),
        cx:(verts[0][0]+verts[1][0])/2, cy:(verts[0][1]+verts[1][1])/2, zlo, zhi,
        dict:{
          type:'Fin', orientation:adj.axis === 'x' ? 'NS' : 'EW',
          step_m:+dz.toFixed(2), reveal:dz >= REVEAL,
          spans_registers:[Math.min(a.reg, b.reg), Math.max(a.reg, b.reg)],
          length_m:+len.toFixed(2), between:[a.id, b.id],
        },
      });
      a._adj = (a._adj||[]); a._adj.push({to:b.id, kind, len, dz});
      b._adj = (b._adj||[]); b._adj.push({to:a.id, kind, len, dz});
    }
  }

  // ── STRATA ── datum plane per register
  const areaByReg = new Array(REG).fill(0), cntByReg = new Array(REG).fill(0);
  for (const p of plates){ areaByReg[p.reg] += p.area; cntByReg[p.reg]++; }
  const total = DW * DD;
  for (let r = 0; r < REG; r++){
    if (cntByReg[r] === 0) continue;
    strata.push({
      reg:r, z:zOf(r), area:areaByReg[r], count:cntByReg[r],
      dict:{ type:'Stratum', register:RNAMES[r], register_id:r,
             elevation_m:+zOf(r).toFixed(2), plate_count:cntByReg[r],
             coverage:+(areaByReg[r] / total).toFixed(3) },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  SPATIAL GRAPH — leaf adjacency (analytic)
// ─────────────────────────────────────────────────────────────────────────
function buildGraph(){
  const nodes = leaves.map(l => ({
    id:l.id, x:l.x, y:l.y, reg:l.reg, z:zOf(l.reg), open:l.open, depth:l.depth,
    area:l.w * l.d, cx:l.x + l.w/2, cy:l.y + l.d/2,
    centroid:[+(l.x + l.w/2).toFixed(2), +(l.y + l.d/2).toFixed(2), +zOf(l.reg).toFixed(2)],
    dict:{
      type:'Cell', register:RNAMES[l.reg], register_id:l.reg, z_level:l.reg,
      elevation_m:+zOf(l.reg).toFixed(2), realisation:l.open ? 'frame' : 'solid',
      subdiv_depth:l.depth, area_m2:+(l.w * l.d).toFixed(2),
      centroid_m:[+(l.x + l.w/2).toFixed(2), +(l.y + l.d/2).toFixed(2), +zOf(l.reg).toFixed(2)],
    },
  }));
  const edges = [], eseen = new Set();
  for (const l of leaves){
    for (const a of (l._adj || [])){
      const k = Math.min(l.id, a.to) + '_' + Math.max(l.id, a.to);
      if (eseen.has(k)) continue; eseen.add(k);
      edges.push({
        from:l.id, to:a.to, kind:a.kind, length:+a.len.toFixed(2), dz:+a.dz.toFixed(2),
        dict:{ relation:a.kind, shared_length_m:+a.len.toFixed(2), z_step_m:+a.dz.toFixed(2) },
      });
    }
  }
  graphData = { nodes, edges, stats:gStats(nodes, edges) };
}

function gStats(ns, es){
  if (!ns.length) return { c:0, avg:'0', max:0 };
  const adj = {}; ns.forEach(n => adj[n.id] = []);
  es.forEach(e => { adj[e.from].push(e.to); adj[e.to].push(e.from); });
  const vis = new Set(); let c = 0;
  for (const n of ns){
    if (vis.has(n.id)) continue; c++;
    const q = [n.id];
    while (q.length){ const x = q.pop(); if (vis.has(x)) continue; vis.add(x); (adj[x] || []).forEach(y => q.push(y)); }
  }
  const deg = ns.map(n => (adj[n.id] || []).length);
  return { c, avg:(deg.reduce((a, b) => a + b, 0) / deg.length).toFixed(1), max:Math.max(...deg) };
}

// ─────────────────────────────────────────────────────────────────────────
//  TECTONIC SIGNALS + DERIVED PARAMETERS
// ─────────────────────────────────────────────────────────────────────────
function calcSigs(){
  sigs = new Array(REG).fill(0);
  const total = DW * DD;
  for (const p of plates) sigs[p.reg] += p.area / total;
}

function calcParams(){
  const n = leaves.length || 1;
  const total = DW * DD;
  const covered = plates.reduce((s, p) => s + p.area, 0);
  const openCnt = plates.filter(p => p.open).length;
  const usedRegs = strata.length;
  const revealLen = fins.filter(f => f.reveal).reduce((s, f) => s + f.len, 0);
  const finLen = fins.reduce((s, f) => s + f.len, 0) || 1;
  const meanAR = plates.reduce((s, p) => s + Math.max(p.w, p.d) / Math.max(1e-3, Math.min(p.w, p.d)), 0) / n;
  const meanDepth = leaves.reduce((s, l) => s + l.depth, 0) / n;
  const avgDeg = +(graphData.stats.avg || 0);

  const F = {
    gran:   Math.min(1, n / 400),
    layer:  Math.min(1, usedRegs / REG),
    poro:   openCnt / n,
    rhythm: Math.max(0, 1 - RHYTHM),            // low RHYTHM = regular
    reveal: Math.min(1, revealLen / finLen),
    slen:   Math.min(1, (meanAR - 1) / 6),
    cov:    Math.min(1, covered / total),
    relief: Math.min(1, (REG * ZSTEP) / 24),
    frame:  openCnt / n,
    adj:    Math.min(1, avgDeg / 6),
  };
  pv = TP.map(p => +(F[p.f] || 0).toFixed(3));
}

/**
 * render.js  (Tectonic Discretiser)
 * Canvas rendering: Axonometric, Plan (the partition from above), and
 * Strata (an exploded register stack — the tectonic "section").
 *
 * Plates draw back-to-front. Derived fins draw as vertical webs; reveals are
 * darkened shadow-gaps. Two grounds (graphite / paper) and several stratum
 * palettes evoke the Atelier-Olschinsky tectonic register.
 */

'use strict';

const mc  = document.getElementById('mc');
const ctx = mc.getContext('2d');

// ── Palettes: cool plinth → warm crown, indexed by register (10 strata) ──
const PALETTES = {
  olschinsky: ['#2f5d6e','#3f8a92','#6fae8e','#c8a046','#cf6a37','#b0512f','#7a4a36','#9a7b54','#c9b79a','#e7e1d0'],
  slate:      ['#202a33','#2c3f4a','#3a5560','#4f7a86','#6f97a0','#8aa8ad','#a8c0bf','#c2d2cf','#d6e0db','#eef2ee'],
  ember:      ['#1b1410','#3a1d12','#5a2a1c','#8a3a20','#b04a24','#cf6a37','#e8943c','#f0b95a','#f5d99a','#faf0cf'],
  paperink:   ['#222222','#3a3a3a','#525252','#6e6e6e','#8a8a8a','#a4a29c','#bcbab2','#d0ccc4','#e0dcd2','#efe9dd'],
};

function pal(){ return PALETTES[palette] || PALETTES.olschinsky; }
function regCol(r){ const p = pal(); return p[Math.min(r, p.length - 1)]; }

function resC(){
  const z = document.querySelector('.czone');
  mc.width = z.clientWidth; mc.height = z.clientHeight - 28;
}
window.addEventListener('resize', () => { resC(); render(); });
resC();

function hr(h, a){
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
function shade(h, f){
  const r = Math.round(parseInt(h.slice(1, 3), 16) * f), g = Math.round(parseInt(h.slice(3, 5), 16) * f), b = Math.round(parseInt(h.slice(5, 7), 16) * f);
  return `rgb(${Math.min(255,r)},${Math.min(255,g)},${Math.min(255,b)})`;
}
function bg(){ return ground === 'paper' ? '#e9e4d8' : '#0d0d0f'; }
function ink(){ return ground === 'paper' ? 'rgba(20,18,14,0.55)' : 'rgba(10,10,12,0.7)'; }

function render(){ if (view === 'axo') rAxo(); else if (view === 'plan') rPlan(); else rStrata(); }

// ─────────────────────────────────────────────────────────────────────────
//  3D ORBIT CAMERA  (orthographic; azimuth + elevation + zoom)
//  World (x,y,z) is centred on the model, yawed about the vertical Z axis by
//  camth, pitched by camel (0°=elevation/section, 90°=plan), then projected.
//  The into-screen coordinate drives the painter's sort; rotated face normals
//  drive back-face culling and a fixed screen-space Lambert shade, so opaque
//  plates read correctly from any orbit angle.
// ─────────────────────────────────────────────────────────────────────────
function camCenter(){ return [DW / 2, DD / 2, (REG - 1) * ZSTEP / 2 + THICK / 2]; }

function mkCam(W, H){
  const c = camCenter();
  const a = camth * Math.PI / 180, e = camel * Math.PI / 180;
  const H3 = (REG - 1) * ZSTEP + THICK;
  const R = 0.5 * Math.sqrt(DW * DW + DD * DD + H3 * H3) || 1;   // bounding sphere → stable under spin
  const sc = Math.min(W, H) / (2 * R) * 0.92 * (camzoom || 1);
  return { cx:c[0], cy:c[1], cz:c[2], ca:Math.cos(a), sa:Math.sin(a),
           ce:Math.cos(e), se:Math.sin(e), sc, ox:W / 2, oy:H * 0.56 };
}

function proj3(x, y, z, k){
  const dx = x - k.cx, dy = y - k.cy, dz = z - k.cz;
  const X1 =  dx * k.ca + dy * k.sa;        // yaw about Z
  const Y1 = -dx * k.sa + dy * k.ca;
  const Xs = X1;
  const Ys =  Y1 * k.ce + dz * k.se;        // depth (into screen)
  const Zs = -Y1 * k.se + dz * k.ce;        // up on screen
  return { sx:k.ox + Xs * k.sc, sy:k.oy - Zs * k.sc, depth:Ys };
}

function rotN(nx, ny, nz, k){               // rotate a world normal into view space
  const X1 = nx * k.ca + ny * k.sa, Y1 = -nx * k.sa + ny * k.ca, Z1 = nz;
  return { x:X1, y:Y1 * k.ce + Z1 * k.se, z:-Y1 * k.se + Z1 * k.ce };
}

// fixed screen-space light: from upper-left, slightly toward the viewer
const _L = (() => { const x = -0.35, y = 0.5, z = 0.72, m = Math.hypot(x, y, z); return { x:x / m, y:y / m, z:z / m }; })();
function lamb(n){ return 0.42 + 0.58 * Math.max(0, n.x * _L.x + n.y * _L.y + n.z * _L.z); }

// Unit cube faces: corner indices into [X,Y,Z] pairs + outward normal.
const _BOXF = [
  { i:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]], n:[0,0,1]  },   // top
  { i:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]], n:[0,0,-1] },   // bottom
  { i:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]], n:[1,0,0]  },   // +x
  { i:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]], n:[-1,0,0] },   // -x
  { i:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]], n:[0,1,0]  },   // +y
  { i:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]], n:[0,-1,0] },   // -y
];

function rAxo(){
  const W = mc.width, H = mc.height;
  ctx.fillStyle = bg(); ctx.fillRect(0, 0, W, H);
  const k = mkCam(W, H);

  // Plot footprint outline
  ctx.globalAlpha = ground === 'paper' ? 0.12 : 0.07;
  ctx.strokeStyle = ground === 'paper' ? '#000' : '#bfbcb4'; ctx.lineWidth = 0.5;
  const f = [proj3(0, 0, 0, k), proj3(DW, 0, 0, k), proj3(DW, DD, 0, k), proj3(0, DD, 0, k)];
  ctx.beginPath(); ctx.moveTo(f[0].sx, f[0].sy); for (let i = 1; i < 4; i++) ctx.lineTo(f[i].sx, f[i].sy); ctx.closePath(); ctx.stroke();
  ctx.globalAlpha = 1;

  // Back-to-front primitive list: fins (double-sided) + plate faces (culled).
  const prims = [];
  if (showFins) for (const fn of fins){
    const v = fn.verts.map(p => proj3(p[0], p[1], p[2], k));
    prims.push({ depth:(v[0].depth + v[1].depth + v[2].depth + v[3].depth) / 4, kind:'fin', v, reveal:fn.reveal });
  }
  for (const p of plates){
    if (regHi < REG - 1 && p.reg > regHi) continue;          // register cutaway
    const X = [p.x, p.x + p.w], Y = [p.y, p.y + p.d], Z = [p.z, p.z + THICK];
    const col = regCol(p.reg);
    if (p.open){
      // open frame → wire box in the register colour
      const c = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]]
        .map(o => proj3(X[o[0]], Y[o[1]], Z[o[2]], k));
      const E = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      prims.push({ depth:(c[0].depth + c[6].depth) / 2, kind:'frame', col, c, E });
      continue;
    }
    for (const F of _BOXF){
      const ns = rotN(F.n[0], F.n[1], F.n[2], k);
      if (ns.y <= 0) continue;                                // back-face cull
      const poly = F.i.map(o => proj3(X[o[0]], Y[o[1]], Z[o[2]], k));
      prims.push({ depth:(poly[0].depth + poly[1].depth + poly[2].depth + poly[3].depth) / 4,
                   kind:'face', poly, fill:shade(col, lamb(ns)) });
    }
  }
  prims.sort((a, b) => a.depth - b.depth);                    // far → near

  const lineA = ground === 'paper' ? 0.5 : 0.34;
  for (const pr of prims){
    if (pr.kind === 'fin'){
      ctx.beginPath(); ctx.moveTo(pr.v[0].sx, pr.v[0].sy); for (let i = 1; i < 4; i++) ctx.lineTo(pr.v[i].sx, pr.v[i].sy); ctx.closePath();
      ctx.fillStyle = ground === 'paper' ? (pr.reveal ? '#9a9488' : '#cfc8ba') : (pr.reveal ? '#070708' : '#16171b');
      ctx.fill(); ctx.strokeStyle = ink(); ctx.lineWidth = 0.35; ctx.stroke();
    } else if (pr.kind === 'frame'){
      ctx.strokeStyle = pr.col; ctx.lineWidth = 0.9; ctx.globalAlpha = 0.85;
      ctx.beginPath(); for (const e of pr.E){ ctx.moveTo(pr.c[e[0]].sx, pr.c[e[0]].sy); ctx.lineTo(pr.c[e[1]].sx, pr.c[e[1]].sy); } ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath(); ctx.moveTo(pr.poly[0].sx, pr.poly[0].sy); for (let i = 1; i < 4; i++) ctx.lineTo(pr.poly[i].sx, pr.poly[i].sy); ctx.closePath();
      ctx.fillStyle = pr.fill; ctx.fill(); ctx.strokeStyle = ink(); ctx.lineWidth = lineA; ctx.stroke();
    }
  }

  // Graph overlay
  if (showGraph && graphData.edges.length < 1400){
    const nm = {}; graphData.nodes.forEach(n => nm[n.id] = n);
    ctx.globalAlpha = ground === 'paper' ? 0.2 : 0.14;
    for (const e of graphData.edges){
      const a = nm[e.from], b = nm[e.to]; if (!a || !b) continue;
      const p0 = proj3(a.cx, a.cy, a.z, k), p1 = proj3(b.cx, b.cy, b.z, k);
      ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy);
      ctx.strokeStyle = e.kind === 'reveal' ? '#cf6a37' : e.kind === 'stepped' ? '#c8a046' : '#3f8a92';
      ctx.lineWidth = 0.5; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  PLAN VIEW  — the partition seen from above (the dense floor plan)
// ─────────────────────────────────────────────────────────────────────────
function rPlan(){
  const W = mc.width, H = mc.height;
  ctx.fillStyle = bg(); ctx.fillRect(0, 0, W, H);
  const m = 22, sc = Math.min((W - 2 * m) / DW, (H - 2 * m) / DD);
  const ox = (W - DW * sc) / 2, oy = (H - DD * sc) / 2;

  // Plates as filled cells, tinted by register, darker = lower
  for (const p of plates){
    const x = ox + p.x * sc, y = oy + p.y * sc, w = p.w * sc, d = p.d * sc;
    const col = regCol(p.reg), depthShade = 0.45 + 0.55 * (p.reg / Math.max(1, REG - 1));
    if (p.open){
      ctx.strokeStyle = col; ctx.lineWidth = 1.1; ctx.strokeRect(x + 1, y + 1, w - 2, d - 2);
    } else {
      ctx.fillStyle = shade(col, depthShade); ctx.fillRect(x, y, w, d);
      ctx.strokeStyle = ink(); ctx.lineWidth = 0.5; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, d - 1);
    }
  }
  // Reveal boundaries (shadow gaps) — heavier ink on the high side
  if (showFins) for (const f of fins){
    if (!f.reveal) continue;
    const a = f.verts[0], b = f.verts[1];
    ctx.strokeStyle = ground === 'paper' ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(ox + a[0] * sc, oy + a[1] * sc); ctx.lineTo(ox + b[0] * sc, oy + b[1] * sc); ctx.stroke();
  }
  ctx.fillStyle = ground === 'paper' ? '#444' : '#232330'; ctx.font = '7px DM Mono,monospace';
  ctx.fillText(`PLAN  ${DW}×${DD}m  GEN:${String(gen).padStart(3, '0')}  cells:${leaves.length}`, ox, oy + DD * sc + 14);
}

// ─────────────────────────────────────────────────────────────────────────
//  STRATA VIEW  — exploded register stack (tectonic section)
// ─────────────────────────────────────────────────────────────────────────
function rStrata(){
  const W = mc.width, H = mc.height;
  ctx.fillStyle = bg(); ctx.fillRect(0, 0, W, H);
  const used = strata.map(s => s.reg);
  const n = Math.max(1, used.length);
  const bandH = Math.min(150, (H - 40) / n);
  const sc = Math.min((W - 60) / DW, (bandH * 0.7) / DD);
  const ox = 40;

  used.forEach((reg, i) => {
    const oy = 24 + i * bandH;
    const col = regCol(reg);
    // register label + datum line
    ctx.fillStyle = ground === 'paper' ? '#333' : '#8a8a8a'; ctx.font = '7px DM Mono,monospace';
    ctx.fillText(`${RNAMES[reg]}  Z=${zOf(reg).toFixed(1)}m`, 4, oy + 8);
    ctx.strokeStyle = hr('#c8a046', 0.25); ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(ox, oy + DD * sc + 6); ctx.lineTo(ox + DW * sc, oy + DD * sc + 6); ctx.stroke();
    // plates at this register (slight axo skew for depth read)
    for (const p of plates){
      if (p.reg !== reg) continue;
      const skew = 0.32;
      const x = ox + p.x * sc + p.y * sc * skew, y = oy + p.y * sc * 0.55;
      const w = p.w * sc, d = p.d * sc * 0.55;
      if (p.open){ ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, d); }
      else { ctx.fillStyle = col; ctx.fillRect(x, y, w, d); ctx.strokeStyle = ink(); ctx.lineWidth = 0.4; ctx.strokeRect(x, y, w, d); }
    }
  });
  ctx.fillStyle = ground === 'paper' ? '#444' : '#232330'; ctx.font = '7px DM Mono,monospace';
  ctx.fillText(`STRATA  ${n} registers  GEN:${String(gen).padStart(3, '0')}`, 4, H - 4);
}

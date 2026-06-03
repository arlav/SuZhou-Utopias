/**
 * app.js  (Tectonic Discretiser)
 * UI orchestration. Wires subdiv-engine.js → topology.js → render.js → export.js.
 *
 * Load order in index.html:
 *   subdiv-engine.js → topology.js → render.js → export.js → app.js
 *
 * Unlike CADSS the substrate is not painted but DERIVED from a seeded grammar,
 * so the central verbs are regenerate (re-run the derivation) and reroll
 * (new seed). Every control re-runs the deterministic pipeline; a (seed,params)
 * pair therefore fully reproduces a design.
 */

'use strict';

// ── UI state (read by render.js) ─────────────────────────────────────────
let view      = 'axo';        // 'axo' | 'plan' | 'strata'
let camth     = 32;           // orbit azimuth (deg)
let camel     = 58;           // orbit elevation (deg): 0 = elevation/section, 90 = plan
let camzoom   = 1;            // orthographic zoom factor
let palette   = 'olschinsky'; // register palette name (see render.PALETTES)
let ground    = 'graphite';   // 'graphite' | 'paper'
let showFins  = true;         // draw derived fins / reveals
let showGraph = false;        // overlay adjacency graph (dense → off by default)
let regHi     = REG - 1;      // register cutaway: hide registers above this

// ─────────────────────────────────────────────────────────────────────────
//  FULL UPDATE — re-derive everything from the current partition, then paint
// ─────────────────────────────────────────────────────────────────────────
function fullUpdate(){
  derive();
  buildGraph();
  calcSigs();
  calcParams();
  render();
  updHdr();
  updStatus();
  updElems();
  updSigUI();
  updParamUI();
  updTopoUI();
  updAdjPre();
}

/** Re-run the grammar derivation (deterministic from the current seed). */
function regen(){
  generate();
  fullUpdate();
}

// ─────────────────────────────────────────────────────────────────────────
//  GENERATION ACTIONS
// ─────────────────────────────────────────────────────────────────────────
function doReroll(){
  reroll();                                   // fresh random seed
  document.getElementById('inSeed').value = _seed;
  fullUpdate();
  log('ok', `Re-roll · seed ${_seed} · ${leaves.length} cells`);
}

function doRegen(){
  regen();
  log('gen', `Regenerate · ${leaves.length} cells · depth≤${maxDepthReached()}`);
}

function rebuild(){
  const w = clamp(+document.getElementById('inW').value || 60, 20, 140);
  const d = clamp(+document.getElementById('inD').value || 60, 20, 140);
  const s = (parseInt(document.getElementById('inSeed').value) >>> 0) || 1;
  DW = w; DD = d; reseed(s);
  regen();
  document.getElementById('glbl').textContent = `PLOT ${DW}×${DD} m`;
  document.getElementById('cDim').textContent = `${DW}×${DD}m`;
  log('ok', `Rebuilt plot ${DW}×${DD} m · seed ${s} · ${leaves.length} cells`);
}

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

// ─────────────────────────────────────────────────────────────────────────
//  PARAMETER SYNC — read sliders → globals → labels → regenerate
// ─────────────────────────────────────────────────────────────────────────
function gv(id){ return +document.getElementById(id).value; }
function setLbl(id, txt){ document.getElementById(id).textContent = txt; }

function syncGrammar(){
  MAXD   = gv('rMAXD');
  MIND   = Math.min(gv('rMIND'), MAXD);
  MINC   = gv('rMINC') / 10;
  SPLITP = gv('rSPLITP') / 100;
  FALLOFF= gv('rFALL') / 100;
  RHYTHM = gv('rRHY') / 100;
  COMBP  = gv('rCOMBP') / 100;
  COMBN  = gv('rCOMBN');
  OPENR  = gv('rOPENR') / 100;
  AXBIAS = gv('rAX') / 100;
  setLbl('vMAXD', MAXD); setLbl('vMIND', MIND);
  setLbl('vMINC', MINC.toFixed(1)); setLbl('vSPLITP', SPLITP.toFixed(2));
  setLbl('vFALL', FALLOFF.toFixed(2)); setLbl('vRHY', RHYTHM.toFixed(2));
  setLbl('vCOMBP', COMBP.toFixed(2)); setLbl('vCOMBN', COMBN);
  setLbl('vOPENR', OPENR.toFixed(2)); setLbl('vAX', AXBIAS.toFixed(2));
  regen();
}

function syncReg(){
  const prevReg = REG;
  REG    = gv('rREG');
  ZSTEP  = gv('rZSTEP') / 10;
  THICK  = gv('rTHICK') / 10;
  REVEAL = gv('rREVEAL') / 10;
  STRAT  = gv('rSTRAT') / 100;
  setLbl('vREG', REG); setLbl('vZSTEP', ZSTEP.toFixed(1));
  setLbl('vTHICK', THICK.toFixed(1)); setLbl('vREVEAL', REVEAL.toFixed(1));
  setLbl('vSTRAT', STRAT.toFixed(2));
  if (REG !== prevReg){
    const rR = document.getElementById('rReg');
    rR.max = REG - 1;
    if (regHi > REG - 1 || regHi === prevReg - 1){ regHi = REG - 1; rR.value = regHi; }
    setLbl('vReg', regHi === REG - 1 ? 'all' : regHi);
  }
  regen();
}

function syncCam(){ camth = gv('rCam'); updCam(); render(); }
function syncEl(){ camel = clamp(gv('rEl'), 4, 89); updCam(); render(); }
function syncReveal(){
  regHi = gv('rReg');
  setLbl('vReg', regHi === REG - 1 ? 'all' : regHi);
  render();
}
function setPalette(){ palette = document.getElementById('selPal').value; render(); }
function setGround(){ ground  = document.getElementById('selGnd').value; render(); }
function togFins(){ showFins = !showFins; setLbl('fl', showFins ? 'ON' : 'OFF'); render(); }
function togGraph(){ showGraph = !showGraph; setLbl('gl', showGraph ? 'ON' : 'OFF'); render(); }

function setV(v){
  view = v;
  ['vA','vP','vS'].forEach(id => document.getElementById(id).classList.remove('on'));
  document.getElementById({ axo:'vA', plan:'vP', strata:'vS' }[v]).classList.add('on');
  mc.style.cursor = (v === 'axo') ? 'grab' : 'default';
  render();
}

// ─────────────────────────────────────────────────────────────────────────
//  READOUTS
// ─────────────────────────────────────────────────────────────────────────
function pct(n){ return Math.round(n * 100) + '%'; }
function coverage(){ const t = DW * DD; return plates.reduce((s, p) => s + (p.open ? 0 : p.area), 0) / t; }
function revealCount(){ return fins.filter(f => f.reveal).length; }
function solidCount(){ return plates.filter(p => !p.open).length; }

function updHdr(){
  setLbl('hG', String(gen).padStart(3, '0'));
  setLbl('hCell', leaves.length);
  setLbl('hCov', pct(coverage()));
  setLbl('hFin', fins.length);
  setLbl('hRev', revealCount());
  setLbl('hReg', strata.length);
  setLbl('hN', graphData.nodes.length);
  setLbl('hE', graphData.edges.length);
  setLbl('cG', String(gen).padStart(3, '0'));
}

function updStatus(){
  const sol = solidCount();
  setLbl('sbCell', leaves.length);
  setLbl('sbSol', sol);
  setLbl('sbFr', leaves.length - sol);
  setLbl('sbFin', fins.length);
  setLbl('sbRev', revealCount());
  setLbl('sbStr', strata.length);
  setLbl('sbN', graphData.nodes.length);
  setLbl('sbE', graphData.edges.length);
  setLbl('sbCp', graphData.stats.c);
  setLbl('sbDep', maxDepthReached());
  setLbl('cCells', leaves.length + ' cells');
  setLbl('cFins', fins.length + ' fins');
  setLbl('cReg', strata.length + ' reg');
}

function updElems(){
  const sol = solidCount();
  document.getElementById('elSt').innerHTML = [
    { l:'Plates',  v:plates.length,        c:'var(--slab)' },
    { l:'Solid',   v:sol,                  c:'var(--col)'  },
    { l:'Frames',  v:plates.length - sol,  c:'var(--beam)' },
    { l:'Fins',    v:fins.length,          c:'var(--wall)' },
    { l:'Reveals', v:revealCount(),        c:'var(--ac)'   },
    { l:'Strata',  v:strata.length,        c:'var(--circ)' },
  ].map(s => `<div class="ssi"><div class="ssil">${s.l}</div><div class="ssiv" style="color:${s.c}">${s.v}</div></div>`).join('');
}

function updSigUI(){
  const el = document.getElementById('sigP'); el.innerHTML = '';
  for (let r = 0; r < REG; r++){
    const pp = PALETTES[palette] || PALETTES.olschinsky;
    const frac = sigs[r] || 0, col = pp[Math.min(r, pp.length - 1)];
    const d = document.createElement('div'); d.className = 'cmi';
    d.innerHTML =
      `<div class="cmh"><div class="cmdt" style="background:${col}"></div>` +
      `<div class="cmnm">${RNAMES[r]} · Z=${zOf(r).toFixed(1)}m</div>` +
      `<div class="cmpct" style="color:${col}">${pct(frac)}</div></div>` +
      `<div class="cmbar"><div class="cmfill" style="width:${Math.min(100, frac * 100).toFixed(1)}%;background:${col}"></div></div>`;
    el.appendChild(d);
  }
}

function updParamUI(){
  const el = document.getElementById('paramP'); el.innerHTML = '';
  TP.forEach((p, i) => {
    const v = pv[i] || 0, blocks = Math.round(v * 5);
    const d = document.createElement('div'); d.className = 'pri';
    d.innerHTML =
      `<div class="prnm">${p.n}</div>` +
      `<div class="prtr"><div class="prfill" style="width:${(v * 100).toFixed(0)}%;background:var(--ac)"></div></div>` +
      `<div class="prsc">${'·'.repeat(5 - blocks)}</div>` +
      `<div class="prv" style="color:var(--ac)">${v.toFixed(2)}</div>`;
    el.appendChild(d);
  });
}

function updTopoUI(){
  const st = graphData.stats || { c:0, avg:'0', max:0 };
  document.getElementById('tg').innerHTML = [
    { l:'Cells',      v:graphData.nodes.length },
    { l:'Adjacency',  v:graphData.edges.length },
    { l:'Fins',       v:fins.length },
    { l:'Reveals',    v:revealCount() },
    { l:'Components', v:st.c },
    { l:'Avg degree', v:st.avg },
    { l:'Max degree', v:st.max },
    { l:'Area m²',    v:(DW * DD).toFixed(0) },
  ].map(s => `<div class="ts"><div class="tsl">${s.l}</div><div class="tsv">${s.v}</div></div>`).join('');
}

function updAdjPre(){
  const es = graphData.edges;
  const colOf = k => k === 'reveal' ? '#cf6a37' : k === 'stepped' ? '#c8a046' : '#3f8a92';
  document.getElementById('ap').innerHTML = es.slice(0, 6).map(e =>
    `<span style="color:${colOf(e.kind)}">R${e.from}</span>` +
    `<span style="color:var(--mu)">&nbsp;[${e.kind}&middot;${e.dz}m]&nbsp;</span>` +
    `<span style="color:${colOf(e.kind)}">R${e.to}</span>`
  ).join('<br>') || '<span>&#8212;</span>';
}

// ─────────────────────────────────────────────────────────────────────────
//  EVENT LOG
// ─────────────────────────────────────────────────────────────────────────
function log(t, m){
  const el = document.getElementById('lg');
  const cls = { ok:'lok', warn:'lw', gen:'lg' }[t] || '';
  const d = document.createElement('div');
  d.innerHTML = `<span class="${cls}">G${String(gen).padStart(3, '0')}</span> ${m}`;
  el.insertBefore(d, el.firstChild);
  while (el.children.length > 24) el.removeChild(el.lastChild);
}

// ─────────────────────────────────────────────────────────────────────────
//  CANVAS INTERACTION
//   · scroll       → rotate axonometric camera
//   · hover (plan) → tooltip with the cell under the cursor
// ─────────────────────────────────────────────────────────────────────────
function plateAt(e){
  if (view !== 'plan') return null;
  const W = mc.width, H = mc.height, m = 22;
  const sc = Math.min((W - 2 * m) / DW, (H - 2 * m) / DD);
  const ox = (W - DW * sc) / 2, oy = (H - DD * sc) / 2;
  const r = mc.getBoundingClientRect();
  const px = (e.clientX - r.left) * (W / r.width), py = (e.clientY - r.top) * (H / r.height);
  const mx = (px - ox) / sc, my = (py - oy) / sc;
  // top-most (highest register) plate containing the point
  let hit = null;
  for (const p of plates){
    if (mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.d){
      if (!hit || p.reg > hit.reg) hit = p;
    }
  }
  return hit;
}

function showTip(e){
  const el = document.getElementById('tip'), p = plateAt(e);
  if (!p){ el.style.opacity = '0'; return; }
  el.style.left = (e.clientX + 12) + 'px'; el.style.top = (e.clientY - 6) + 'px'; el.style.opacity = '1';
  el.textContent = `${RNAMES[p.reg]} · Z=${p.z.toFixed(1)}m · ${p.open ? 'frame' : 'solid'} · ` +
                   `${p.area.toFixed(1)}m² · d${p.depth} · AR ${(Math.max(p.w, p.d) / Math.max(0.01, Math.min(p.w, p.d))).toFixed(1)}`;
}

mc.addEventListener('mousemove', showTip);
mc.addEventListener('mouseleave', () => { document.getElementById('tip').style.opacity = '0'; });
mc.addEventListener('wheel', e => {
  if (view !== 'axo') return;
  e.preventDefault();
  camzoom = clamp(camzoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.3, 4);
  updCam(); render();
}, { passive:false });

// Drag to orbit the 3D view. Pointer events + pointer capture survive the
// cursor leaving the canvas; preventDefault + touch-action:none stop the
// browser hijacking the gesture as a text/image selection.
let _drag = null;
function updCam(){
  const e = document.getElementById('camRead');
  if (e) e.textContent = `az ${Math.round(camth)}° · el ${Math.round(camel)}° · ${camzoom.toFixed(1)}×`;
}
mc.addEventListener('pointerdown', e => {
  if (view !== 'axo') return;
  e.preventDefault();
  _drag = { x:e.clientX, y:e.clientY, id:e.pointerId };
  try { mc.setPointerCapture(e.pointerId); } catch (_) {}
  mc.style.cursor = 'grabbing';
});
mc.addEventListener('pointermove', e => {
  if (!_drag) return;
  e.preventDefault();
  const dx = e.clientX - _drag.x, dy = e.clientY - _drag.y; _drag.x = e.clientX; _drag.y = e.clientY;
  camth = ((camth + dx * 0.45) % 360 + 360) % 360;
  camel = clamp(camel - dy * 0.40, 4, 89);
  const rc = document.getElementById('rCam'); if (rc) rc.value = Math.round(camth);
  const re = document.getElementById('rEl');  if (re) re.value = Math.round(camel);
  updCam(); render();
});
function _endDrag(){ if (_drag){ try { mc.releasePointerCapture(_drag.id); } catch (_) {} _drag = null; mc.style.cursor = (view === 'axo') ? 'grab' : 'default'; } }
mc.addEventListener('pointerup', _endDrag);
mc.addEventListener('pointercancel', _endDrag);

// ─────────────────────────────────────────────────────────────────────────
//  KEYBOARD SHORTCUTS
//   1 axo · 2 plan · 3 strata · R re-roll · G regenerate · F fins · space cycle view
// ─────────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === '1') setV('axo');
  else if (e.key === '2') setV('plan');
  else if (e.key === '3') setV('strata');
  else if (e.key === 'r' || e.key === 'R') doReroll();
  else if (e.key === 'g' || e.key === 'G') doRegen();
  else if (e.key === 'f' || e.key === 'F') togFins();
  else if (e.key === ' '){ e.preventDefault(); setV(view === 'axo' ? 'plan' : view === 'plan' ? 'strata' : 'axo'); }
});

// ─────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────
function init(){
  reseed((parseInt(document.getElementById('inSeed').value) >>> 0) || 1);
  syncGrammar();   // reads sliders → params, then regen() → fullUpdate()
  syncReg();
  camth = gv('rCam'); camel = gv('rEl'); mc.style.cursor = 'grab'; updCam();
  document.getElementById('glbl').textContent = `PLOT ${DW}×${DD} m`;
  document.getElementById('cDim').textContent = `${DW}×${DD}m`;
  log('ok', `Init · split-grammar substrate · seed ${_seed}`);
  log('ok', `${leaves.length} cells · structure is DERIVED, never assigned`);
  log('ok', 'Plates=Cells · Fins/Reveals=Faces · Dicts=semantics');
  log('ok', 'Export → TopologicPy Cluster + Graph with Dictionary semantics');
}
init();

/**
 * export.js  (Tectonic Discretiser)
 * Generates a self-contained TopologicPy script and a raw JSON dump from the
 * current partition. Mirrors the CADSS export idiom.
 *
 * TOPOLOGICAL MAPPING
 * ===================
 *   Plate   → thin topologicpy.Cell  (box z .. z+THICK)
 *   Fin     → topologicpy.Face        (vertical rectangle on a shared boundary)
 *   Graph   → Graph.ByVerticesEdges   (leaf centroids + analytic adjacency)
 *   Cluster → Cluster.ByTopologies    (all cells + fins, layered)
 *
 * Unlike CADSS the layered plates rarely share faces, so the adjacency graph
 * is built analytically (we already know it from the partition) rather than
 * recovered from geometry.
 */

'use strict';

function _coresafe(v){ return v.map(x => +(+x).toFixed(4)); }

function exportPy(){
  const platesData = JSON.stringify(plates.map(p => ({
    bbox_min:[p.x, p.y, p.z], bbox_max:[p.x + p.w, p.y + p.d, p.z + THICK],
    centroid:[p.cx, p.cy, p.z + THICK / 2], open:p.open, dict:p.dict, id:p.id,
  })));
  const finsData = JSON.stringify(fins.map(f => ({ verts:f.verts, dict:f.dict })));
  const nodesData = JSON.stringify(graphData.nodes.map(n => ({ id:n.id, centroid:n.centroid, dict:n.dict })));
  const edgesData = JSON.stringify(graphData.edges.map(e => ({ from:e.from, to:e.to, dict:e.dict })));
  const strataData = JSON.stringify(strata.map(s => s.dict));

  const L = []; const p = s => L.push(s);

  p('#!/usr/bin/env python3');
  p('"""');
  p('Tectonic Discretiser — TopologicPy Export');
  p('Generation : ' + gen);
  p('Plot       : ' + DW + ' x ' + DD + ' m');
  p('Registers  : ' + REG + '  (Z step ' + ZSTEP + ' m, plate thickness ' + THICK + ' m)');
  p('Cells      : ' + plates.length + '  (' + plates.filter(x => x.open).length + ' open frames)');
  p('Fins       : ' + fins.length + '  (' + fins.filter(x => x.reveal).length + ' reveals)');
  p('Strata     : ' + strata.length);
  p('Graph      : ' + graphData.nodes.length + ' nodes / ' + graphData.edges.length + ' edges');
  p('');
  p('ONTOLOGY (structure is DERIVED, never assigned)');
  p('==============================================');
  p('  topologicpy.Cell        — a realised leaf plate (thin box at its register)');
  p('  topologicpy.Face        — a Fin: vertical web on a boundary between two');
  p('                            leaves at different registers (Reveal if step >= REVEAL)');
  p('  topologicpy.Graph       — leaf adjacency, classified coplanar/stepped/reveal');
  p('  topologicpy.Dictionary  — semantic attributes on every Cell, Face, vertex');
  p('');
  p('8-STEP WORKFLOW');
  p('===============');
  p('  1. Build thin Cell boxes from plate bbox coordinates');
  p('  2. Cluster.ByTopologies(cells)  — layered plates (rarely share faces)');
  p('  3. Assign Dictionary to Cells by centroid matching');
  p('  4. Build Fin Faces from shared-boundary vertices; assign Dictionaries');
  p('  5. Build Graph vertices from leaf centroids');
  p('  6. Build Graph edges from analytic adjacency; Graph.ByVerticesEdges');
  p('  7. Assign Dictionary to Graph vertices by centroid matching');
  p('  8. Governance analysis (Gov-0 .. Gov-7)');
  p('"""');
  p('');
  p('import math');
  p('from collections import defaultdict');
  p('');
  p('from topologicpy.Vertex     import Vertex');
  p('from topologicpy.Edge       import Edge');
  p('from topologicpy.Face       import Face');
  p('from topologicpy.Cell       import Cell');
  p('from topologicpy.Cluster    import Cluster');
  p('from topologicpy.Graph      import Graph');
  p('from topologicpy.Dictionary import Dictionary');
  p('from topologicpy.Topology   import Topology');
  p('');
  p('DW, DD = ' + DW + ', ' + DD);
  p('REG, ZSTEP, THICK, REVEAL = ' + REG + ', ' + ZSTEP + ', ' + THICK + ', ' + REVEAL);
  p('TOL = 0.001');
  p('');
  p('PLATES_DATA = ' + platesData);
  p('FINS_DATA   = ' + finsData);
  p('NODES_DATA  = ' + nodesData);
  p('EDGES_DATA  = ' + edgesData);
  p('STRATA_DATA = ' + strataData);
  p('');
  p('print(f"Plates:{len(PLATES_DATA)}  Fins:{len(FINS_DATA)}  GraphNodes:{len(NODES_DATA)}  GraphEdges:{len(EDGES_DATA)}")');
  p('');

  // Helpers
  p('# ---- HELPERS -------------------------------------------------------');
  p('def v3(pt): return Vertex.ByCoordinates(float(pt[0]), float(pt[1]), float(pt[2]))');
  p('');
  p('def centroid_key(x, y, z, tol=0.05):');
  p('    return (round(x/tol)*tol, round(y/tol)*tol, round(z/tol)*tol)');
  p('');
  p('def make_dict(d):');
  p('    keys = [str(k) for k in d.keys()]');
  p('    vals = [v if isinstance(v,(int,float,bool,str)) else str(v) for v in d.values()]');
  p('    return Dictionary.ByKeysValues(keys, vals)');
  p('');
  p('def get_val(topo, key):');
  p('    d = Topology.Dictionary(topo)');
  p('    return Dictionary.ValueAtKey(d, key) if d else None');
  p('');
  p('def pl_name(r):');
  p('    names = ' + JSON.stringify(RNAMES));
  p('    return names[r] if r < len(names) else f"R{r}"');
  p('');
  p('def cuboid_cell(mn, mx):');
  p('    x0,y0,z0 = float(mn[0]),float(mn[1]),float(mn[2])');
  p('    x1,y1,z1 = float(mx[0]),float(mx[1]),float(mx[2])');
  p('    faces = [');
  p('        Face.ByVertices([v3([x0,y0,z0]),v3([x1,y0,z0]),v3([x1,y1,z0]),v3([x0,y1,z0])]),');
  p('        Face.ByVertices([v3([x0,y0,z1]),v3([x1,y0,z1]),v3([x1,y1,z1]),v3([x0,y1,z1])]),');
  p('        Face.ByVertices([v3([x0,y0,z0]),v3([x1,y0,z0]),v3([x1,y0,z1]),v3([x0,y0,z1])]),');
  p('        Face.ByVertices([v3([x0,y1,z0]),v3([x1,y1,z0]),v3([x1,y1,z1]),v3([x0,y1,z1])]),');
  p('        Face.ByVertices([v3([x0,y0,z0]),v3([x0,y1,z0]),v3([x0,y1,z1]),v3([x0,y0,z1])]),');
  p('        Face.ByVertices([v3([x1,y0,z0]),v3([x1,y1,z0]),v3([x1,y1,z1]),v3([x1,y0,z1])]),');
  p('    ]');
  p('    return Cell.ByFaces([f for f in faces if f], tolerance=TOL)');
  p('');

  // Steps
  p('# ---- STEP 1: Build plate Cells -------------------------------------');
  p('print("\\nStep 1 - Building plate Cells...")');
  p('cells, cell_centroids = [], {}');
  p('for pl in PLATES_DATA:');
  p('    c = cuboid_cell(pl["bbox_min"], pl["bbox_max"])');
  p('    if not c: continue');
  p('    cells.append(c)');
  p('    cx,cy,cz = pl["centroid"]');
  p('    cell_centroids[centroid_key(cx,cy,cz)] = pl["dict"]');
  p('print(f"  Built {len(cells)} Cells")');
  p('');
  p('# ---- STEP 2: Cluster (layered plates) ------------------------------');
  p('print("\\nStep 2 - Clustering...")');
  p('cluster = Cluster.ByTopologies(cells) if cells else None');
  p('merged  = Topology.SelfMerge(cluster, tolerance=TOL) if cluster else None');
  p('print(f"  Clustered {len(cells)} plates")');
  p('');
  p('# ---- STEP 3: Assign Dicts to Cells ---------------------------------');
  p('print("\\nStep 3 - Assigning Dictionaries to Cells...")');
  p('n_assigned = 0');
  p('for c in cells:');
  p('    ctr = Topology.Centroid(c)');
  p('    ck = centroid_key(Vertex.X(ctr), Vertex.Y(ctr), Vertex.Z(ctr))');
  p('    payload = cell_centroids.get(ck)');
  p('    if payload: Topology.SetDictionary(c, make_dict(payload)); n_assigned += 1');
  p('print(f"  Assigned {n_assigned}/{len(cells)} Cells")');
  p('');
  p('# ---- STEP 4: Build Fin Faces ---------------------------------------');
  p('print("\\nStep 4 - Building Fin Faces...")');
  p('fin_faces = []');
  p('for fn in FINS_DATA:');
  p('    face = Face.ByVertices([v3(p) for p in fn["verts"]])');
  p('    if not face: continue');
  p('    Topology.SetDictionary(face, make_dict(fn["dict"]))');
  p('    fin_faces.append(face)');
  p('print(f"  Built {len(fin_faces)} Fin Faces ({sum(1 for f in FINS_DATA if f[\'dict\'].get(\'reveal\'))} reveals)")');
  p('');
  p('# ---- STEP 5-6: Build Graph -----------------------------------------');
  p('print("\\nStep 5-6 - Building Graph...")');
  p('gverts, vkey = [], {}');
  p('for nd in NODES_DATA:');
  p('    v = v3(nd["centroid"]); gverts.append(v); vkey[nd["id"]] = v');
  p('gedges = []');
  p('for e in EDGES_DATA:');
  p('    a, b = vkey.get(e["from"]), vkey.get(e["to"])');
  p('    if a is None or b is None: continue');
  p('    ed = Edge.ByStartVertexEndVertex(a, b, tolerance=TOL)');
  p('    if ed:');
  p('        Topology.SetDictionary(ed, make_dict(e["dict"]))');
  p('        gedges.append(ed)');
  p('g = Graph.ByVerticesEdges(gverts, gedges)');
  p('print(f"  Graph: {len(Graph.Vertices(g))} vertices, {len(Graph.Edges(g))} edges")');
  p('');
  p('# ---- STEP 7: Assign Dicts to Graph vertices ------------------------');
  p('print("\\nStep 7 - Assigning Dictionaries to Graph vertices...")');
  p('node_lkp = {}');
  p('for nd in NODES_DATA:');
  p('    cx,cy,cz = nd["centroid"]; node_lkp[centroid_key(cx,cy,cz)] = nd["dict"]');
  p('n_gv = 0');
  p('for gv in Graph.Vertices(g):');
  p('    ck = centroid_key(Vertex.X(gv), Vertex.Y(gv), Vertex.Z(gv))');
  p('    payload = node_lkp.get(ck)');
  p('    if payload: Topology.SetDictionary(gv, make_dict(payload)); n_gv += 1');
  p('print(f"  Assigned {n_gv}/{len(gverts)} Graph vertices")');
  p('');

  // Governance
  p('# ---- STEP 8: GOVERNANCE ANALYSIS -----------------------------------');
  p('print("\\n"+"="*58)');
  p('print("TECTONIC GOVERNANCE ANALYSIS")');
  p('print("="*58)');
  p('');
  p('regs = sorted({pl["dict"]["register_id"] for pl in PLATES_DATA})');
  p('');
  p('# Gov-0: Stratum presence — every used register carries plates');
  p('print("\\n[Gov-0] Stratum Continuity")');
  p('by_reg = defaultdict(int)');
  p('for pl in PLATES_DATA: by_reg[pl["dict"]["register_id"]] += 1');
  p('for r in regs: print(f"  Register {r} ({pl_name(r)}): {by_reg[r]} plates")');
  p('grounded = 0 in by_reg');
  p('print(f"  Datum (register 0) present: {grounded}")');
  p('');
  p('# Gov-1: Fin support — stepped/reveal adjacencies backed by a Fin');
  p('print("\\n[Gov-1] Fin Support")');
  p('stepped = [e for e in EDGES_DATA if e["dict"]["relation"] in ("stepped","reveal")]');
  p('print(f"  Stepped/reveal adjacencies: {len(stepped)}")');
  p('print(f"  Derived Fin Faces         : {len(FINS_DATA)}")');
  p('print(f"  Backed (1:1 expected)     : {min(len(stepped), len(FINS_DATA))}")');
  p('');
  p('# Gov-2: Slenderness — flag sliver cells (discretisation quality)');
  p('print("\\n[Gov-2] Slenderness / Sliver Check")');
  p('ars = [pl["dict"]["aspect_ratio"] for pl in PLATES_DATA]');
  p('slivers = [a for a in ars if a > 8]');
  p('print(f"  Mean aspect ratio:{sum(ars)/max(len(ars),1):.2f}  Max:{max(ars):.2f}  Slivers(>8):{len(slivers)}")');
  p('');
  p('# Gov-3: Coverage per register');
  p('print("\\n[Gov-3] Coverage per Register")');
  p('area_by_reg = defaultdict(float)');
  p('for pl in PLATES_DATA: area_by_reg[pl["dict"]["register_id"]] += pl["dict"]["area_m2"]');
  p('for r in regs:');
  p('    cov = area_by_reg[r] / (DW*DD)');
  p('    bar = chr(9608)*int(cov*20)');
  p('    print(f"  R{r} {bar:<20s} {area_by_reg[r]:8.1f} m2 = {cov:.1%}")');
  p('');
  p('# Gov-4: Depth coherence (subdivision-depth distribution)');
  p('print("\\n[Gov-4] Subdivision Depth Coherence")');
  p('depths = defaultdict(int)');
  p('for pl in PLATES_DATA: depths[pl["dict"]["subdiv_depth"]] += 1');
  p('for d in sorted(depths): print(f"  depth {d}: {depths[d]} cells")');
  p('');
  p('# Gov-5: Register distribution');
  p('print("\\n[Gov-5] Register Distribution")');
  p('for r in regs:');
  p('    solids = sum(1 for pl in PLATES_DATA if pl["dict"]["register_id"]==r and pl["dict"]["realisation"]=="solid")');
  p('    frames = by_reg[r] - solids');
  p('    print(f"  {pl_name(r):<10s} solid:{solids}  frame:{frames}")');
  p('');
  p('# Gov-6: Adjacency graph metrics');
  p('print("\\n[Gov-6] Adjacency Graph Metrics")');
  p('ds = Graph.DegreeSequence(g)');
  p('if ds: print(f"  Vertices:{len(ds)}  Avg degree:{sum(ds)/len(ds):.2f}  Max:{max(ds)}  Min:{min(ds)}")');
  p('try:');
  p('    bc = Graph.BetweennessCentrality(g)');
  p('    if bc:');
  p('        mx = max(bc); hub = Graph.Vertices(g)[bc.index(mx)]');
  p('        print(f"  Highest betweenness:{mx:.4f}  register={get_val(hub,\'register\')}")');
  p('except Exception as ex: print(f"  betweenness skipped ({ex})")');
  p('');
  p('# Gov-7: Reveal inventory');
  p('print("\\n[Gov-7] Reveal Inventory")');
  p('reveals = [f for f in FINS_DATA if f["dict"].get("reveal")]');
  p('tot_len = sum(f["dict"]["length_m"] for f in reveals)');
  p('max_step = max([f["dict"]["step_m"] for f in FINS_DATA], default=0)');
  p('print(f"  Reveals:{len(reveals)}  Total length:{tot_len:.1f} m  Max step:{max_step:.2f} m")');
  p('');
  p('print("\\n"+"="*58)');
  p('print("SUMMARY")');
  p('print("="*58)');
  p('print(f"  Cells:{len(cells)}  Fins:{len(fin_faces)}  Strata:{len(STRATA_DATA)}")');
  p('if ds: print(f"  Graph avg degree: {sum(ds)/len(ds):.2f}  components via Graph.ConnectedComponents")');
  p('print("="*58)');
  p('print("\\nExtension points:")');
  p('print("  Topology.SelfMerge(cluster)         -> fuse touching plates into a CellComplex")');
  p('print("  CellComplex.ExternalFaces(cc)       -> facade / envelope extraction")');
  p('print("  Graph.MinimumSpanningTree(g)        -> primary structural circuit")');
  p('print("  Graph.CommunityPartition(g,key=...) -> register clustering")');

  const py = L.join('\n');
  dl(py, 'tectonic_topologic_gen' + String(gen).padStart(3, '0') + '_' + DW + 'x' + DD + '.py', 'text/plain');
  log('ok', 'TopologicPy export: ' + plates.length + ' plates · ' + fins.length + ' fins · ' + graphData.edges.length + ' adjacencies');
}

function exportJSON(){
  const out = {
    meta:{
      tool:'tectonic-discretiser', generation:gen, plot_m:[DW, DD],
      registers:REG, z_step_m:ZSTEP, plate_thickness_m:THICK, reveal_threshold_m:REVEAL,
      params:{ MIND, MAXD, MINC, SPLITP, FALLOFF, RHYTHM, COMBP, COMBN, OPENR, STRAT, AXBIAS },
      seed:_seed,
    },
    strata,
    plates:plates.map(p => ({ bbox_min:[p.x, p.y, p.z], bbox_max:[p.x + p.w, p.y + p.d, p.z + THICK], centroid:[p.cx, p.cy, p.z + THICK / 2], open:p.open, dict:p.dict, id:p.id })),
    fins:fins.map(f => ({ verts:f.verts, dict:f.dict })),
    graph:{ nodes:graphData.nodes, edges:graphData.edges, stats:graphData.stats },
  };
  dl(JSON.stringify(out, null, 2), 'tectonic_gen' + String(gen).padStart(3, '0') + '_' + DW + 'x' + DD + '.json', 'application/json');
  log('ok', 'JSON export done');
}

// ── tiny download helper ────────────────────────────────────────────────
function dl(text, name, mime){
  const blob = new Blob([text], { type:mime });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
}

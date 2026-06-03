#!/usr/bin/env python3
"""
governance.py
Standalone TopologicPy governance analysis for the Tectonic Discretiser.

Usage:
    python governance.py <export_json>

The JSON file is produced by the app's "Export Raw JSON (debug)" button.
This script rebuilds the tectonic model as real topologicpy objects and runs
eight governance checks (Gov-0 .. Gov-7).

ONTOLOGY (structure is DERIVED, never assigned)
================================================
    Plate    -> a thin topologicpy.Cell (box z .. z+THICK) at its register
    Fin      -> a topologicpy.Face on a boundary shared by two plates at
                different registers (a Reveal when the Z step >= REVEAL)
    Stratum  -> the datum plane of one register (reported, not built)
    Graph    -> leaf adjacency via Graph.ByVerticesEdges

Unlike a manifold CellComplex, layered plates rarely share faces, so the model
is a Cluster and the adjacency Graph is built from the analytic adjacency that
the partition already knows (carried in the JSON), rather than recovered from
geometry. This mirrors the in-app export exactly.

Requires: topologicpy (pip install topologicpy)
"""

import json
import sys
import math
from collections import defaultdict

from topologicpy.Vertex     import Vertex
from topologicpy.Edge       import Edge
from topologicpy.Face       import Face
from topologicpy.Cell       import Cell
from topologicpy.Cluster    import Cluster
from topologicpy.Graph      import Graph
from topologicpy.Dictionary import Dictionary
from topologicpy.Topology   import Topology


# ─────────────────────────────────────────────────────────────────────────
#  LOAD JSON
# ─────────────────────────────────────────────────────────────────────────

def load_export(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


# ─────────────────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────────────────

TOL = 0.001

def v3(pt):
    return Vertex.ByCoordinates(float(pt[0]), float(pt[1]), float(pt[2]))

def centroid_key(x, y, z, tol=0.05):
    return (round(x / tol) * tol, round(y / tol) * tol, round(z / tol) * tol)

def make_dict(d: dict):
    keys   = [str(k) for k in d.keys()]
    values = [v if isinstance(v, (int, float, bool, str)) else str(v)
              for v in d.values()]
    return Dictionary.ByKeysValues(keys, values)

def get_val(topo, key):
    d = Topology.Dictionary(topo)
    return Dictionary.ValueAtKey(d, key) if d else None

def pl_name(names, r):
    return names[r] if 0 <= r < len(names) else f"R{r}"

def cuboid_cell(mn, mx):
    x0, y0, z0 = float(mn[0]), float(mn[1]), float(mn[2])
    x1, y1, z1 = float(mx[0]), float(mx[1]), float(mx[2])
    faces = [
        Face.ByVertices([v3([x0,y0,z0]), v3([x1,y0,z0]), v3([x1,y1,z0]), v3([x0,y1,z0])]),
        Face.ByVertices([v3([x0,y0,z1]), v3([x1,y0,z1]), v3([x1,y1,z1]), v3([x0,y1,z1])]),
        Face.ByVertices([v3([x0,y0,z0]), v3([x1,y0,z0]), v3([x1,y0,z1]), v3([x0,y0,z1])]),
        Face.ByVertices([v3([x0,y1,z0]), v3([x1,y1,z0]), v3([x1,y1,z1]), v3([x0,y1,z1])]),
        Face.ByVertices([v3([x0,y0,z0]), v3([x0,y1,z0]), v3([x0,y1,z1]), v3([x0,y0,z1])]),
        Face.ByVertices([v3([x1,y0,z0]), v3([x1,y1,z0]), v3([x1,y1,z1]), v3([x1,y0,z1])]),
    ]
    return Cell.ByFaces([f for f in faces if f], tolerance=TOL)


# ─────────────────────────────────────────────────────────────────────────
#  BUILD MODEL (Cluster + Graph)
# ─────────────────────────────────────────────────────────────────────────

def build_model(data: dict):
    meta   = data['meta']
    plates = data['plates']
    fins   = data['fins']
    strata = data['strata']
    nodes  = data['graph']['nodes']
    edges  = data['graph']['edges']
    DW, DD = meta['plot_m']
    REG    = meta['registers']
    REVEAL = meta['reveal_threshold_m']

    print(f"\nPlot: {DW}x{DD} m   Registers: {REG}   Reveal threshold: {REVEAL} m")
    print(f"Plates: {len(plates)}   Fins: {len(fins)}   Strata: {len(strata)}")
    print(f"Graph (analytic): {len(nodes)} nodes / {len(edges)} edges")

    # Step 1: plate Cells + centroid -> dict map
    cells, centroid_map = [], {}
    for pl in plates:
        c = cuboid_cell(pl['bbox_min'], pl['bbox_max'])
        if not c:
            continue
        cells.append(c)
        cx, cy, cz = pl['centroid']
        centroid_map[centroid_key(cx, cy, cz)] = pl['dict']

    # Step 2: Cluster (layered plates rarely share faces)
    print(f"\nClustering {len(cells)} plate Cells...")
    cluster = Cluster.ByTopologies(cells) if cells else None
    merged  = Topology.SelfMerge(cluster, tolerance=TOL) if cluster else None
    print(f"  Clustered {len(cells)} plates")

    # Step 3: Dicts on cells (post-cluster centroid matching)
    n_assigned = 0
    for c in cells:
        ctr = Topology.Centroid(c)
        ck  = centroid_key(Vertex.X(ctr), Vertex.Y(ctr), Vertex.Z(ctr))
        payload = centroid_map.get(ck)
        if payload:
            Topology.SetDictionary(c, make_dict(payload))
            n_assigned += 1
    print(f"  Assigned {n_assigned}/{len(cells)} Cell Dictionaries")

    # Step 4: Fin Faces
    fin_faces = []
    for fn in fins:
        face = Face.ByVertices([v3(p) for p in fn['verts']])
        if not face:
            continue
        Topology.SetDictionary(face, make_dict(fn['dict']))
        fin_faces.append(face)
    print(f"  Built {len(fin_faces)} Fin Faces")

    # Step 5-6: Graph from analytic adjacency
    gverts, vkey = [], {}
    for nd in nodes:
        v = v3(nd['centroid']); gverts.append(v); vkey[nd['id']] = v
    gedges = []
    for e in edges:
        a, b = vkey.get(e['from']), vkey.get(e['to'])
        if a is None or b is None:
            continue
        ed = Edge.ByStartVertexEndVertex(a, b, tolerance=TOL)
        if ed:
            Topology.SetDictionary(ed, make_dict(e['dict']))
            gedges.append(ed)
    g = Graph.ByVerticesEdges(gverts, gedges)
    print(f"  Graph: {len(Graph.Vertices(g))} vertices, {len(Graph.Edges(g))} edges")

    # Step 7: Dicts on graph vertices
    node_lkp = {}
    for nd in nodes:
        cx, cy, cz = nd['centroid']
        node_lkp[centroid_key(cx, cy, cz)] = nd['dict']
    n_gv = 0
    for gv in Graph.Vertices(g):
        ck = centroid_key(Vertex.X(gv), Vertex.Y(gv), Vertex.Z(gv))
        payload = node_lkp.get(ck)
        if payload:
            Topology.SetDictionary(gv, make_dict(payload))
            n_gv += 1
    print(f"  Assigned {n_gv}/{len(gverts)} Graph-vertex Dictionaries")

    return cells, fin_faces, g, plates, fins, strata, edges, meta


# ─────────────────────────────────────────────────────────────────────────
#  GOVERNANCE CHECKS
# ─────────────────────────────────────────────────────────────────────────

def run_governance(cells, fin_faces, g, plates, fins, strata, edges, meta):
    DW, DD = meta['plot_m']
    names  = ['Datum','Plinth','Mid','Cornice','Attic','Crown','Ridge','Apex']

    print('\n' + '='*60)
    print('TECTONIC GOVERNANCE ANALYSIS')
    print('='*60)

    regs = sorted({pl['dict']['register_id'] for pl in plates})
    by_reg = defaultdict(int)
    for pl in plates:
        by_reg[pl['dict']['register_id']] += 1

    # Gov-0: Stratum continuity
    print('\n[Gov-0] Stratum Continuity')
    for r in regs:
        print(f'  Register {r} ({pl_name(names, r)}): {by_reg[r]} plates')
    grounded = 0 in by_reg
    print(f'  Datum (register 0) present: {grounded}')

    # Gov-1: Fin support
    print('\n[Gov-1] Fin Support')
    stepped = [e for e in edges if e['dict']['relation'] in ('stepped', 'reveal')]
    print(f'  Stepped/reveal adjacencies: {len(stepped)}')
    print(f'  Derived Fin Faces         : {len(fins)}')
    print(f'  Backed (1:1 expected)     : {min(len(stepped), len(fins))}')

    # Gov-2: Slenderness / sliver
    print('\n[Gov-2] Slenderness / Sliver Check')
    ars = [pl['dict']['aspect_ratio'] for pl in plates]
    slivers = [a for a in ars if a > 8]
    if ars:
        print(f'  Mean aspect ratio:{sum(ars)/len(ars):.2f}  Max:{max(ars):.2f}  Slivers(>8):{len(slivers)}')

    # Gov-3: Coverage per register
    print('\n[Gov-3] Coverage per Register')
    area_by_reg = defaultdict(float)
    for pl in plates:
        area_by_reg[pl['dict']['register_id']] += pl['dict']['area_m2']
    for r in regs:
        cov = area_by_reg[r] / (DW * DD)
        bar = chr(9608) * int(cov * 20)
        print(f'  R{r} {bar:<20s} {area_by_reg[r]:8.1f} m2 = {cov:.1%}')

    # Gov-4: Subdivision depth coherence
    print('\n[Gov-4] Subdivision Depth Coherence')
    depths = defaultdict(int)
    for pl in plates:
        depths[pl['dict']['subdiv_depth']] += 1
    for d in sorted(depths):
        print(f'  depth {d}: {depths[d]} cells')

    # Gov-5: Register distribution (solid / frame)
    print('\n[Gov-5] Register Distribution')
    for r in regs:
        solids = sum(1 for pl in plates
                     if pl['dict']['register_id'] == r and pl['dict']['realisation'] == 'solid')
        frames = by_reg[r] - solids
        print(f'  {pl_name(names, r):<10s} solid:{solids}  frame:{frames}')

    # Gov-6: Adjacency graph metrics
    print('\n[Gov-6] Adjacency Graph Metrics')
    ds = Graph.DegreeSequence(g)
    if ds:
        print(f'  Vertices:{len(ds)}  Avg degree:{sum(ds)/len(ds):.2f}  Max:{max(ds)}  Min:{min(ds)}')
    try:
        bc = Graph.BetweennessCentrality(g)
        if bc:
            mx  = max(bc)
            hub = Graph.Vertices(g)[bc.index(mx)]
            print(f"  Highest betweenness:{mx:.4f}  register={get_val(hub,'register')}")
    except Exception as ex:
        print(f'  betweenness skipped ({ex})')
    try:
        Graph.ConnectedComponents(g, key='component', tolerance=TOL)
    except Exception as ex:
        print(f'  components skipped ({ex})')

    # Gov-7: Reveal inventory
    print('\n[Gov-7] Reveal Inventory')
    reveals = [f for f in fins if f['dict'].get('reveal')]
    tot_len = sum(f['dict']['length_m'] for f in reveals)
    max_step = max([f['dict']['step_m'] for f in fins], default=0)
    print(f'  Reveals:{len(reveals)}  Total length:{tot_len:.1f} m  Max step:{max_step:.2f} m')

    # Summary
    print('\n' + '='*60)
    print('SUMMARY')
    print('='*60)
    cov_total = sum(area_by_reg.values()) / (DW * DD)
    print(f'  [0] Registers used   {len(regs)}   (datum present: {grounded})')
    print(f'  [1] Fins / stepped   {len(fins)} / {len(stepped)}')
    if ars:
        print(f'  [2] Mean aspect      {sum(ars)/len(ars):.2f}   ({len(slivers)} slivers)')
    print(f'  [3] Total coverage   {cov_total:.1%}')
    if ds:
        print(f'  [6] Avg degree       {sum(ds)/len(ds):.2f}')
    print(f'  [7] Reveals          {len(reveals)}')
    print('='*60)
    print('\nExtension points:')
    print('  Topology.SelfMerge(cluster)         -> fuse touching plates into a CellComplex')
    print('  CellComplex.ExternalFaces(cc)       -> facade / envelope extraction')
    print('  Graph.MinimumSpanningTree(g)        -> primary structural circuit')
    print('  Graph.CommunityPartition(g, key=..) -> register clustering')


# ─────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print('Usage: python governance.py <export.json>')
        sys.exit(1)

    print(f'Loading: {sys.argv[1]}')
    data = load_export(sys.argv[1])

    results = build_model(data)
    run_governance(*results)


if __name__ == '__main__':
    main()

# CLAUDE.md
# Tectonic Discretiser — Project Context

## What this project is

A generative tool for producing rich, layered tectonic canvases by recursive
**discretisation** of a rectangular plot. A continuous plot is partitioned by a
seeded *split grammar*; the leaves become **plates** at discrete Z-registers,
and the **fins**, **reveals** and **strata** between them are *derived* from
plate adjacency. The visual target is the dense, fragmented, multi-depth plate
compositions of Atelier Olschinsky (Peter Olschinsky) — stacked slabs, deep
shadow-gaps, louvred slats, mixed solid/frame fields.

It is the **discrete, rectilinear, rule-rewriting** member of a three-tool
suite developed by Theo Dounas (Heriot-Watt University / Adventurous Systems
Ltd):

| Tool | Substrate | Mathematics | Pole |
|---|---|---|---|
| **CADSS** | 3D cellular automaton | discrete dynamical system | discrete / temporal |
| **Tectonic Discretiser** (this) | recursive split grammar | discrete rewriting system | discrete / spatial |
| **Flow / Lensing** | attractor field + RK4 integrator | continuous dynamical system | continuous / differential |

The pairing is deliberate: it instantiates the discrete↔continuous and
computation↔calculation axis at the centre of the monograph. The Discretiser
sits squarely in the **shape-grammar lineage** (Stiny → Knight; split grammars
after Wonka et al. 2003 and Müller et al. 2006), making the substrate a
derivation in a formal grammar rather than a sampled field.

## Repository layout

```
tectonic-discretiser/
├── index.html            Single HTML entry point; loads all JS in order
├── js/
│   ├── subdiv-engine.js  Seeded split grammar: the recursive partition
│   ├── topology.js       Tectonic derivation (plates/fins/reveals/strata) + graph
│   ├── render.js         Canvas rendering (axo / plan / strata)
│   ├── export.js         TopologicPy Python export + JSON debug export
│   └── app.js            UI orchestration, controls, readouts (load last)
├── python/
│   └── governance.py     Standalone TopologicPy governance analysis
└── CLAUDE.md             This file
```

**Script load order in index.html is mandatory:**
`subdiv-engine.js → topology.js → render.js → export.js → app.js`

All files share a single global scope (plain `<script>` tags, no ES modules).
Unlike CADSS, `subdiv-engine.js` and the derivation logic are DOM-free, so the
engine is headlessly testable; DOM readouts live only in `app.js`.

## Ontological model

The core design decision, carried verbatim from CADSS: **structure is never a
substrate type — it is derived from adjacency.**

| Topological class | Discretiser analogue | TopologicPy class |
|---|---|---|
| Cell | Plate — a realised leaf cell, a thin slab at its register | `topologicpy.Cell` |
| Face (vertical) | Fin — web on a boundary between two leaves at different registers | `topologicpy.Face` |
| Face (vertical, deep) | Reveal — a Fin whose Z-step ≥ `REVEAL` (a shadow-gap) | `topologicpy.Face` |
| Face (horizontal datum) | Stratum — the datum plane of one register | reported |
| Graph vertex | Leaf centroid | `topologicpy.Vertex` |
| Graph edge | Leaf adjacency (coplanar / stepped / reveal) | `topologicpy.Edge` |

Every element carries a `dict{}` that maps 1:1 to a `topologicpy.Dictionary`
on export.

## The split grammar (subdiv-engine.js)

A continuous plot `D = [0,DW] × [0,DD]` is recursively partitioned. Each rule
application is one of:

- `split_x(r)` / `split_y(r)` — binary division at ratio `r`
- `comb(k, axis)` — slice into `k` equal strips (the **louvre / slat** operator;
  this is what produces the corrugated, finned Olschinsky fields)
- `stop` — declare a leaf

The ratio repertoire is governed by `RHYTHM` (0 = pure bisection, 1 = harmonic
/ irregular ratios from the golden and small-integer set). Leaf register comes
from a blend of subdivision depth and spatial noise (`STRAT`); comb slats step
their register by strip index to read as corrugation. A seeded **mulberry32**
PRNG drives every choice, so a `(seed, params)` pair is a fully reproducible
design — essential for a generative *system*, not a one-off image.

Two invariants worth knowing (both were fixed during development):
- `MIND` forces a base decomposition so the root cannot terminate immediately
  on an unlucky first PRNG draw.
- `comb` children recurse while below `MIND`, so the slat operator at the root
  does not short-circuit the forced base depth.

## Derived tectonics (topology.js)

`derive()` builds:
- **Plates** — one per leaf, at `zOf(reg)`, solid or open frame (`OPENR`).
- **Fins / Reveals** — from edge-adjacency × register difference. Adjacency is
  computed with spatial bucketing to avoid an O(n²) sweep at high density. A
  step `< REVEAL` is a plain fin; `≥ REVEAL` is a reveal (shadow-gap).
- **Strata** — per-register datum planes with coverage.

`buildGraph()` produces the adjacency graph analytically (the partition already
knows it), classified `coplanar / stepped / reveal`. Ten derived **parameters**
(Granularity, Layering, Porosity, Rhythm, Reveal density, Slenderness,
Coverage, Relief, Frame ratio, Adjacency) are the tectonic analogue of CADSS's
commune signals.

## Views (render.js)

- **3D / Axo** — a true orthographic **orbit** view. Plates are extruded to
  thin boxes; faces are back-face-culled, Lambert-shaded against a fixed
  screen-space light, and painter-sorted by depth, so the massing reads
  correctly from any angle. **Drag to orbit** (azimuth + elevation), **scroll
  to zoom**; open frames draw as wire boxes; a register **cutaway** slider
  hides registers above a chosen datum.
- **Plan** — the partition seen from above; reveals draw as heavy shadow lines.
- **Strata** — an exploded register stack (the tectonic "section").

Up to **10 registers** (default 7), each a distinct colour from the active
palette (Olschinsky / Slate / Ember / Paper-ink), running cool plinth → warm
crown; two grounds (graphite / paper).

## TopologicPy export

Two functions in `export.js`, mirroring CADSS:

- **Export TopologicPy Script** — a self-contained `.py` implementing the
  pipeline below.
- **Export Raw JSON** — debug dump consumed by `governance.py`.

### Pipeline (in exported `.py` and `governance.py`)

1. `Cell.ByFaces()` thin cuboids from plate bbox coordinates
2. `Cluster.ByTopologies(cells)` + `Topology.SelfMerge` — layered plates rarely
   share faces, so a Cluster (not a CellComplex) is the honest assembly
3. Re-assign `Dictionary` to Cells by centroid matching
4. `Face.ByVertices()` Fin Faces from shared-boundary vertices; assign Dicts
5–6. `Graph.ByVerticesEdges()` from leaf centroids + **analytic** adjacency
7. Re-assign Dictionary to Graph vertices by centroid matching
8. Governance analysis (Gov-0 .. Gov-7)

**Critical note (shared with CADSS):** assembly operations silently drop
Dictionaries set before assembly; always re-assign by centroid-key matching
afterward. The Discretiser sidesteps `CellComplex.ByCells()` entirely because
the plates are intentionally non-manifold (free-floating layered slabs).

## Governance checks (python/governance.py)

| Check | Description |
|---|---|
| Gov-0 | Stratum continuity — every used register carries plates; datum present |
| Gov-1 | Fin support — stepped/reveal adjacencies backed 1:1 by a Fin Face |
| Gov-2 | Slenderness / sliver — discretisation quality (aspect-ratio outliers) |
| Gov-3 | Coverage per register |
| Gov-4 | Subdivision-depth coherence |
| Gov-5 | Register distribution (solid vs frame) |
| Gov-6 | Adjacency graph metrics (degree sequence, betweenness, components) |
| Gov-7 | Reveal inventory (count, total length, max step) |

## Running the project

Open `index.html` in a browser. No build step, no server needed.

Controls: the left panel drives the grammar (depth, split probability, rhythm,
comb/slat probability, open-frame ratio, longer-axis bias) and the register
stack (count up to 10, Z-step, thickness, reveal threshold, stratifier). In the
3D view, **drag to orbit** (azimuth + elevation) and **scroll to zoom**; the
Azim/Elev sliders do the same. **Re-roll** (R) draws a fresh seed;
**Regenerate** (G) re-runs the current seed; 1/2/3 switch views; F toggles fins.
Hover a cell in plan for its register/area/aspect.

For `governance.py`:
```bash
pip install topologicpy
python python/governance.py path/to/tectonic_gen000_60x60.json
```

## Relationship to the dissertation

This tool is intended as a worked specimen for the monograph's argument that
generative systems in architecture span a discrete↔continuous spectrum. The
Discretiser is the discrete-spatial pole (a grammar derivation, Turing-equivalent
rewriting), CADSS the discrete-temporal pole (a dynamical CA), and Flow/Lensing
the continuous pole (numerical integration of a differential field). All three
share one ontology — substrate, derived structure, semantic Dictionaries,
governance — so they can be compared on equal terms under Koutamanis's
evaluation framework.

## Related work and references

- Stiny, G. *Shape: Talking about Seeing and Doing.* MIT Press, 2006.
- Wonka, P., Wimmer, M., Sillion, F., Ribarsky, W. (2003). Instant Architecture. *ACM SIGGRAPH*.
- Müller, P., Wonka, P., Haegler, S., Ulmer, A., Van Gool, L. (2006). Procedural Modeling of Buildings. *ACM SIGGRAPH*.
- Dounas, T., Spaeth, A.B., Wu, W. & Zhang, W. (2017). Dense Urban Typologies and the Game of Life. *CAADRIA 2017*.
- TopologicPy: https://github.com/wassimj/topologicpy
- Atelier Olschinsky (visual reference): https://www.instagram.com/peter_olschinsky
```

# Flow / Lensing — developer notes

The **continuous, differential** member of the generative suite. Where CADSS is
a discrete dynamical automaton and the Tectonic Discretiser is a discrete
rewriting grammar, this tool generates form by **sampling a closed-form field**
and tracing its integral curves. It is the curvilinear dual of the other two.

It reproduces both reference images from a single field model:

| scene     | model                                   | look                                   |
|-----------|-----------------------------------------|----------------------------------------|
| `lensing` | central-force **orbits** (one attractor)| rays bend on hyperbolic arcs, fan into a caustic — gravitational light-bending |
| `binary`  | central-force **orbits** (two attractors)| a two-well lens with an L1 saddle between the masses |
| `cables`  | potential-flow **streamlines** (vortices)| braided flowing strands with vortex knots — the *Dragon Tattoo* intro |

## Why this backend (not TopologicPy)

TopologicPy is the right tool for the *discrete* members: plates, fins and
their adjacency genuinely **are** a Cell / Face / Graph complex, so the Tectonic
Discretiser exports to it directly. A velocity field and its streamlines are
**not** a cell complex — forcing curves into `Wire.ByVertices` would add
ceremony without insight. So the backend here is the appropriate scientific
stack, chosen per the principle *use the representation the mathematics asks
for*:

- **NumPy** — the vectorised velocity / force field, RK4 streamline & orbit
  integration (all seeds marched in lockstep), Jacobian critical-point
  extraction, and the warp potential.
- **NetworkX** — the **transport graph**: streamlines as nodes, *laminar* /
  *separatrix* (caustic) edges in launch order, bundle communities, graph
  metrics (components, betweenness, bundle **modularity**), and a
  **Poincaré–Hopf index tally** over the classified critical points.

The ontological commitment is unchanged from CADSS — **structure is derived,
never assigned**. The substrate emits only streamlines (and the masses that
shape them); bundles, critical points, caustics, the warp and the transport
graph are *read back out* of the field, each carrying a semantic dictionary.
NetworkX simply supplies the graph/topology layer for the continuous pole that
TopologicPy supplies for the discrete poles.

## The field

```
U(x) = U_base + Σ s_i (x−p_i)/(|x−p_i|²+ε²)      (flow mode: source +, sink −)
              + Σ c_i perp(x−p_i)/(|x−p_i|²+ε²)   (vortex)

a(x) =          Σ G s_i (p_i−x)/(|p_i−x|²+ε²)^{3/2}   (orbit mode: s>0 attracts)
```

- **flow mode** integrates `dx/dt = U(x)` — streamline following (cables).
- **orbit mode** integrates `d²x/dt² = a(x)` with the base flow as the
  injection velocity — ballistic motion in a softened central force (lensing).
  This second-order model is what produces strong hyperbolic deflection
  (α ≈ k/b, verified in Gov-2); a first-order sink merely swallows a flux-tube
  and the survivors barely bend, which is *not* lensing.

Critical points are zeros of the **governing** field: stagnation points of `U`
in flow mode, force-balance (Lagrange) points of `a` in orbit mode — hence the
single saddle that appears between the two masses in `binary`.

Softening `ε` keeps every primitive finite; `EPS`, `GSTR`, `CAP` (capture
radius = `CAP·√|s|`) and the seed/integration knobs are the design dials.

## Reproducibility

A `(seed, params, masses)` tuple is a deterministic design — NumPy's PCG64 RNG
is seeded from `Params.seed` and the integrator is otherwise deterministic.
`--json` output for a fixed seed is byte-identical across runs (verified).

## Usage

```bash
python flow_lensing.py --preset lensing --png out.png --json out.json
python flow_lensing.py --preset cables  --seed 7
python flow_lensing.py --preset binary  --no-figure          # report only
python flow_lensing.py --preset lensing --gstr 240 --eps 2.2 # sweep the dials
```

Requires `numpy`, `networkx`; `matplotlib` only for `--png`.

`build(P)` returns `(streams, crits, warp, G)` for use as a library; `to_json`
serialises the full model (streamline polylines, critical points, transport
graph) for downstream tools.

## Status / extension

- Headless backend: **complete and validated** (compiles; 3 presets run; JSON
  round-trips; deterministic).
- An interactive browser front-end mirroring the CADSS / Tectonic instruments
  could wrap this engine; a partial JS port exists (`js/field-engine.js`,
  `js/topology.js`) but predates the orbit model and would need re-syncing to
  this Python physics before use. The Python module is the authoritative
  backend.
- Natural extensions (printed by the tool): adaptive `scipy.integrate.solve_ivp`
  streamlines, `nx.minimum_spanning_tree` ray skeletons, Louvain communities for
  emergent bundles, and `np.gradient` of the potential for exact caustic
  surfaces.

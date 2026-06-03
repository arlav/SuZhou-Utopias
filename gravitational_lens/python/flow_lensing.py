#!/usr/bin/env python3
"""
flow_lensing.py  —  headless backend for the Flow / Lensing generator.

This is the *continuous, differential* member of the generative suite (the
duals being CADSS, a discrete dynamical automaton, and the Tectonic
Discretiser, a discrete rewriting grammar). Where those tools are naturally
expressed as TopologicPy Cell/Face/Graph complexes, a velocity field and its
streamlines are not — so the backend here is the appropriate scientific stack:

    NumPy     — the vectorised velocity field, RK4 streamline integration,
                Jacobian critical-point extraction, and the warp potential.
    NetworkX  — the *transport graph*: streamlines as nodes, laminar /
                separatrix (caustic) edges, bundle communities, and the
                topological bookkeeping (components, betweenness, modularity,
                and a Poincare-Hopf index tally over the critical points).

THE FIELD AS A GENERATIVE SUBSTRATE
===================================
The velocity at a point is a superposition of potential-flow primitives:

    U(x) = U_base
         + Σ_i  s_i · (x − p_i) / (|x − p_i|² + ε²)        (source +, sink −)
         + Σ_i  c_i · perp(x − p_i) / (|x − p_i|² + ε²)     (vortex)

A streamline is an integral curve dx/dt = U(x), traced by classical RK4. The
same field reproduces both reference images:
  · gravitational lensing — uniform flow past a central SINK (s < 0); rays
    bend inward, a captured core falls through the horizon, the rest fan out.
  · flowing cables         — a source/sink released into vortices: smooth meanders.

STRUCTURE IS DERIVED, NEVER ASSIGNED
====================================
The substrate emits only streamlines (and the masses that shape them). Bundles,
critical points, caustics and the warp are *read back out* of the field, each
carrying a semantic dictionary — the same ontological commitment as CADSS.

REPRODUCIBILITY
===============
A (seed, params, masses) tuple is a deterministic design: numpy's PCG64 RNG is
seeded from `Params.seed`, and the integrator is otherwise deterministic.

Usage
-----
    python flow_lensing.py --preset lensing --png out.png --json out.json
    python flow_lensing.py --preset cables --seed 7 --nseed 30
    python flow_lensing.py --preset binary --no-figure        # report only

Requires: numpy, networkx; matplotlib only for --png (optional).
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field, asdict

import numpy as np
import networkx as nx


# ─────────────────────────────────────────────────────────────────────────
#  PARAMETERS
# ─────────────────────────────────────────────────────────────────────────

BNAMES = ['Captured', 'Deflected +', 'Through', 'Deflected −', 'Trapped']
BCOLORS = ['#c0392b', '#f2c14e', '#e9e2cf', '#e8772e', '#9b59b6']


@dataclass
class Params:
    # domain (abstract units, ~16:9)
    DW: float = 120.0
    DD: float = 68.0
    # integration model
    #   'flow'  — first order  dx/dt = U(x)            (streamline following: cables)
    #   'orbit' — second order d²x/dt² = a(x)          (central-force rays: lensing)
    MODE: str = 'flow'
    # base flow
    BFLOW: str = 'uniform'          # 'uniform' | 'shear' | 'none'
    BSPEED: float = 6.0
    BANG: float = 0.0               # degrees, 0 = +x
    # field shaping
    GSTR: float = 45.0              # global strength of the source/sink terms
    VORT: float = 0.0               # global vortex add per mass
    EPS: float = 1.2                # softening length
    CAP: float = 1.7                # capture-radius factor: horizon = CAP·sqrt(|s|)
    # seeds
    NSEED: int = 46
    SEEDMODE: str = 'line'          # 'line' | 'fan' | 'ring'
    SPREAD: float = 0.9
    EMITX: float = 6.0
    EMITY: float = 34.0
    JIT: float = 0.0
    # integration
    STEPS: int = 1400
    DT: float = 0.06
    SUB: int = 2                    # store every SUB-th point
    # fate-class threshold (radians): |turn| above this is a deflection
    TT: float = 0.16
    # reproducibility
    seed: int = 424242
    # masses: list of (x, y, s, c)
    masses: list = field(default_factory=list)


def preset(name: str) -> Params:
    """Return a tuned Params for a named scene.

    In 'flow' mode  s<0 is a sink (attracting inflow), s>0 a source.
    In 'orbit' mode s is the gravitational charge: s>0 attracts (a lens).
    """
    if name == 'lensing':
        p = Params(MODE='orbit', BFLOW='uniform', BSPEED=6.0, GSTR=300.0,
                   EPS=1.8, CAP=1.5, SEEDMODE='line', SPREAD=0.95, NSEED=41,
                   STEPS=1800, DT=0.04)
        p.masses = [(p.DW * 0.50, p.DD * 0.50, 1.0, 0.0)]      # central lens (attractor)
    elif name == 'cables':
        p = Params(MODE='flow', BFLOW='uniform', BSPEED=6.0, GSTR=42.0,
                   VORT=0.0, EPS=2.8, CAP=0.9, SEEDMODE='line', SPREAD=0.82,
                   NSEED=44, STEPS=1600, DT=0.06)
        p.masses = [
            (p.DW * 0.28, p.DD * 0.40, -0.10,  2.8),           # vortex (swirl, negligible inflow)
            (p.DW * 0.52, p.DD * 0.60, -0.08, -3.0),           # counter-vortex (braids the strands)
            (p.DW * 0.78, p.DD * 0.44, -0.12,  2.2),           # mild sink + swirl gathers the tails
        ]
    elif name == 'binary':
        p = Params(MODE='orbit', BFLOW='uniform', BSPEED=6.5, GSTR=210.0,
                   EPS=1.6, CAP=1.4, SEEDMODE='line', SPREAD=0.95, NSEED=61,
                   STEPS=1800, DT=0.04)
        p.masses = [
            (p.DW * 0.40, p.DD * 0.44, 0.85, 0.0),
            (p.DW * 0.60, p.DD * 0.58, 0.85, 0.0),
        ]
    else:
        raise ValueError(f'unknown preset {name!r} (lensing | cables | binary)')
    return p


# ─────────────────────────────────────────────────────────────────────────
#  VELOCITY FIELD  (vectorised over a stack of points)
# ─────────────────────────────────────────────────────────────────────────

def mass_arrays(P: Params):
    if not P.masses:
        z = np.zeros((0,))
        return z, z, z, z
    M = np.asarray(P.masses, dtype=float)
    return M[:, 0], M[:, 1], M[:, 2], M[:, 3]


def base_flow(xy: np.ndarray, P: Params) -> np.ndarray:
    """Uniform / shear / none base flow. xy: (...,2) → (...,2)."""
    out = np.zeros_like(xy)
    if P.BFLOW == 'none':
        return out
    a = math.radians(P.BANG)
    if P.BFLOW == 'shear':
        t = (xy[..., 1] / P.DD - 0.5) * 0.9
        out[..., 0] = P.BSPEED * np.cos(a + t)
        out[..., 1] = P.BSPEED * np.sin(a + t)
    else:
        out[..., 0] = P.BSPEED * math.cos(a)
        out[..., 1] = P.BSPEED * math.sin(a)
    return out


def field(xy: np.ndarray, P: Params) -> np.ndarray:
    """Velocity at each point. xy: (N,2) → (N,2)."""
    xy = np.atleast_2d(np.asarray(xy, dtype=float))
    U = base_flow(xy, P)
    mx, my, ms, mc = mass_arrays(P)
    if mx.size:
        dx = xy[:, 0:1] - mx[None, :]                 # (N, M)
        dy = xy[:, 1:2] - my[None, :]
        r2 = dx * dx + dy * dy + P.EPS * P.EPS
        w = P.GSTR / r2
        s = ms[None, :]
        c = mc[None, :] + P.VORT
        U[:, 0] += np.sum(s * w * dx - c * w * dy, axis=1)
        U[:, 1] += np.sum(s * w * dy + c * w * dx, axis=1)
    return U


def speed(xy: np.ndarray, P: Params) -> np.ndarray:
    U = field(xy, P)
    return np.hypot(U[:, 0], U[:, 1])


def horizon_of(s: float, P: Params) -> float:
    return P.CAP * math.sqrt(max(1e-4, abs(s)))


def accel(xy: np.ndarray, P: Params) -> np.ndarray:
    """Softened central-force acceleration a = Σ G·s_i·(p_i − x)/(r²+ε²)^{3/2}.
    Used in 'orbit' mode; s_i > 0 attracts. xy: (N,2) → (N,2)."""
    xy = np.atleast_2d(np.asarray(xy, dtype=float))
    A = np.zeros_like(xy)
    mx, my, ms, mc = mass_arrays(P)
    if mx.size:
        dx = mx[None, :] - xy[:, 0:1]                 # toward the mass
        dy = my[None, :] - xy[:, 1:2]
        r2 = dx * dx + dy * dy + P.EPS * P.EPS
        inv = (P.GSTR * ms[None, :]) / (r2 ** 1.5)
        A[:, 0] += np.sum(inv * dx, axis=1)
        A[:, 1] += np.sum(inv * dy, axis=1)
    return A


def motion_field(xy: np.ndarray, P: Params) -> np.ndarray:
    """The field whose zeros are the scene's critical points:
    the velocity field U in 'flow' mode, the force field a in 'orbit' mode
    (so orbit critical points are the Lagrange / force-balance points)."""
    return accel(xy, P) if P.MODE == 'orbit' else field(xy, P)


# ─────────────────────────────────────────────────────────────────────────
#  STREAMLINE INTEGRATION  (RK4, all seeds marched in lockstep)
# ─────────────────────────────────────────────────────────────────────────

def _rk4_flow(X: np.ndarray, h: float, P: Params) -> np.ndarray:
    k1 = field(X, P)
    k2 = field(X + 0.5 * h * k1, P)
    k3 = field(X + 0.5 * h * k2, P)
    k4 = field(X + h * k3, P)
    return X + (h / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)


def _rk4_orbit(X: np.ndarray, V: np.ndarray, h: float, P: Params):
    k1x, k1v = V, accel(X, P)
    k2x, k2v = V + 0.5 * h * k1v, accel(X + 0.5 * h * k1x, P)
    k3x, k3v = V + 0.5 * h * k2v, accel(X + 0.5 * h * k2x, P)
    k4x, k4v = V + h * k3v, accel(X + h * k3x, P)
    Xn = X + (h / 6.0) * (k1x + 2 * k2x + 2 * k3x + k4x)
    Vn = V + (h / 6.0) * (k1v + 2 * k2v + 2 * k3v + k4v)
    return Xn, Vn


def integrate_all(seeds: np.ndarray, P: Params) -> list[dict]:
    """Trace every seed once (mode-aware), all marched in lockstep.

    'flow'  follows the velocity field; 'orbit' integrates ballistic motion in
    the central-force field with the base flow as the injection velocity.
    """
    M = seeds.shape[0]
    X = seeds.copy()
    orbit = (P.MODE == 'orbit')
    if orbit:
        a = math.radians(P.BANG)
        V = np.tile([P.BSPEED * math.cos(a), P.BSPEED * math.sin(a)], (M, 1)).astype(float)
    mx, my, ms, mc = mass_arrays(P)
    horizons = np.array([horizon_of(s, P) for s in ms]) if ms.size else np.zeros((0,))
    pad = 5.0

    pts = [[seeds[i].tolist()] for i in range(M)]
    fate = ['exited'] * M
    nearest = np.full(M, -1, dtype=int)
    minB = np.full(M, np.inf)
    arc = np.zeros(M)
    turn = np.zeros(M)
    maxc = np.zeros(M)
    prev = np.full((M, 2), np.nan)
    active = np.ones(M, dtype=bool)

    for step in range(P.STEPS):
        if not active.any():
            break
        idx = np.where(active)[0]

        # stalled (stagnation) — flow speed vanishes; in orbit, velocity vanishes
        spv = (V[idx] if orbit else field(X[idx], P))
        sp = np.hypot(spv[:, 0], spv[:, 1])
        for li, gi in enumerate(idx):
            if sp[li] < 1e-4:
                fate[gi] = 'stalled'
                active[gi] = False

        idx = np.where(active)[0]
        if idx.size == 0:
            break

        # closest approach + capture
        if mx.size:
            dx = X[idx, 0:1] - mx[None, :]
            dy = X[idx, 1:2] - my[None, :]
            d = np.hypot(dx, dy)
            dmin = d.min(axis=1)
            amin = d.argmin(axis=1)
            upd = dmin < minB[idx]
            minB[idx[upd]] = dmin[upd]
            nearest[idx[upd]] = amin[upd]
            captured = (d < horizons[None, :]).any(axis=1)
            for li, gi in enumerate(idx):
                if captured[li]:
                    fate[gi] = 'captured'
                    nearest[gi] = int(amin[li])
                    active[gi] = False

        idx = np.where(active)[0]
        if idx.size == 0:
            break

        if orbit:
            Xn, Vn = _rk4_orbit(X[idx], V[idx], P.DT, P)
        else:
            Xn = _rk4_flow(X[idx], P.DT, P)
        seg = Xn - X[idx]
        seglen = np.hypot(seg[:, 0], seg[:, 1])
        arc[idx] += seglen

        pv = prev[idx]
        have = ~np.isnan(pv[:, 0])
        if have.any():
            aa = pv[have]
            bb = seg[have]
            dot = aa[:, 0] * bb[:, 0] + aa[:, 1] * bb[:, 1]
            crs = aa[:, 0] * bb[:, 1] - aa[:, 1] * bb[:, 0]
            dth = np.arctan2(crs, dot)
            gi = idx[have]
            turn[gi] += dth
            sl = seglen[have]
            ok = sl > 1e-6
            maxc[gi[ok]] = np.maximum(maxc[gi[ok]], np.abs(dth[ok]) / sl[ok])
        prev[idx] = seg

        X[idx] = Xn
        if orbit:
            V[idx] = Vn
        if step % P.SUB == 0:
            for gi in idx:
                pts[gi].append(X[gi].tolist())

        ox = (X[idx, 0] < -pad) | (X[idx, 0] > P.DW + pad)
        oy = (X[idx, 1] < -pad) | (X[idx, 1] > P.DD + pad)
        out = ox | oy
        for li, gi in enumerate(idx):
            if out[li]:
                fate[gi] = 'exited'
                active[gi] = False

    streams = []
    for i in range(M):
        pts[i].append(X[i].tolist())
        arr = np.asarray(pts[i])
        mb = -1.0 if not np.isfinite(minB[i]) else float(minB[i])
        denom = max(1e-6, arr.shape[0] * P.SUB * P.DT)
        streams.append(dict(
            id=i, pts=arr, fate=fate[i], nearest=int(nearest[i]),
            minB=mb, arc=float(arc[i]), maxCurv=float(maxc[i]),
            turn=float(turn[i]), meanU=float(arc[i] / denom),
        ))
    return streams


# ─────────────────────────────────────────────────────────────────────────
#  SEED SET
# ─────────────────────────────────────────────────────────────────────────

def seed_points(P: Params) -> np.ndarray:
    rng = np.random.default_rng(P.seed)
    out = []
    if P.SEEDMODE == 'line':
        y0 = P.DD * (0.5 - P.SPREAD / 2)
        y1 = P.DD * (0.5 + P.SPREAD / 2)
        for i in range(P.NSEED):
            t = 0.5 if P.NSEED == 1 else i / (P.NSEED - 1)
            out.append([1.5 + (rng.random() - 0.5) * P.JIT,
                        y0 + t * (y1 - y0) + (rng.random() - 0.5) * P.JIT])
    else:
        full = 2 * math.pi if P.SEEDMODE == 'ring' else math.pi * P.SPREAD
        base = math.radians(P.BANG) - full / 2
        rad = 2.5 if P.SEEDMODE == 'ring' else 0.4
        for i in range(P.NSEED):
            a = base + (full / 2 if P.NSEED == 1 else full * i / (P.NSEED - 1))
            out.append([P.EMITX + math.cos(a) * rad + (rng.random() - 0.5) * P.JIT,
                        P.EMITY + math.sin(a) * rad + (rng.random() - 0.5) * P.JIT])
    return np.asarray(out, dtype=float)


def generate(P: Params) -> list[dict]:
    return integrate_all(seed_points(P), P)


# ─────────────────────────────────────────────────────────────────────────
#  BUNDLE CLASSIFICATION  (fate-class of a streamline)
# ─────────────────────────────────────────────────────────────────────────

def bundle_of(s: dict, P: Params) -> int:
    if s['fate'] == 'captured':
        return 0
    if s['fate'] == 'stalled':
        return 4
    if s['turn'] > P.TT:
        return 1
    if s['turn'] < -P.TT:
        return 3
    return 2


def attach_bundles(streams: list[dict], P: Params) -> None:
    for s in streams:
        s['bundle'] = bundle_of(s, P)
        mid = s['pts'][len(s['pts']) // 2] if len(s['pts']) else (0.0, 0.0)
        s['mid'] = (float(mid[0]), float(mid[1]))


# ─────────────────────────────────────────────────────────────────────────
#  CRITICAL POINTS  (grid scan → Newton refine → Jacobian classify)
# ─────────────────────────────────────────────────────────────────────────

def jacobian(x: float, y: float, P: Params) -> np.ndarray:
    h = 1e-2
    f1 = motion_field([[x + h, y]], P)[0]
    f2 = motion_field([[x - h, y]], P)[0]
    f3 = motion_field([[x, y + h]], P)[0]
    f4 = motion_field([[x, y - h]], P)[0]
    a = (f1[0] - f2[0]) / (2 * h)   # d/dx of x-component
    b = (f3[0] - f4[0]) / (2 * h)   # d/dy of x-component
    c = (f1[1] - f2[1]) / (2 * h)
    d = (f3[1] - f4[1]) / (2 * h)
    return np.array([[a, b], [c, d]])


def classify(J: np.ndarray) -> tuple[str, int]:
    """Return (label, Poincare-Hopf index). Saddle = −1, else +1."""
    a, b = J[0]
    c, d = J[1]
    tr = a + d
    det = a * d - b * c
    disc = tr * tr - 4 * det
    if det < 0:
        return 'saddle', -1
    if disc >= 0:
        return ('node-source' if tr > 0 else 'node-sink'), +1
    if abs(tr) < 1e-2:
        return 'centre', +1
    return ('spiral-out' if tr > 0 else 'spiral-in'), +1


def find_critical_points(P: Params) -> list[dict]:
    out = []
    GX = max(20, int(P.DW / 3))
    GY = max(12, int(P.DD / 3))
    dx, dy = P.DW / GX, P.DD / GY

    # magnitude grid of the governing (motion) field for local-min screening
    gx = np.linspace(0, P.DW, GX + 1)
    gy = np.linspace(0, P.DD, GY + 1)
    XX, YY = np.meshgrid(gx, gy)
    pts = np.column_stack([XX.ravel(), YY.ravel()])
    F = motion_field(pts, P)
    mag = np.hypot(F[:, 0], F[:, 1]).reshape(YY.shape)
    scale = max(1e-6, float(np.median(mag)))
    thr = scale * 0.5

    for j in range(1, GY):
        for i in range(1, GX):
            m0 = mag[j, i]
            if m0 > thr:
                continue
            if (mag[j, i - 1] < m0 or mag[j, i + 1] < m0 or
                    mag[j - 1, i] < m0 or mag[j + 1, i] < m0):
                continue
            cx, cy = gx[i], gy[j]
            ok = False
            for _ in range(14):
                U = motion_field([[cx, cy]], P)[0]
                J = jacobian(cx, cy, P)
                det = J[0, 0] * J[1, 1] - J[0, 1] * J[1, 0]
                if abs(det) < 1e-12:
                    break
                sx = (J[1, 1] * U[0] - J[0, 1] * U[1]) / det
                sy = (-J[1, 0] * U[0] + J[0, 0] * U[1]) / det
                cx -= sx
                cy -= sy
                if cx < -5 or cx > P.DW + 5 or cy < -5 or cy > P.DD + 5:
                    break
                if math.hypot(sx, sy) < 1e-4:
                    ok = True
                    break
            if not ok or not (0 <= cx <= P.DW and 0 <= cy <= P.DD):
                continue
            res = float(np.hypot(*motion_field([[cx, cy]], P)[0]))
            if res > 0.02 * scale + 1e-6:
                continue
            if any(math.hypot(p['x'] - cx, p['y'] - cy) < 1.5 for p in out):
                continue
            J = jacobian(cx, cy, P)
            kind, index = classify(J)
            out.append(dict(
                x=float(cx), y=float(cy), kind=kind, index=index,
                trace=float(J[0, 0] + J[1, 1]),
                det=float(J[0, 0] * J[1, 1] - J[0, 1] * J[1, 0]),
            ))
    return out


# ─────────────────────────────────────────────────────────────────────────
#  WARP GRID  (rubber-sheet potential Φ = −Σ |s| / sqrt(r²+soft²))
# ─────────────────────────────────────────────────────────────────────────

def build_warp(P: Params):
    nx_ = max(18, int(P.DW / 4))
    ny_ = max(11, int(P.DD / 4))
    gx = np.linspace(0, P.DW, nx_ + 1)
    gy = np.linspace(0, P.DD, ny_ + 1)
    XX, YY = np.meshgrid(gx, gy)
    soft = max(2.0, P.EPS * 1.5)
    phi = np.zeros_like(XX)
    mx, my, ms, mc = mass_arrays(P)
    for k in range(mx.size):
        r = np.hypot(XX - mx[k], YY - my[k])
        phi -= abs(ms[k]) / np.sqrt(r * r + soft * soft)
    mn = phi.min()
    target = P.DD * 0.42
    k = (target / (-mn)) if mn < -1e-9 else 0.0
    Z = phi * k
    return dict(X=XX, Y=YY, Z=Z, phi=phi, maxDip=float(target))


# ─────────────────────────────────────────────────────────────────────────
#  TRANSPORT GRAPH  (NetworkX: streamlines + laminar/separatrix edges)
# ─────────────────────────────────────────────────────────────────────────

def build_transport_graph(streams: list[dict]) -> nx.Graph:
    G = nx.Graph()
    for s in streams:
        G.add_node(s['id'], bundle=int(s['bundle']), fate=s['fate'],
                   arc=s['arc'], turn=s['turn'], minB=s['minB'],
                   x=s['mid'][0], y=s['mid'][1])
    order = sorted(streams, key=lambda s: s['id'])
    for a, b in zip(order, order[1:]):
        sep = a['bundle'] != b['bundle']
        G.add_edge(a['id'], b['id'],
                   kind='separatrix' if sep else 'laminar',
                   turn_gap=abs(a['turn'] - b['turn']))
    return G


def bundle_communities(streams: list[dict]) -> list[set]:
    comm = {}
    for s in streams:
        comm.setdefault(s['bundle'], set()).add(s['id'])
    return list(comm.values())


# ─────────────────────────────────────────────────────────────────────────
#  GOVERNANCE  (Gov-0 .. Gov-7)
# ─────────────────────────────────────────────────────────────────────────

def governance(streams, crits, G, warp, P: Params) -> None:
    n = len(streams)
    bar = '=' * 60
    print('\n' + bar)
    print('FLOW / LENSING GOVERNANCE ANALYSIS')
    print(bar)
    print(f'Domain {P.DW:g}x{P.DD:g}   masses {len(P.masses)}   mode {P.MODE}   '
          f'base {P.BFLOW} |U|={P.BSPEED:g}   GSTR={P.GSTR:g}  EPS={P.EPS:g}  CAP={P.CAP:g}')
    print(f'Streamlines {n}   seed={P.seed}')

    # Gov-0: Conservation / finiteness — no NaN, every path integrated
    print('\n[Gov-0] Path Conservation / Finiteness')
    nan = sum(1 for s in streams if not np.all(np.isfinite(s['pts'])))
    empty = sum(1 for s in streams if len(s['pts']) < 2)
    print(f'  Non-finite paths : {nan}')
    print(f'  Degenerate paths : {empty}')
    print(f'  Mean vertices    : {np.mean([len(s["pts"]) for s in streams]):.1f}')

    # Gov-1: Capture ratio
    print('\n[Gov-1] Capture Ratio')
    cap = sum(1 for s in streams if s['fate'] == 'captured')
    trp = sum(1 for s in streams if s['fate'] == 'stalled')
    print(f'  Captured (through horizon): {cap}/{n} = {cap/max(n,1):.1%}')
    print(f'  Trapped  (stagnation)     : {trp}/{n} = {trp/max(n,1):.1%}')

    # Gov-2: Deflection budget — weak-lensing law α ≈ k / b
    print('\n[Gov-2] Deflection Budget  (expect |turn| ∝ 1/impact)')
    defl = [s for s in streams if s['fate'] == 'exited' and s['minB'] > 0]
    if len(defl) >= 3:
        b = np.array([s['minB'] for s in defl])
        a = np.abs([s['turn'] for s in defl])
        inv = 1.0 / b
        if np.std(inv) > 1e-9 and np.std(a) > 1e-9:
            r = float(np.corrcoef(inv, a)[0, 1])
            k = float(np.polyfit(inv, a, 1)[0])
            print(f'  Pearson r(1/b, |turn|) : {r:+.3f}   (→1 confirms the law)')
            print(f'  Implied constant k     : {k:.2f}  rad·m')
        print(f'  Mean |turn|            : {np.mean(a):.3f} rad ({math.degrees(np.mean(a)):.1f}°)')
        print(f'  Max  |turn|            : {np.max(a):.3f} rad ({math.degrees(np.max(a)):.1f}°)')
    else:
        print('  too few deflected rays to fit')

    # Gov-3: Smoothness — curvature distribution / G1 kinks
    print('\n[Gov-3] Smoothness  (max curvature per path)')
    mc = np.array([s['maxCurv'] for s in streams])
    kinks = int(np.sum(mc > 1.0))
    print(f'  Mean max-curvature : {mc.mean():.4f}  rad/m')
    print(f'  95th pct           : {np.percentile(mc, 95):.4f}')
    print(f'  Kinks (>1.0)       : {kinks}')

    # Gov-4: Caustics — separatrix edges in the launch continuum
    print('\n[Gov-4] Caustics  (separatrix crossings in launch order)')
    sep = [e for e in G.edges(data=True) if e[2]['kind'] == 'separatrix']
    print(f'  Separatrix edges   : {len(sep)}')
    fams = len(sep) + 1
    print(f'  Laminar families   : {fams}')

    # Gov-5: Bundle distribution
    print('\n[Gov-5] Bundle Distribution')
    counts = [0] * 5
    for s in streams:
        counts[s['bundle']] += 1
    for bnd in range(5):
        if counts[bnd] == 0:
            continue
        frac = counts[bnd] / max(n, 1)
        blk = chr(9608) * int(frac * 24)
        print(f'  {BNAMES[bnd]:<12s} {blk:<24s} {counts[bnd]:3d} = {frac:.1%}')

    # Gov-6: Transport-graph metrics  (NetworkX)
    print('\n[Gov-6] Transport-Graph Metrics')
    print(f'  Nodes / edges      : {G.number_of_nodes()} / {G.number_of_edges()}')
    print(f'  Components         : {nx.number_connected_components(G)}')
    if G.number_of_nodes():
        degs = [d for _, d in G.degree()]
        print(f'  Avg / max degree   : {np.mean(degs):.2f} / {max(degs)}')
    if G.number_of_edges():
        try:
            bc = nx.betweenness_centrality(G)
            hub = max(bc, key=bc.get)
            print(f'  Peak betweenness   : {bc[hub]:.3f}  at streamline #{hub}')
        except Exception as ex:
            print(f'  betweenness skipped ({ex})')
        try:
            comms = bundle_communities(streams)
            Q = nx.algorithms.community.modularity(G, comms)
            print(f'  Bundle modularity  : {Q:+.3f}  (laminar coherence of bundles)')
        except Exception as ex:
            print(f'  modularity skipped ({ex})')

    # Gov-7: Critical-point inventory + Poincare-Hopf index tally
    print('\n[Gov-7] Critical-Point Inventory')
    if crits:
        kinds = {}
        for c in crits:
            kinds[c['kind']] = kinds.get(c['kind'], 0) + 1
        for kd in sorted(kinds):
            print(f'  {kd:<12s} : {kinds[kd]}')
        idx_sum = sum(c['index'] for c in crits)
        print(f'  Index tally Σ      : {idx_sum:+d}  (saddle −1, node/spiral/centre +1)')
    else:
        print('  none located in the domain interior')

    # Summary
    print('\n' + bar)
    print('SUMMARY')
    print(bar)
    print(f'  [1] Captured       {cap}/{n}  ({cap/max(n,1):.0%})')
    print(f'  [4] Caustics       {len(sep)}  → {fams} families')
    print(f'  [6] Graph          {G.number_of_nodes()}n / {G.number_of_edges()}e, '
          f'{nx.number_connected_components(G)} comp')
    print(f'  [7] Critical pts   {len(crits)}')
    print(bar)
    print('\nExtension points:')
    print('  nx.minimum_spanning_tree(G)            -> primary ray skeleton')
    print('  nx.algorithms.community.louvain_communities(G) -> emergent bundles')
    print('  scipy.integrate.solve_ivp(field, ...)  -> adaptive high-order streamlines')
    print('  np.gradient(potential)                 -> exact warp normals / caustic surface')


# ─────────────────────────────────────────────────────────────────────────
#  FIGURE  (matplotlib, optional)
# ─────────────────────────────────────────────────────────────────────────

def render_figure(streams, crits, warp, P: Params, path: str) -> None:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Circle

    bgd = '#0d0d0f'
    fig, (axF, axW, axP) = plt.subplots(1, 3, figsize=(18, 5.2), facecolor=bgd)
    fig.subplots_adjust(left=0.03, right=0.99, top=0.9, bottom=0.1, wspace=0.14)

    mx, my, ms, mc = mass_arrays(P)

    # ── Field view ──
    axF.set_facecolor(bgd)
    for s in streams:
        pts = s['pts']
        axF.plot(pts[:, 0], pts[:, 1], '-', lw=0.8, alpha=0.9,
                 color=BCOLORS[s['bundle']], solid_capstyle='round')
    for k in range(mx.size):
        h = horizon_of(ms[k], P)
        axF.add_patch(Circle((mx[k], my[k]), h, fill=True, color='#c0392b',
                             alpha=0.35, zorder=5))
        axF.add_patch(Circle((mx[k], my[k]), h, fill=False, ec='#e74c3c',
                             lw=1.2, zorder=6))
        axF.plot([mx[k]], [my[k]], 'o', ms=3, color='#f5d76e', zorder=7)
    for c in crits:
        mk = 'x' if c['kind'] == 'saddle' else '+'
        axF.plot([c['x']], [c['y']], mk, ms=8, mew=1.4, color='#7898b8', zorder=8)
    axF.set_xlim(0, P.DW); axF.set_ylim(0, P.DD); axF.set_aspect('equal')
    axF.set_title('FIELD — streamlines by bundle', color='#c8a046',
                  fontsize=9, family='monospace', loc='left')
    _strip(axF)

    # ── Warp view ──  potential depth + a few streamlines
    axW.set_facecolor(bgd)
    im = axW.contourf(warp['X'], warp['Y'], warp['phi'], levels=18, cmap='magma')
    axW.contour(warp['X'], warp['Y'], warp['phi'], levels=10,
                colors='#000000', linewidths=0.3, alpha=0.4)
    for s in streams[::3]:
        pts = s['pts']
        axW.plot(pts[:, 0], pts[:, 1], '-', lw=0.5, alpha=0.55, color='#e9e2cf')
    axW.set_xlim(0, P.DW); axW.set_ylim(0, P.DD); axW.set_aspect('equal')
    axW.set_title('WARP — gravitational potential', color='#c8a046',
                  fontsize=9, family='monospace', loc='left')
    _strip(axW)

    # ── Phase view ──  impact parameter vs net turn
    axP.set_facecolor(bgd)
    for s in streams:
        if s['minB'] < 0:
            continue
        axP.plot([s['minB']], [math.degrees(s['turn'])], 'o', ms=4,
                 color=BCOLORS[s['bundle']], alpha=0.9)
    axP.axhline(0, color='#26262e', lw=0.6)
    axP.set_xlabel('impact parameter  b  (m)', color='#8a8a8a',
                   fontsize=7, family='monospace')
    axP.set_ylabel('net deflection  (deg)', color='#8a8a8a',
                   fontsize=7, family='monospace')
    axP.set_title('PHASE — deflection vs impact', color='#c8a046',
                  fontsize=9, family='monospace', loc='left')
    axP.tick_params(colors='#4e4e58', labelsize=6)
    for sp in axP.spines.values():
        sp.set_color('#26262e')

    fig.suptitle('Flow / Lensing', color='#c8a046', fontsize=13,
                 family='serif', style='italic', x=0.03, ha='left')
    fig.savefig(path, dpi=110, facecolor=bgd)
    plt.close(fig)


def _strip(ax):
    ax.set_xticks([]); ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_color('#26262e')


# ─────────────────────────────────────────────────────────────────────────
#  JSON DUMP
# ─────────────────────────────────────────────────────────────────────────

def to_json(streams, crits, warp, G, P: Params) -> dict:
    return dict(
        meta=dict(tool='flow-lensing', seed=P.seed, domain=[P.DW, P.DD],
                  masses=P.masses, params={k: v for k, v in asdict(P).items()
                                           if k != 'masses'}),
        bundles=[dict(id=b, name=BNAMES[b],
                      count=sum(1 for s in streams if s['bundle'] == b))
                 for b in range(5)],
        streams=[dict(id=s['id'], fate=s['fate'], bundle=BNAMES[s['bundle']],
                      arc=round(s['arc'], 3), turn=round(s['turn'], 4),
                      max_curvature=round(s['maxCurv'], 4),
                      min_impact=round(s['minB'], 3), nearest_mass=s['nearest'],
                      mean_speed=round(s['meanU'], 3),
                      pts=[[round(x, 3), round(y, 3)] for x, y in s['pts']])
                 for s in streams],
        critical_points=crits,
        transport_graph=dict(
            nodes=[int(n) for n in G.nodes()],
            edges=[dict(u=int(u), v=int(v), kind=d['kind']) for u, v, d in G.edges(data=True)],
            components=nx.number_connected_components(G)),
    )


# ─────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────

def build(P: Params):
    streams = generate(P)
    attach_bundles(streams, P)
    crits = find_critical_points(P)
    warp = build_warp(P)
    G = build_transport_graph(streams)
    return streams, crits, warp, G


def main():
    ap = argparse.ArgumentParser(description='Headless Flow / Lensing generator (NumPy + NetworkX).')
    ap.add_argument('--preset', default='lensing', choices=['lensing', 'cables', 'binary'])
    ap.add_argument('--seed', type=int, default=None)
    ap.add_argument('--nseed', type=int, default=None)
    ap.add_argument('--gstr', type=float, default=None)
    ap.add_argument('--eps', type=float, default=None)
    ap.add_argument('--cap', type=float, default=None)
    ap.add_argument('--png', default=None, help='write a 3-panel figure to this path')
    ap.add_argument('--json', default=None, help='write the full model to this path')
    ap.add_argument('--no-figure', action='store_true')
    args = ap.parse_args()

    P = preset(args.preset)
    if args.seed is not None:
        P.seed = args.seed
    if args.nseed is not None:
        P.NSEED = args.nseed
    if args.gstr is not None:
        P.GSTR = args.gstr
    if args.eps is not None:
        P.EPS = args.eps
    if args.cap is not None:
        P.CAP = args.cap

    streams, crits, warp, G = build(P)
    governance(streams, crits, G, warp, P)

    if args.png and not args.no_figure:
        render_figure(streams, crits, warp, P, args.png)
        print(f'\nFigure → {args.png}')
    if args.json:
        with open(args.json, 'w') as f:
            json.dump(to_json(streams, crits, warp, G, P), f)
        print(f'JSON   → {args.json}')


if __name__ == '__main__':
    main()

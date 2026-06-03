# Generative Systems & Computational Tools

*A research and software index — Dr Theodoros Dounas*

This repository is the hub for a body of work at the intersection of computational design, architectural theory, and contemporary urbanism. It indexes the individual project repositories, sets out the idea that connects them, and tracks the roadmap of tools still to come. Each project lives in its own repository; this one is the map.

---

## The through-line

Every project here is, in the end, an argument about the architect's role under generative systems. The claim is that this role expands rather than shrinks: the architect becomes the **orchestrator** — the author of the tool, the coupler of systems, and the supplier of the criteria a machine cannot generate for itself. The software demonstrates the practice; the books make the historical and theoretical case. The recent tractability of LLM-assisted tool building is what lets a single architect work this way at all, and it runs through the whole index as both method and subject.

---

## Projects

| Project | Focus | Status | Repository |
| --- | --- | --- | --- |
| **CADSS** | 3D cellular automaton for architectural space synthesis, with topological governance | Public · active | [arlav/CADSS](https://github.com/arlav/CADSS/) |
| **AFlow** | LLM-orchestrated multi-agent simulation of urban and architectural systems | In development (Adventurous Systems) | [Aflow](https://aflow.adventurous.systems) |
| **Suzhou Utopias** | Book — eight computational tools built for a single city | Proposal · in development (BIS) | companion repos forthcoming |
| **Generative Systems in Architecture** | Book — the field, and the orchestrator thesis | In development | — |

### Software

#### CADSS — Cellular-Architecture-Design-Stigmergic-Systems
A 3D Moore-neighbourhood cellular automaton for architectural space synthesis. Cells are spaces; structure is **derived** from the face and edge topology of the resulting volume; every element carries a semantic dictionary that maps into TopologicPy. On top of the automaton sits a governance layer that runs eight checks on each generated configuration — among them vertical-circulation continuity, programme accessibility, slab coverage, service proximity, and network centrality — so that emergent designs carry auditable spatial structure rather than raw voxel output. The grid is variable (4–60 cells in X/Y, 2–79 storeys) with four space types, four commune signals, and locked vertical cores. CADSS was built with Claude Code as engineering partner, but the running tool contains no language model — here the LLM is a *build-time* partner only. The project extends the peer-reviewed CAAD Futures 2017 paper on evolving cellular automata for dense urban typologies, with a conceptual lineage running back to Mironov's Cellular Synthesizer, translated from music to architecture.
→ [github.com/arlav/CADSS](https://github.com/arlav/CADSS)

#### AFlow
The multi-agent strand of the work. Agent types are specified in natural language and an MCTS-driven workflow-generation process constructs and tunes their behaviour policies, producing urban fabrics that emerge from agent interaction. Where CADSS keeps the language model at build time, AFlow puts it in the loop at *runtime* — the second of the two modes described below. It has been applied to architectural and urban problems including a "Hospital for the Future" study in Wuhan.
*(Developed at Adventurous Systems;)*

### Books & writing

#### Suzhou Utopias: Building the Tools That Build the City
A book in development, proposed to BIS Publishers. It examines Suzhou — Singapore's first export into China — through eight architectural studies, each built around a custom computational tool: a shape grammar of canal houses, the CADSS cellular automaton, a multi-agent simulation of mobile micro-urbanism, an evolutionary algorithm for rural housing, diffusion-based generators, and others. The book is a working architect's transparent record of designing through machines. It also defines this repository's forward roadmap: the eight chapters' tools are intended to ship as companion repositories, indexed here, with CADSS already public as the first.

#### Generative Systems in Architecture
The longer-form academic counterpart, developed from the author's doctoral dissertation. It traces the field from Alexander, the cybernetic tradition, Pask, Negroponte and Frazer, through shape grammars, graph-based systems and space syntax, to contemporary transformers and diffusion models — and argues throughout for the architect as orchestrator. Where *Suzhou Utopias* demonstrates the practice, this book makes the case.

---

## Two modes of working with LLMs

A single distinction organises the software here, and it is a deliberate choice rather than a default:

- **Build-time partner** — the language model helps design and engineer the tool, but the finished tool runs without it. *CADSS* is the clearest example.
- **Runtime participant** — the language model is part of the system's operation. *AFlow* is the clearest example.

---

## Foundations

The peer-reviewed and published work the projects build on:

- Dounas, T., Spaeth, A. B., Wu, H. & Zhang, C. (2017). *Dense urban typologies and the game of life: evolving cellular automata.* Proceedings of CAAD Futures 2017, Istanbul Technical University, pp. 648–666. — grounds **CADSS**.
- Dounas, T. & Lombardi, D. (eds.) (2022). *Blockchain for Construction.* Springer, Blockchain Technologies series. ISBN 978-981-19-3758-3.
- Doctoral dissertation, Aristotle University of Thessaloniki — generative systems, shape grammars, and animation-based design. — grounds the **monograph**.
- Further peer-reviewed papers across CAAD Futures, eCAADe, CAADRIA and ASCAAD.

---

## How this repository is organised

This is an **index**, not a monorepo. The code for each project lives in its own repository, linked above. As the *Suzhou Utopias* tools are released, their companion repositories will be added to the project table, so that this page stays the single point of entry to the whole programme.

---

## About the author

Dr Theodoros Dounas is an Associate Professor in the School of Textiles and Design at Heriot-Watt University, Director of Adventurous Systems Ltd, and Vice-Chair of the Board of the European Council for Computing in Construction (EC3). His work sits at the intersection of computational design, architectural theory, and contemporary Chinese urbanism, with a PhD (Aristotle University of Thessaloniki) on generative systems, shape grammars, and animation-based design.

---

## Citation · License · Contact

- **Citation** — cite per project. Until a dedicated reference is issued, CADSS can be cited via the 2017 CAAD Futures paper listed under *Foundations*.
- **License** — each repository carries its own license; see the individual repos. 
- **Contact** — via Adventurous Systems Ltd / 

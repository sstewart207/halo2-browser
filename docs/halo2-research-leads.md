# Halo engine and tooling references

Verified September 30, 2026 against project-owned GitHub documentation. These references inform the browser compatibility investigation; none is evidence of a complete Halo 2 browser port.

| Reference | Verified scope | Use for this project |
| --- | --- | --- |
| [Cartographer](https://github.com/pnill/cartographer) | Source for the Windows Halo 2 mod; builds against the June 2010 DirectX SDK. | Closest reference for patched renderer calls and original-engine structures. Inspect the local checkout and installed xlive imports together because compiled versions can differ. |
| [OpenH2](https://github.com/ronbrogan/openh2) | Custom engine and Vista map-format research. Explicitly avoids executable/tool binary reverse engineering. Its documented Armory demo includes scripts, 3D audio and AI bootstrapping. | Useful map/tag/script and rendering reference. A separate engine implementation rather than a drop-in replacement for our executing Halo executable. |
| [Mutation](https://github.com/Himanshu-01/Mutation) | C# content creation/editor for Xbox Halo 2; decompiles maps and recompiles most, with known build issues. Its Blam/HEK work contains findings from PC editing tools. | Tag layouts, map structures, asset decoding; map decompilation does not mean game-executable decompilation. |
| [H2Codez](https://github.com/Project-Cartographer/H2Codez) | DLL modifications restoring and adding features to Halo 2 Editing Kit tools. | Tool/engine structure and shader/editor references. Not a complete game engine. |
| [Halo-2-HD](https://github.com/grimdoomer/Halo-2-HD) | Original Xbox patches for resolution, performance and quality-of-life settings. Maintainer reports testing on real hardware and no Xbox 360 back-compat support. | Xbox graphics reference with substantially different target hardware and executable. Low priority for the Vista browser startup blocker. |
| [Halo CE build 2342 decomp](https://github.com/punpckhdq/halo) | Work-in-progress reconstruction of Halo CE build 2342 requiring the matching PAL debug build and Xbox SDK. | Useful older engine/type reference. Its symbols do not directly map Halo 2 Vista addresses. |

The user supplied a lostbutlucky Twitter screenshot claiming Halo CE benefited from a January 14, 2002 build-2342 debug package and that no matching Halo 2 PDB had surfaced. The CE project's own documentation corroborates its build-specific debug dependency. This investigation has not established the universal absence of matching Halo 2 symbols or independently verified every detail of that package's provenance.

Do not change execution routes simply because a repository has a demo. Current priority remains the actual native D3DCompiler43 failure inside BottleShip. The custom-engine references become more useful for later map, shader, script and gameplay comparisons.

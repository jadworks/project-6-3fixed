# Vice Bay Nights focused gameplay pass

## Goal
Make the existing browser game load faster and feel more deliberate without replacing its procedural Three.js architecture.

## Implementation
- Keep the existing instanced/chunked world pipeline and reduce expensive startup/runtime defaults: rain particle count, default shadow/bloom cost on constrained devices, and object-detail thresholds.
- Extend `ViceWorld` with five visible shop fronts and a lightweight `Store` metadata list; use the same instanced building/sign pipeline so stores do not create a new per-object render-cost pattern.
- Extend `ViceGame` with a small robbery state machine: interact near an unrobbed store to collect cash, mark it robbed, raise wanted heat, start police response, and persist store progress in the current save shape only where compatible.
- Slow police patrol and pursuit speeds in `CityLife` while keeping escalation and roadblocks intact.
- Improve the existing procedural gunshot with layered transient noise and low-frequency impact while keeping it browser-generated and asset-free.
- Replace the five-star wanted display with an original red/white/black/grey five-segment alert meter and add a subtle reticle/weapon-state cue; do not copy GTA branding or UI assets exactly.
- Add explicit low-rise and high-rise visual language in the city generator while retaining instancing and culling.

## Design
Three possible directions: neon-noir crime sandbox (0.04), sun-bleached coastal arcade (0.03), and restrained cinematic street sim (0.06). Choose neon-noir crime sandbox.

- **Design Movement:** neon-noir coastal open-world UI with hard-edged broadcast graphics.
- **Core Principles:** readable silhouettes, fast feedback, strong district color-coding, and performance-aware repetition.
- **Color Philosophy:** cyan/pink/yellow identify the city; white/red/grey identify police pressure; black panels preserve contrast.
- **Layout Paradigm:** information hugs the screen edges while the world owns the center; interactions use short, high-contrast prompts.
- **Signature Elements:** segmented wanted meter, storefront sign bands, and compact robbery toast feedback.
- **Interaction Philosophy:** one-button interactions stay contextual and reversible where possible; robbery is explicit and gives immediate feedback.
- **Animation:** slow patrol drift, sharp alert flashes, small muzzle pulse, and restrained camera recoil.
- **Typography System:** existing bundled Manus CC0 display/body fonts with uppercase micro-labels and large condensed values.
- **Brand Essence:** a fast-loading, stylized coastal crime sandbox for short browser sessions; vivid, readable, reactive.
- **Brand Voice:** terse street-radio copy, e.g. “STORE HIT — MOVE.” and “HEAT COOLING.”
- **Wordmark & Logo:** preserve the existing Vice Bay Nights mark.
- **Signature Brand Color:** neon cyan, balanced by police red.

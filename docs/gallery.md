# Interactive gallery

The optional Gallery view is a live Three.js renderer, not the pre-rendered Blender animation. Bird’s-eye remains the default and the fallback for unsupported WebGL or failed assets. The heavy rendering module, model and image textures are requested only after the user selects Gallery.

## Provenance and scope

`public/gallery/bayeux-gallery.glb` is an original conceptual geometry export from the approved Blender 4.5.13 LTS study. It is 124,920 bytes, contains seven untextured meshes/materials and 2,628 triangles, and embeds no tapestry imagery, camera, lights or animation. SHA-256: `672d699ab6db12d76edccdafc78a1463b6e4718262419167f464510386191068`. The full coordinate/source record is in `public/gallery/provenance.json`. Original gallery geometry is included under the project’s MIT licence; the tapestry images are not.

The pale room and glazed case are a conceptual interpretation, not a surveyed British Museum interior or officially approved case design. Visual reference: [OPERA Amsterdam’s exhibition project](https://opera-amsterdam.nl/2026-british-museum-bayeux-tapestry). The source `.blend` and export/verification scripts remain outside the Site checkout in `../work/blender-study/`.

## Image and camera contract

The complete original 482,096 × 5,550 source, including scan margins, is mapped at uniform scale to a 70 × 0.805856095 m plane. Its source `(u,v)` maps to `[70*(u-.5), .981, .805856095*(v-.5)]` in Y-up glTF space. These dimensions describe the digital study, not measurements of the historic cloth or museum case.

Camera handoffs use the unclipped image rectangle, including white margins, rather than the clamped URL rectangle. Entering Gallery pulls back to reveal the case at a nearly overhead angle (0.08 radians from vertical, zero yaw), centred vertically on the tapestry. Returning rises to a top-down, source-registered camera and dissolves into the still-mounted OpenSeadragon viewer. Dragging updates the selected scene; zoom adjustments carry through to the return view. Reduced motion skips the camera flight.

Switching views preserves auto-pan's play/pause state and chosen speed. The camera handoff completes before the destination continues panning; only one viewer owns playback at a time. Pausing during loading or a transition remains authoritative and is never overridden by completion.

Drag horizontally to move along the case; vertical drag adjusts the viewing angle. Shift-drag or right-drag orbits within bounded angles. Wheel, pinch, the visible plus/minus controls and keyboard +/− zoom towards the tapestry’s vertical centre line without changing playback state. Zoom also preserves playback in Bird’s-eye, including through its animated zoom. Keyboard arrows move along the case or adjust tilt. Deliberate dragging, navigation and reading still pause automatic playback. Cameras stay above the textile plane and cannot turn underneath it.

## Resource limits and failure handling

- Existing read-only DZI host only; no master download and no new image service.
- Eight low-resolution strip tiles plus at most 28 nearby detail tiles. Native-resolution imagery remains available in Bird’s-eye; Gallery caps detail at pyramid level 18.
- Four in-flight tile requests, bounded device pixel ratio, no full-master texture or packed Blender textures.
- DZI overlap is cropped in UV coordinates. Photographic layers use unlit sRGB materials; geometry lighting does not repaint the embroidery.
- Idle rendering stops drawing; hidden tabs suspend movement. A trailing tile refresh handles the final zoom/resize.
- Abort pending requests and dispose textures, image bitmaps, geometry, renderer and animation frames when closing. Failed image requests do not endlessly retry; reopening/retrying Gallery retries them.
- Loading/error UI always offers a return to Bird’s-eye. No analytics, server API or extra persistence.

Implementation references: [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html), [OpenSeadragon Viewport](https://openseadragon.github.io/docs/OpenSeadragon.Viewport.html).

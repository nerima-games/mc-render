---
"@nerima-games/mc-render": minor
---

Use mc-meshing 0.7.0 with mc-kernel 0.17.0 to mesh block states, fluid flow, and rail shapes. State-bearing chunks select their block models and crop texture stages from the encoded per-cell state. A typed texture lookup failure skips only the affected chunk; repeated faults are counted and can be drained through `WorldRendererAttachment.drainFaults`.

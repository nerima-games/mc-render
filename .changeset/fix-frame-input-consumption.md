---
'@nerima-games/mc-render': minor
---

Change the public frame-input contract to sequence-based readings. InputSnapshot now requires sequence and bindings. Pass a reading to wasActionJustTriggered, wasButtonJustPressed, and wasUiClick; their live forms are removed. Frame consumers also pass the same reading to level queries.

Brand `InputSnapshot.sequence` as `InputSequence` and export `INITIAL_INPUT_SEQUENCE` for initial fixtures. Use readings from the same service instance; no sequence constructor is public.

endFrame(reading) consumes unread input through that sequence, preserves later arrivals and fractional wheel travel, and accepts spread or structuredClone copies. Use one reading per frame. Ending a reading with the same sequence again does not consume input twice. endFrame() consumes all current edges, clicks, pointer movement, and wheel travel, including fractional notches, while retaining input levels, axes, lock, and focus. Unlocked duplicate mousedown events for the same button and landing produce one click edge until mouseup or a landing change. Acquiring pointer lock clears UI press tracking so a missed UI mouseup cannot suppress gameplay clicks.

Remove the consumption watermark so an out-of-range reading cannot prevent later valid readings from consuming input. Coalesce pointer and wheel contributions between sampled boundaries instead of storing each event separately.

This changes the published contract rather than restoring the previous clearing behavior. It is a minor release under the [0.x versioning policy](../docs/versioning.md#0x-semver-policy).

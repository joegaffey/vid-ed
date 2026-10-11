# Brief — DIY RC sim-racing controller (v2, code-forward)

## Who / what
A solo maker's build-and-test show-and-tell. Two source videos plus a firmware
gist:

1. **case-design.mp4** — screen recording of my own browser-based 3D CAD editor,
   **3table**. I modelled a custom enclosure for a DIY racing controller: a long
   grey case with internal ribs, threaded mounting posts, a green lid, snap-fit
   tabs and a green power switch. Silent talky screen-capture; the "build" half.
2. **controller-test.mp4** — cockpit POV of the finished controller on a real
   track (Renault Sport dash, RaceLogic timer). I was **filming with one hand and
   steering with the other**, so the driving is rough. The "test" half.
3. **gist-code.png** — a screenshot of the firmware (`rc_controller.ino`,
   Arduino/C++): `#include <Joystick.h>`, `ThrottlePin 2`, `SteeringPin 3`,
   `setup()` sets the pins `INPUT` and calls `Joystick_.begin()` /
   `setXAxisRange(1900,1050)` / `setYAxisRange(1050,1900)`, and `loop()` reads
   both channels with `pulseIn(...)` and maps them with `setXAxis(steering)` /
   `setYAxis(throttle)`.

## Audience & tone
Fellow makers and sim-racing DIY people. Friendly, first-person, a bit
self-deprecating about the one-handed driving.

## Editorial intent
- **Spend real time on the firmware.** The code is the star this time: walk the
  gist line by line — the `Joystick.h` include, the two pin `#define`s, the
  `setup()` pin modes + `Joystick_.begin()`, the **inverted axis ranges**
  (`setXAxisRange(1900,1050)`) as signal calibration, and the `loop()` that
  `pulseIn`s PWM on pins 2 and 3 and feeds steering→X, throttle→Y.
- Structure: intro → **firmware walkthrough** (the core) → **case design /
  3table** → **track test** (one-handed) → outro. Show the gist screenshot while
  explaining it.
- ~90–120s, narrated with captions, single 1080p output.
- Let the frame descriptions drive clip choice: build-up (shells → interior →
  finished → exploded) for the design chapter; cockpit controller shots for the
  test chapter.

## Key facts
- Editor: **3table**, built by me.
- Firmware: `pulseIn` on pins 2 (throttle) and 3 (steering) → USB joystick X/Y;
  inverted axis ranges because the RC signal reads high-to-low.
- Enclosure: long grey case, green lid, mounting posts, snap-fit tabs, front
  switch, PCB inside.
- Track test: one hand on the wheel, one on the camera.

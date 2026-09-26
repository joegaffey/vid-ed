# vided context — agent-demo
assets: 3 | duration: 500.381s | selected frames: 50

## Brief
# Brief — build & test demo

## Who / what
A solo maker's build-and-test demo. Two source videos plus a firmware gist:

1. **case-design.mp4** — a screen recording of the maker's own browser-based 3D
   CAD editor, called **3table**. He modelled a custom enclosure for a DIY
   racing controller: a long grey case with internal ribs, threaded mounting
   posts, a green lid, snap-fit tabs and a green power switch on the front.
   The PCB of the controller is modelled alongside/inside the case. It is
   silent, a talky screen-capture, and is the "build" half of the story.
2. **controller-test.mp4** — cockpit POV footage of the finished controller
   being used on a real race track (Renault Sport dash, RaceLogic timer). The
   maker was **recording with one hand and steering with the other**, which is
   why the driving looks rough. This is the "test" half.
3. **gist-code.png** — a screenshot of the firmware (Arduino/C++, `Joystick.h`)
   that reads two RC PWM inputs: throttle on pin 2 and steering on pin 3 via
   `pulseIn`, then maps them to USB joystick X/Y axes with `setXAxisRange` /
   `setYAxisRange`.

## Audience & tone
Fellow makers and sim-racing DIY people. Friendly, first-person, a little
self-deprecating about the one-handed driving. Not a polished product ad — a
"here's what I built and how it went" show-and-tell.

## Editorial intent
- Structure: intro title → **case design / 3table** chapter → **firmware/code**
  chapter (show the gist) → **track test** chapter (one-handed) → outro.
- ~60–100 seconds, narrated with captions, single 1080p output.
- Let the frame descriptions drive clip choice: pick frames that show the model
  being built up (shells → assembly → case interior → finished box → exploded
  view) for the design section, and the cockpit controller shots for the test.
- The 3table section should read as "I wrote this editor myself".
- Credit that the track footage was shot one-handed; make a joke of it.

## Key facts to carry through
- Editor name: **3table**, built by the maker.
- Enclosure: long grey case, green lid, mounting posts, snap-fit tabs, front
  power switch, PCB inside.
- Firmware: two PWM channels (throttle pin 2, steering pin 3) → USB joystick.
- Track test: one hand on the wheel, one on the camera.


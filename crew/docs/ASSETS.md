# Plan: the crew makes its own assets

Today the models only write SCENE lines, and code animates, builds and voices everything from a fixed library. This plan lets the crew author new 3D props, set layouts, gestures and voice performances itself, with the hand-holding for each job sized to the model doing it (`src/llm/capability.ts`).

The rule that keeps it safe: **a model never hands over raw meshes, keyframes or audio it made up freely.** It writes something code can run or check, such as a builder, a set of pose curves, or a voice direction. Code then validates it, renders a preview, and lets a model with good eyes critique the preview before anything reaches a shot.

## How the grip scales the work

Each asset job has a difficulty, and the model's ability at it decides what form it writes in.

| Job | Strict grip (weak at it) | Guided grip (near its limit) | Free grip (comfortable) |
| --- | --- | --- | --- |
| 3D prop | a parts list: boxes, cylinders, spheres with sizes, positions and colours; code builds it | builder code using the library helpers, with 2-3 similar library props as examples | builder code, helpers only, no examples |
| Gesture | pick a template (nod, shrug, reach, flinch...) and set its amplitude and timing | keyframes on the rig's channels, with existing gestures as examples | keyframes on the rig's channels |
| Set layout from pictures | pick a library set, then place listed props on listed anchors | anchors and props as coordinates, with the room's size fixed | the whole layout: size, anchors, props, dressing |
| Voice performance | the verb's default delivery (whisper, shout) | one line of direction per line of dialogue | full direction: pace, pauses, emphasis, emotion |

With today's estimates, the jobs land like this:

| | Pro | Flash | Flash-Lite |
| --- | --- | --- | --- |
| 3D props | guided | strict (parts list) | not given this job |
| Gestures | guided | strict (templates) | not given this job |
| Set layout from pictures | free | free | not given this job |
| Voice direction | free | free | not given this job |

Claude Opus is guided on props and gestures and free on the rest. So with today's estimates, Pro authors props and gestures as code and keyframes, and Flash only does so through the strict forms. The eval and the call log replace the estimates once there is data.

## The common loop

Every asset job runs the same loop. It's the note pipeline's step runner, with a render in the middle:

1. **Spec (Pro).** What is needed, in real units: "a teapot, 22 cm wide, 15 cm tall, white glaze, sits on a surface". Or for a gesture: "Kiran flinches back, then freezes, 1.2 s".
2. **Author.** Pro or Flash, depending on the grip, writes the parts list, builder, keyframes or direction.
3. **Validate (code).** Hard limits (below). Failures go back explained, like patch failures, for the grip's number of repair rounds.
4. **Preview (code).** Render the prop from four angles, or the gesture as a contact sheet of frames, using the same renderer as the film.
5. **Critique (Pro, vision).** Pro looks at the preview against the spec ("the spout is on the wrong side", "the flinch reads as a sneeze") and either passes it or returns a fix list. That goes back into the author step.
6. **Store.** Assets go into the backend library with where they came from (spec, model, date). They stay backend-only: the crew uses them by name, and there is no browse page.

## 3D props

- **Format:** the same builder shape as `library/props/*.js`. It returns a `THREE.Group` standing on y=0, centred on x and z, facing +z, in metres. It may only use the helpers in `library/props/core.js` (`box`, `mesh`, `mat`, `rng`) plus three.js primitives.
- **Sandbox:** runs in a Node `vm` with only three.js and the helpers injected. No `require`, file system, network or timers. A CPU time limit applies.
- **Checks:**
  - It returns a group and has no NaN positions.
  - The bounding box is within 15% of the spec size.
  - The lowest point is at y=0 (±1 cm) and it is centred.
  - Triangle count is under 20k and there are at most 8 materials.
  - Nothing floats more than 2 cm off its parts.
  - Code works out the placement type (`onSurface`, `front`, `at`, `wall`...) from the size, and Pro confirms it.
- **Metadata:** `meta.js` size and y0 are measured, not written by the model.
- **Trigger:** a note or script that needs a prop the library doesn't have ("she pours from a teapot"). The take that uses it shows the new prop. Rejecting the take discards the prop.

## Gestures

- **Format:** keyframes over the rig's channels: `nod`, `headYaw`, `lean`, `lArmX`, `lArmZ`, `rArmX`, `rArmZ`, `lElb`, `rElb`, `sit`, `talk`, `blink`, plus an expression at a time. Shape: `{ name, dur, persists, keys: { channel: [[t, value], ...] }, expression: [[t, name]] }`, with t from 0 to 1.
- **Checks:**
  - Only known channels.
  - Each value is inside that joint's range.
  - Angular speed under a limit, so no snaps.
  - It starts and ends at rest unless `persists`.
  - Duration from 0.2 to 6 s.
  - Its name doesn't clash with an existing verb.
- **Result:** a new animator verb, available to every take. The registry, the compiler's character track and the viewer's rig need a small extension to play keyframed gestures; today verbs map to fixed motions.

## Set layout from pictures

This builds on the Home set choice (3D set with inspiration pictures).

- Pro looks at the pictures and writes a layout: room size, anchors with positions and facing, library and generated props placed on them, and dressing.
- **Checks:** everything is inside the room, there are clear walking paths between anchors (the compiler's path finder), no props overlap, and the entrance is reachable.
- It becomes a proposed `set` block for the show bible. People write the show bible, so you accept it there; the crew never edits it on its own.

## Voices

- **New engine:** a `GeminiTtsEngine` implementing `TtsEngine.synth(text, design, speed)`, using a Gemini TTS model's speech output. Single and multi-speaker voices come from the cast list.
- **Direction:** the dialogue verb (say, whisper, shout) and the shot's beat set the delivery. A model writes one line of direction per line ("guilty, quiet, a small pause before 'still cold'").
- **Checks:** clip length within the pace window from the cast list, no silence longer than 1.5 s, and the level within range. The cut retimes to the clip as it does now.
- **Not yet verified:** the exact TTS request shape and voice list for the current Gemini TTS models. It needs a key to confirm before building.

## Music and sound effects

Stay on the library cues for now. Google has music-generation models, but I have not verified what the API offers. Research comes first, before any plan.

## Build order

| Phase | What | Why first |
| --- | --- | --- |
| 1 | The asset loop: spec, author, validate, preview, critique, store; generalising the note pipeline's runner | everything else plugs into it |
| 2 | 3D props: sandbox, checks, four-view preview, vision critique, all three grips | most visible gain, fully checkable |
| 3 | Gestures: rig and compiler support for keyframed verbs, checks, contact-sheet preview | needs viewer changes |
| 4 | Gemini voices: TTS engine and directions | needs a key to verify the API |
| 5 | Set layout from pictures | builds on 2 and the Home flow |
| 6 | Music research, then a plan | unknown availability |

Each phase gets golden cases in the eval: props with known dimensions, gestures described in words, and lines with known delivery. That way a model's grip on each job can be measured, not guessed.

# Director's exam for Gemini 3.1 Pro: all 12 questions

Paste each question (everything between its two ===== lines) into a fresh Gemini 3.1 Pro chat with thinking on high. Send me the replies, labelled by question number.

===== QUESTION 1 (plan-two-roles) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

NOTE: "the ending in 1G needs to feel warmer, and mum should get the last laugh, not kiran"
Shots named in the note: 1G

EPISODE (one line per shot):
[scene1] scene 1 kitchen night act 1
[1A] 1A WS
[1A.1]  kiran@door enter
[1A.2]  with mum@chair sit ~0.3
[1A.3]  ambience night
[1A.4]  kiran walk fridge 1
[1A.5]  with sfx footsteps
[1B] 1B MCU kiran
[1B.1]  light practical
[1B.2]  kiran open fridge.door
[1B.3]  with sfx fridge.open
[1B.4]  kiran smile
[1B.5]  kiran take cake
[1C] 1C CU mum
[1C.1]  mum say "Couldn't sleep either?" to kiran
[1D] 1D MCU kiran push.slow
[1D.1]  kiran turn mum
[1D.2]  kiran shock ~2.5
[1D.3]  with sfx sting
[1D.4]  kiran guilty
[1D.5]  kiran say "I was... checking the fridge was still cold."
[1E] 1E OTS kiran>mum
[1E.1]  mum look kiran
[1E.2]  mum smile
[1E.3]  mum say "And is it?"
[1F] 1F CU kiran
[1F.1]  kiran nod
[1F.2]  kiran say "Very."
[1G] 1G TWO kiran>mum
[1G.1]  mum say "Get two forks."
[1G.2]  with music warm
[1G.3]  kiran laugh
[1G.4]  kiran walk counter
[1G.5]  kiran take fork

QC issues:
- warn [lens] 1G: 1G: the set is too small for this framing at 35mm; the camera moves in to 3.7m and cheats to 29mm
- error [intersection] 1A @2.5s: kiran and mum intersect at 2.5s (46cm apart)
- error [furniture] 1A @2.5s: kiran is inside the chair at 2.5s (8cm in)

Which shots is this note about, and which ONE role owns the fix (two only if it truly needs both)?
Roles:
- writer: dialogue lines (say / whisper / shout)
- blocking: body positions and movement: enter exit walk run sit stand kneel lean turn open close take give put wait, and @anchor pins
- dp: shot headers (size, subjects, move, lens, angle, side), light lines, and adding coverage shots
- animator: faces, eyelines and gestures: look glare smile laugh frown shock sad angry scared guilty think nod shake shrug sigh cry wave point blink neutral
- editor: trim and hold lines, and dropping whole shots
- sound: sfx, music, ambience and silence lines
If the note names shots, use exactly those.

A quick read chose shots 1G and role editor.
You are the director. Confirm or correct that, then write the plan: the goal in one sentence, a brief for the builder (what to do), what must not change, and how to tell a take worked. Keep it concrete: name lines, beats and seconds.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "shots",
  "roles",
  "intent",
  "brief",
  "keep",
  "success"
 ],
 "properties": {
  "shots": {
   "type": "array",
   "items": {
    "type": "string",
    "enum": [
     "1A",
     "1B",
     "1C",
     "1D",
     "1E",
     "1F",
     "1G"
    ]
   },
   "description": "the shots this note is about"
  },
  "roles": {
   "type": "array",
   "items": {
    "type": "string",
    "enum": [
     "writer",
     "blocking",
     "dp",
     "animator",
     "editor",
     "sound"
    ]
   },
   "description": "1 role, at most 2"
  },
  "intent": {
   "type": "string",
   "description": "the note restated as a concrete goal, one sentence"
  },
  "brief": {
   "type": "string",
   "description": "1-3 sentences for the builder: what to do"
  },
  "keep": {
   "type": "string",
   "description": "what must not change"
  },
  "success": {
   "type": "string",
   "description": "how to tell a take did it, one sentence"
  }
 }
}

===== END OF QUESTION 1 =====

===== QUESTION 2 (plan-wrong-role) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

NOTE: "in 1B the fridge should feel like a spotlight on him, he's been caught"
Shots named in the note: 1B

EPISODE (one line per shot):
[scene1] scene 1 kitchen night act 1
[1A] 1A WS
[1A.1]  kiran@door enter
[1A.2]  with mum@chair sit ~0.3
[1A.3]  ambience night
[1A.4]  kiran walk fridge 1
[1A.5]  with sfx footsteps
[1B] 1B MCU kiran
[1B.1]  light practical
[1B.2]  kiran open fridge.door
[1B.3]  with sfx fridge.open
[1B.4]  kiran smile
[1B.5]  kiran take cake
[1C] 1C CU mum
[1C.1]  mum say "Couldn't sleep either?" to kiran
[1D] 1D MCU kiran push.slow
[1D.1]  kiran turn mum
[1D.2]  kiran shock ~2.5
[1D.3]  with sfx sting
[1D.4]  kiran guilty
[1D.5]  kiran say "I was... checking the fridge was still cold."
[1E] 1E OTS kiran>mum
[1E.1]  mum look kiran
[1E.2]  mum smile
[1E.3]  mum say "And is it?"
[1F] 1F CU kiran
[1F.1]  kiran nod
[1F.2]  kiran say "Very."
[1G] 1G TWO kiran>mum
[1G.1]  mum say "Get two forks."
[1G.2]  with music warm
[1G.3]  kiran laugh
[1G.4]  kiran walk counter
[1G.5]  kiran take fork

QC issues:
- warn [lens] 1G: 1G: the set is too small for this framing at 35mm; the camera moves in to 3.7m and cheats to 29mm
- error [intersection] 1A @2.5s: kiran and mum intersect at 2.5s (46cm apart)
- error [furniture] 1A @2.5s: kiran is inside the chair at 2.5s (8cm in)

Which shots is this note about, and which ONE role owns the fix (two only if it truly needs both)?
Roles:
- writer: dialogue lines (say / whisper / shout)
- blocking: body positions and movement: enter exit walk run sit stand kneel lean turn open close take give put wait, and @anchor pins
- dp: shot headers (size, subjects, move, lens, angle, side), light lines, and adding coverage shots
- animator: faces, eyelines and gestures: look glare smile laugh frown shock sad angry scared guilty think nod shake shrug sigh cry wave point blink neutral
- editor: trim and hold lines, and dropping whole shots
- sound: sfx, music, ambience and silence lines
If the note names shots, use exactly those.

A quick read chose shots 1B and role sound.
You are the director. Confirm or correct that, then write the plan: the goal in one sentence, a brief for the builder (what to do), what must not change, and how to tell a take worked. Keep it concrete: name lines, beats and seconds.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "shots",
  "roles",
  "intent",
  "brief",
  "keep",
  "success"
 ],
 "properties": {
  "shots": {
   "type": "array",
   "items": {
    "type": "string",
    "enum": [
     "1A",
     "1B",
     "1C",
     "1D",
     "1E",
     "1F",
     "1G"
    ]
   },
   "description": "the shots this note is about"
  },
  "roles": {
   "type": "array",
   "items": {
    "type": "string",
    "enum": [
     "writer",
     "blocking",
     "dp",
     "animator",
     "editor",
     "sound"
    ]
   },
   "description": "1 role, at most 2"
  },
  "intent": {
   "type": "string",
   "description": "the note restated as a concrete goal, one sentence"
  },
  "brief": {
   "type": "string",
   "description": "1-3 sentences for the builder: what to do"
  },
  "keep": {
   "type": "string",
   "description": "what must not change"
  },
  "success": {
   "type": "string",
   "description": "how to tell a take did it, one sentence"
  }
 }
}

===== END OF QUESTION 2 =====

===== QUESTION 3 (plan-two-shots) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

NOTE: "1D and 1E: the pause between his excuse and her reply should be twice as long"
Shots named in the note: 1D, 1E

EPISODE (one line per shot):
[scene1] scene 1 kitchen night act 1
[1A] 1A WS
[1A.1]  kiran@door enter
[1A.2]  with mum@chair sit ~0.3
[1A.3]  ambience night
[1A.4]  kiran walk fridge 1
[1A.5]  with sfx footsteps
[1B] 1B MCU kiran
[1B.1]  light practical
[1B.2]  kiran open fridge.door
[1B.3]  with sfx fridge.open
[1B.4]  kiran smile
[1B.5]  kiran take cake
[1C] 1C CU mum
[1C.1]  mum say "Couldn't sleep either?" to kiran
[1D] 1D MCU kiran push.slow
[1D.1]  kiran turn mum
[1D.2]  kiran shock ~2.5
[1D.3]  with sfx sting
[1D.4]  kiran guilty
[1D.5]  kiran say "I was... checking the fridge was still cold."
[1E] 1E OTS kiran>mum
[1E.1]  mum look kiran
[1E.2]  mum smile
[1E.3]  mum say "And is it?"
[1F] 1F CU kiran
[1F.1]  kiran nod
[1F.2]  kiran say "Very."
[1G] 1G TWO kiran>mum
[1G.1]  mum say "Get two forks."
[1G.2]  with music warm
[1G.3]  kiran laugh
[1G.4]  kiran walk counter
[1G.5]  kiran take fork

QC issues:
- warn [lens] 1G: 1G: the set is too small for this framing at 35mm; the camera moves in to 3.7m and cheats to 29mm
- error [intersection] 1A @2.5s: kiran and mum intersect at 2.5s (46cm apart)
- error [furniture] 1A @2.5s: kiran is inside the chair at 2.5s (8cm in)

Which shots is this note about, and which ONE role owns the fix (two only if it truly needs both)?
Roles:
- writer: dialogue lines (say / whisper / shout)
- blocking: body positions and movement: enter exit walk run sit stand kneel lean turn open close take give put wait, and @anchor pins
- dp: shot headers (size, subjects, move, lens, angle, side), light lines, and adding coverage shots
- animator: faces, eyelines and gestures: look glare smile laugh frown shock sad angry scared guilty think nod shake shrug sigh cry wave point blink neutral
- editor: trim and hold lines, and dropping whole shots
- sound: sfx, music, ambience and silence lines
If the note names shots, use exactly those.

A quick read chose shots 1D, 1E and role writer.
You are the director. Confirm or correct that, then write the plan: the goal in one sentence, a brief for the builder (what to do), what must not change, and how to tell a take worked. Keep it concrete: name lines, beats and seconds.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "shots",
  "roles",
  "intent",
  "brief",
  "keep",
  "success"
 ],
 "properties": {
  "shots": {
   "type": "array",
   "items": {
    "type": "string",
    "enum": [
     "1A",
     "1B",
     "1C",
     "1D",
     "1E",
     "1F",
     "1G"
    ]
   },
   "description": "the shots this note is about"
  },
  "roles": {
   "type": "array",
   "items": {
    "type": "string",
    "enum": [
     "writer",
     "blocking",
     "dp",
     "animator",
     "editor",
     "sound"
    ]
   },
   "description": "1 role, at most 2"
  },
  "intent": {
   "type": "string",
   "description": "the note restated as a concrete goal, one sentence"
  },
  "brief": {
   "type": "string",
   "description": "1-3 sentences for the builder: what to do"
  },
  "keep": {
   "type": "string",
   "description": "what must not change"
  },
  "success": {
   "type": "string",
   "description": "how to tell a take did it, one sentence"
  }
 }
}

===== END OF QUESTION 3 =====

===== QUESTION 4 (debug-continuity) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

You are the Animator on a film crew. You own performance accents: holds, reactions, eyelines. Pose-to-pose and specific. A held look usually beats a bigger expression.

NOTE FROM THE DIRECTOR: "1B, kiran should look guilty before he takes the cake"

GOAL: 1B, kiran should look guilty before he takes the cake

THE DIRECTOR'S PLAN
Do: Do what the note says on 1B.
Keep unchanged: everything the note doesn't mention
Success looks like: the note is visibly done and nothing else changed

HOW TO WRITE A PATCH
PATCH FORMAT (Animator). Write plain text, one op per line, nothing else.
You may change: face, eyeline and gesture lines. Ops: edit (->), replace (=), insert (+), delete (-).
  ADDR ~2 -> ~3          swap tokens inside one line (old tokens must appear exactly once)
  ADDR = <new line>      replace the whole line
  ADDR + <new line>      insert after ADDR (after a shot id = first line of the shot)
  ADDR -                 delete the line
Line syntax:
  [with] actor verb [target] [~N]
    look/glare/wave/point take a character, anchor or prop target; all other verbs take no target
  ~N = seconds, e.g. ~2.5
Verbs: look glare neutral smile laugh frown shock sad angry scared guilty think nod shake shrug sigh cry wave point blink
Characters: kiran mum
Anchors: door sink counter fridge table chair window
Props: cake fridge.door fork mug
Rules:
- Only change shots 1B. Addresses must come from the listing.
- One change per line. Keep everything else on the line identical.
- Durations are ~N seconds. Quote dialogue with straight double quotes.
- No markdown, no code fences, no commentary in the patch.
- Use only the words listed above.

THE LINES YOU MAY CHANGE
Lines marked * are yours to change. Use these addresses exactly.
shot 1B: set kitchen; characters kiran mum; 3.3s
 1B      MCU kiran
 1B.1    light practical
 1B.2    kiran open fridge.door
 1B.3    with sfx fridge.open
*1B.4    kiran smile
 1B.5    kiran take cake
  continuity: kiran opens 1C smile; mum opens 1C neutral. Faces and positions carry over the cut: if you change one in 1B, end the shot back on what 1C opens with, or 1C changes and the take is rejected.
You may insert after: 1B 1B.1 1B.2 1B.3 1B.4 1B.5

THE WHOLE EPISODE, FOR CONTEXT (change only your shots)
[scene1] scene 1 kitchen night act 1
[1A] 1A WS   (7.2s in the cut, at 0:00.0)  ...
[1B] 1B MCU kiran   (3.3s in the cut, at 0:07.2)
[1B.1]  light practical
[1B.2]  kiran open fridge.door   @0.0-1.0s
[1B.3]  with sfx fridge.open   @0.0-0.5s
[1B.4]  kiran smile   @1.0-2.0s
[1B.5]  kiran take cake   @2.0-2.9s
[1C] 1C CU mum   (1.8s in the cut, at 0:10.5)  ...
[1D] 1D MCU kiran push.slow   (7.9s in the cut, at 0:12.3)  ...
[1E] 1E OTS kiran>mum   (3.4s in the cut, at 0:20.2)  ...
[1F] 1F CU kiran   (1.8s in the cut, at 0:23.6)  ...
[1G] 1G TWO kiran>mum   (5.7s in the cut, at 0:25.4)  ...

QC issues in these shots:
none

YOUR LAST TAKES WERE REJECTED. Fix them:
patch:
1B.4 + kiran guilty ~1.2
problem: Your change alters the face 1C starts with. End your shot on the same expression it had before, or keep the last expression line unchanged.

patch:
1B.4 + kiran guilty ~1.2
problem: Your change alters the face 1C starts with. End your shot on the same expression it had before, or keep the last expression line unchanged.

The builder could not get this right. You are the director: write takes that pass.

Write 1 to 3 different takes. Each "patch" is plain patch lines, one change per line, nothing else. Smallest change first.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "takes",
  "pushback",
  "idea"
 ],
 "properties": {
  "takes": {
   "type": "array",
   "minItems": 1,
   "maxItems": 3,
   "description": "1 to 3 alternative takes, smallest change first",
   "items": {
    "type": "object",
    "additionalProperties": false,
    "required": [
     "purpose",
     "patch"
    ],
    "properties": {
     "purpose": {
      "type": "string",
      "description": "one sentence: what this take does for the story"
     },
     "patch": {
      "type": "string",
      "description": "patch lines in the SCENE patch language, one change per line, separated by newlines"
     }
    }
   }
  },
  "pushback": {
   "anyOf": [
    {
     "type": "string",
     "description": "if the note would hurt the cut, say why"
    },
    {
     "type": "null"
    }
   ]
  },
  "idea": {
   "anyOf": [
    {
     "type": "string",
     "description": "one idea the director didn't ask for, in one sentence"
    },
    {
     "type": "null"
    }
   ]
  }
 }
}

===== END OF QUESTION 4 =====

===== QUESTION 5 (debug-bad-address) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

You are the Animator on a film crew. You own performance accents: holds, reactions, eyelines. Pose-to-pose and specific. A held look usually beats a bigger expression.

NOTE FROM THE DIRECTOR: "1D, the shock should be half as long"

GOAL: 1D, the shock should be half as long

HOW TO WRITE A PATCH
PATCH FORMAT (Animator). Write plain text, one op per line, nothing else.
You may change: face, eyeline and gesture lines. Ops: edit (->), replace (=), insert (+), delete (-).
  ADDR ~2 -> ~3          swap tokens inside one line (old tokens must appear exactly once)
  ADDR = <new line>      replace the whole line
  ADDR + <new line>      insert after ADDR (after a shot id = first line of the shot)
  ADDR -                 delete the line
Line syntax:
  [with] actor verb [target] [~N]
    look/glare/wave/point take a character, anchor or prop target; all other verbs take no target
  ~N = seconds, e.g. ~2.5
Verbs: look glare neutral smile laugh frown shock sad angry scared guilty think nod shake shrug sigh cry wave point blink
Characters: kiran mum
Anchors: door sink counter fridge table chair window
Props: cake fridge.door fork mug
Rules:
- Only change shots 1D. Addresses must come from the listing.
- One change per line. Keep everything else on the line identical.
- Durations are ~N seconds. Quote dialogue with straight double quotes.
- No markdown, no code fences, no commentary in the patch.
- Use only the words listed above.

THE LINES YOU MAY CHANGE
Lines marked * are yours to change. Use these addresses exactly.
shot 1D: set kitchen; characters kiran mum; 7.9s
 1D      MCU kiran push.slow
 1D.1    kiran turn mum
*1D.2    kiran shock ~2.5
 1D.3    with sfx sting
*1D.4    kiran guilty
 1D.5    kiran say "I was... checking the fridge was still cold."
  continuity: kiran opens 1E guilty; mum opens 1E neutral. Faces and positions carry over the cut: if you change one in 1D, end the shot back on what 1E opens with, or 1E changes and the take is rejected.
You may insert after: 1D 1D.1 1D.2 1D.3 1D.4 1D.5

THE WHOLE EPISODE, FOR CONTEXT (change only your shots)
[scene1] scene 1 kitchen night act 1
[1A] 1A WS   (7.2s in the cut, at 0:00.0)  ...
[1B] 1B MCU kiran   (3.3s in the cut, at 0:07.2)  ...
[1C] 1C CU mum   (1.8s in the cut, at 0:10.5)  ...
[1D] 1D MCU kiran push.slow   (7.9s in the cut, at 0:12.3)
[1D.1]  kiran turn mum   @0.0-0.6s
[1D.2]  kiran shock ~2.5   @0.6-3.1s
[1D.3]  with sfx sting   @0.6-1.4s
[1D.4]  kiran guilty   @3.1-4.3s
[1D.5]  kiran say "I was... checking the fridge was still cold."   @4.3-7.6s
[1E] 1E OTS kiran>mum   (3.4s in the cut, at 0:20.2)  ...
[1F] 1F CU kiran   (1.8s in the cut, at 0:23.6)  ...
[1G] 1G TWO kiran>mum   (5.7s in the cut, at 0:25.4)  ...

QC issues in these shots:
none

YOUR LAST TAKES WERE REJECTED. Fix them:
patch:
1D.9 ~2.5 -> ~1.2
problem: 1D.9 does not exist. 1D has lines 1D.1 to 1D.5 (see the listing).

patch:
1D.9 ~2.5 -> ~1.2
problem: 1D.9 does not exist. 1D has lines 1D.1 to 1D.5 (see the listing).

The builder could not get this right. You are the director: write takes that pass.

Write 1 to 3 different takes. Each "patch" is plain patch lines, one change per line, nothing else. Smallest change first.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "takes",
  "pushback",
  "idea"
 ],
 "properties": {
  "takes": {
   "type": "array",
   "minItems": 1,
   "maxItems": 3,
   "description": "1 to 3 alternative takes, smallest change first",
   "items": {
    "type": "object",
    "additionalProperties": false,
    "required": [
     "purpose",
     "patch"
    ],
    "properties": {
     "purpose": {
      "type": "string",
      "description": "one sentence: what this take does for the story"
     },
     "patch": {
      "type": "string",
      "description": "patch lines in the SCENE patch language, one change per line, separated by newlines"
     }
    }
   }
  },
  "pushback": {
   "anyOf": [
    {
     "type": "string",
     "description": "if the note would hurt the cut, say why"
    },
    {
     "type": "null"
    }
   ]
  },
  "idea": {
   "anyOf": [
    {
     "type": "string",
     "description": "one idea the director didn't ask for, in one sentence"
    },
    {
     "type": "null"
    }
   ]
  }
 }
}

===== END OF QUESTION 5 =====

===== QUESTION 6 (debug-wrong-verb) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

You are the Blocking on a film crew. You own where bodies are. Solve collisions and staging with the smallest move. Use real paths through the set; never route a character through another one.

NOTE FROM THE DIRECTOR: "1A, kiran should sneak in slowly"

GOAL: 1A, kiran should sneak in slowly

HOW TO WRITE A PATCH
PATCH FORMAT (Blocking). Write plain text, one op per line, nothing else.
You may change: movement lines. Ops: edit (->), replace (=), insert (+), delete (-).
  ADDR ~2 -> ~3          swap tokens inside one line (old tokens must appear exactly once)
  ADDR = <new line>      replace the whole line
  ADDR + <new line>      insert after ADDR (after a shot id = first line of the shot)
  ADDR -                 delete the line
Line syntax:
  [with] actor[@anchor] verb [target] [target2] [speed] [~N]
    walk/run: target is an anchor or character, optional speed in m/s: kiran walk fridge 1.0
    open/close/take: a prop. give <prop> <char>. put <prop> [anchor]. stand/kneel/wait: no target
  ~N = seconds, e.g. ~2.5
Verbs: enter exit walk run sit stand kneel lean turn open close take give put wait
Characters: kiran mum
Anchors: door sink counter fridge table chair window
Props: cake fridge.door fork mug
Rules:
- Only change shots 1A. Addresses must come from the listing.
- One change per line. Keep everything else on the line identical.
- Durations are ~N seconds. Quote dialogue with straight double quotes.
- No markdown, no code fences, no commentary in the patch.
- Use only the words listed above.

THE LINES YOU MAY CHANGE
Lines marked * are yours to change. Use these addresses exactly.
shot 1A: set kitchen; characters kiran mum; 7.2s
 1A      WS
*1A.1    kiran@door enter
*1A.2    with mum@chair sit ~0.3
 1A.3    ambience night
*1A.4    kiran walk fridge 1
 1A.5    with sfx footsteps
  continuity: kiran opens 1B neutral; mum opens 1B neutral. Faces and positions carry over the cut: if you change one in 1A, end the shot back on what 1B opens with, or 1B changes and the take is rejected.
You may insert after: 1A 1A.1 1A.2 1A.3 1A.4 1A.5

THE WHOLE EPISODE, FOR CONTEXT (change only your shots)
[scene1] scene 1 kitchen night act 1
[1A] 1A WS   (7.2s in the cut, at 0:00.0)
[1A.1]  kiran@door enter   @0.0-0.6s
[1A.2]  with mum@chair sit ~0.3   @0.0-0.3s
[1A.3]  ambience night   @0.6-0.6s
[1A.4]  kiran walk fridge 1   @0.6-6.9s
[1A.5]  with sfx footsteps   @0.6-2.1s
[1B] 1B MCU kiran   (3.3s in the cut, at 0:07.2)  ...
[1C] 1C CU mum   (1.8s in the cut, at 0:10.5)  ...
[1D] 1D MCU kiran push.slow   (7.9s in the cut, at 0:12.3)  ...
[1E] 1E OTS kiran>mum   (3.4s in the cut, at 0:20.2)  ...
[1F] 1F CU kiran   (1.8s in the cut, at 0:23.6)  ...
[1G] 1G TWO kiran>mum   (5.7s in the cut, at 0:25.4)  ...

QC issues in these shots:
- error [intersection] 1A @2.5s: kiran and mum intersect at 2.5s (46cm apart)
- error [furniture] 1A @2.5s: kiran is inside the chair at 2.5s (8cm in)

YOUR LAST TAKES WERE REJECTED. Fix them:
patch:
1A.4 = kiran tiptoe fridge 0.5
problem: "tiptoe" is not a verb you can use. Your verbs: enter exit walk run sit stand kneel lean turn open close take give put wait.

patch:
1A.4 = kiran tiptoe fridge 0.5
problem: "tiptoe" is not a verb you can use. Your verbs: enter exit walk run sit stand kneel lean turn open close take give put wait.

The builder could not get this right. You are the director: write takes that pass.

Write 1 to 3 different takes. Each "patch" is plain patch lines, one change per line, nothing else. Smallest change first.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "takes",
  "pushback",
  "idea"
 ],
 "properties": {
  "takes": {
   "type": "array",
   "minItems": 1,
   "maxItems": 3,
   "description": "1 to 3 alternative takes, smallest change first",
   "items": {
    "type": "object",
    "additionalProperties": false,
    "required": [
     "purpose",
     "patch"
    ],
    "properties": {
     "purpose": {
      "type": "string",
      "description": "one sentence: what this take does for the story"
     },
     "patch": {
      "type": "string",
      "description": "patch lines in the SCENE patch language, one change per line, separated by newlines"
     }
    }
   }
  },
  "pushback": {
   "anyOf": [
    {
     "type": "string",
     "description": "if the note would hurt the cut, say why"
    },
    {
     "type": "null"
    }
   ]
  },
  "idea": {
   "anyOf": [
    {
     "type": "string",
     "description": "one idea the director didn't ask for, in one sentence"
    },
    {
     "type": "null"
    }
   ]
  }
 }
}

===== END OF QUESTION 6 =====

===== QUESTION 7 (review-lying-purpose) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

NOTE: "1D, the shock is too long"
GOAL: 1D, the shock is too long

TAKES (all passed the grammar, permission, locality and QC checks; that says nothing about whether they do what was asked):
1. Tightens the shock so it snaps
1D.2 ~2.5 -> ~3.5
changes 1D; fixes 0 QC issue(s); adds 0

2. A shorter shock
1D.2 ~2.5 -> ~1.5
changes 1D; fixes 0 QC issue(s); adds 0

3. Shortens the shock
1D.4 = kiran guilty ~0.5
changes 1D; fixes 0 QC issue(s); adds 0

THE SHOTS (before any take):
[scene1] scene 1 kitchen night act 1
[1A] 1A WS   (7.2s in the cut, at 0:00.0)  ...
[1B] 1B MCU kiran   (3.3s in the cut, at 0:07.2)  ...
[1C] 1C CU mum   (1.8s in the cut, at 0:10.5)  ...
[1D] 1D MCU kiran push.slow   (7.9s in the cut, at 0:12.3)
[1D.1]  kiran turn mum   @0.0-0.6s
[1D.2]  kiran shock ~2.5   @0.6-3.1s
[1D.3]  with sfx sting   @0.6-1.4s
[1D.4]  kiran guilty   @3.1-4.3s
[1D.5]  kiran say "I was... checking the fridge was still cold."   @4.3-7.6s
[1E] 1E OTS kiran>mum   (3.4s in the cut, at 0:20.2)  ...
[1F] 1F CU kiran   (1.8s in the cut, at 0:23.6)  ...
[1G] 1G TWO kiran>mum   (5.7s in the cut, at 0:25.4)  ...

Judge each take by its patch, not by its purpose line: purposes can be wrong. Order the takes best first by number, say for each take in its original numbering (take 1 first, not your ranking) whether it does what the note and plan asked without breaking what the plan says to keep, write the message to the director (results first, short), keep or sharpen any pushback, and give one idea. If no take fits, say in "redo" exactly what the builder should change.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "order",
  "fits",
  "message",
  "pushback",
  "idea",
  "redo"
 ],
 "properties": {
  "order": {
   "type": "array",
   "items": {
    "type": "integer"
   },
   "description": "take numbers, best first"
  },
  "fits": {
   "type": "array",
   "items": {
    "type": "boolean"
   },
   "description": "one per take in its original numbering (take 1 first, not your ranking): does it do what the note and plan asked?"
  },
  "message": {
   "type": "string",
   "description": "2-4 short sentences to the human director, results first"
  },
  "pushback": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "idea": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "redo": {
   "anyOf": [
    {
     "type": "string",
     "description": "only if no take fits: exactly what the builder should change, 1-3 sentences"
    },
    {
     "type": "null"
    }
   ]
  }
 }
}

===== END OF QUESTION 7 =====

===== QUESTION 8 (review-tone) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

NOTE: "1C, mum's line is a bit long, make it shorter but keep her warm and teasing"
GOAL: 1C, mum's line is a bit long, make it shorter but keep her warm and teasing
PLAN: Do exactly what the note says on 1C.
KEEP: everything the note doesn't mention
SUCCESS: the note is visibly done and nothing else changed

TAKES (all passed the grammar, permission, locality and QC checks; that says nothing about whether they do what was asked):
1. Shorter and blunt
1C.1 = mum say "Get out." to kiran
changes 1C; fixes 0 QC issue(s); adds 0

2. Shorter, still teasing
1C.1 = mum say "Still up?" to kiran
changes 1C; fixes 0 QC issue(s); adds 0

3. Warmer
1C.1 = mum say "Couldn't sleep either, love? It's very late, you know." to kiran
changes 1C; fixes 0 QC issue(s); adds 0

THE SHOTS (before any take):
[scene1] scene 1 kitchen night act 1
[1A] 1A WS   (7.2s in the cut, at 0:00.0)  ...
[1B] 1B MCU kiran   (3.3s in the cut, at 0:07.2)  ...
[1C] 1C CU mum   (1.8s in the cut, at 0:10.5)
[1C.1]  mum say "Couldn't sleep either?" to kiran   @0.0-1.4s
[1D] 1D MCU kiran push.slow   (7.9s in the cut, at 0:12.3)  ...
[1E] 1E OTS kiran>mum   (3.4s in the cut, at 0:20.2)  ...
[1F] 1F CU kiran   (1.8s in the cut, at 0:23.6)  ...
[1G] 1G TWO kiran>mum   (5.7s in the cut, at 0:25.4)  ...

Judge each take by its patch, not by its purpose line: purposes can be wrong. Order the takes best first by number, say for each take in its original numbering (take 1 first, not your ranking) whether it does what the note and plan asked without breaking what the plan says to keep, write the message to the director (results first, short), keep or sharpen any pushback, and give one idea. If no take fits, say in "redo" exactly what the builder should change.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "order",
  "fits",
  "message",
  "pushback",
  "idea",
  "redo"
 ],
 "properties": {
  "order": {
   "type": "array",
   "items": {
    "type": "integer"
   },
   "description": "take numbers, best first"
  },
  "fits": {
   "type": "array",
   "items": {
    "type": "boolean"
   },
   "description": "one per take in its original numbering (take 1 first, not your ranking): does it do what the note and plan asked?"
  },
  "message": {
   "type": "string",
   "description": "2-4 short sentences to the human director, results first"
  },
  "pushback": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "idea": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "redo": {
   "anyOf": [
    {
     "type": "string",
     "description": "only if no take fits: exactly what the builder should change, 1-3 sentences"
    },
    {
     "type": "null"
    }
   ]
  }
 }
}

===== END OF QUESTION 8 =====

===== QUESTION 9 (review-keep) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

NOTE: "1G, kiran laughs too long, but he must still laugh"
GOAL: 1G, kiran laughs too long, but he must still laugh
PLAN: Do exactly what the note says on 1G.
KEEP: everything the note doesn't mention
SUCCESS: the note is visibly done and nothing else changed

TAKES (all passed the grammar, permission, locality and QC checks; that says nothing about whether they do what was asked):
1. Cut the laugh so the moment ends cleanly
1G.3 -
changes 1G; fixes 0 QC issue(s); adds 0

2. A shorter laugh
1G.3 = kiran laugh ~0.6
changes 1G; fixes 0 QC issue(s); adds 0

3. Let the laugh breathe
1G.3 = kiran laugh ~2.5
changes 1G; fixes 0 QC issue(s); adds 0

THE SHOTS (before any take):
[scene1] scene 1 kitchen night act 1
[1A] 1A WS   (7.2s in the cut, at 0:00.0)  ...
[1B] 1B MCU kiran   (3.3s in the cut, at 0:07.2)  ...
[1C] 1C CU mum   (1.8s in the cut, at 0:10.5)  ...
[1D] 1D MCU kiran push.slow   (7.9s in the cut, at 0:12.3)  ...
[1E] 1E OTS kiran>mum   (3.4s in the cut, at 0:20.2)  ...
[1F] 1F CU kiran   (1.8s in the cut, at 0:23.6)  ...
[1G] 1G TWO kiran>mum   (5.7s in the cut, at 0:25.4)
[1G.1]  mum say "Get two forks."   @0.0-1.4s
[1G.2]  with music warm   @0.0-0.0s
[1G.3]  kiran laugh   @1.4-3.0s
[1G.4]  kiran walk counter   @3.0-4.5s
[1G.5]  kiran take fork   @4.5-5.4s

Judge each take by its patch, not by its purpose line: purposes can be wrong. Order the takes best first by number, say for each take in its original numbering (take 1 first, not your ranking) whether it does what the note and plan asked without breaking what the plan says to keep, write the message to the director (results first, short), keep or sharpen any pushback, and give one idea. If no take fits, say in "redo" exactly what the builder should change.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "order",
  "fits",
  "message",
  "pushback",
  "idea",
  "redo"
 ],
 "properties": {
  "order": {
   "type": "array",
   "items": {
    "type": "integer"
   },
   "description": "take numbers, best first"
  },
  "fits": {
   "type": "array",
   "items": {
    "type": "boolean"
   },
   "description": "one per take in its original numbering (take 1 first, not your ranking): does it do what the note and plan asked?"
  },
  "message": {
   "type": "string",
   "description": "2-4 short sentences to the human director, results first"
  },
  "pushback": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "idea": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "redo": {
   "anyOf": [
    {
     "type": "string",
     "description": "only if no take fits: exactly what the builder should change, 1-3 sentences"
    },
    {
     "type": "null"
    }
   ]
  }
 }
}

===== END OF QUESTION 9 =====

===== QUESTION 10 (review-all-wrong) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

NOTE: "1B, kiran should look guilty before he takes the cake"
GOAL: 1B, kiran should look guilty before he takes the cake
PLAN: Do exactly what the note says on 1B.
KEEP: everything the note doesn't mention
SUCCESS: the note is visibly done and nothing else changed

TAKES (all passed the grammar, permission, locality and QC checks; that says nothing about whether they do what was asked):
1. Guilty nod
1B.4 + kiran nod
changes 1B; fixes 0 QC issue(s); adds 0

2. Nervous laugh
1B.5 + kiran laugh
1B.5 + kiran smile
changes 1B; fixes 0 QC issue(s); adds 0

THE SHOTS (before any take):
[scene1] scene 1 kitchen night act 1
[1A] 1A WS   (7.2s in the cut, at 0:00.0)  ...
[1B] 1B MCU kiran   (3.3s in the cut, at 0:07.2)
[1B.1]  light practical
[1B.2]  kiran open fridge.door   @0.0-1.0s
[1B.3]  with sfx fridge.open   @0.0-0.5s
[1B.4]  kiran smile   @1.0-2.0s
[1B.5]  kiran take cake   @2.0-2.9s
[1C] 1C CU mum   (1.8s in the cut, at 0:10.5)  ...
[1D] 1D MCU kiran push.slow   (7.9s in the cut, at 0:12.3)  ...
[1E] 1E OTS kiran>mum   (3.4s in the cut, at 0:20.2)  ...
[1F] 1F CU kiran   (1.8s in the cut, at 0:23.6)  ...
[1G] 1G TWO kiran>mum   (5.7s in the cut, at 0:25.4)  ...

Judge each take by its patch, not by its purpose line: purposes can be wrong. Order the takes best first by number, say for each take in its original numbering (take 1 first, not your ranking) whether it does what the note and plan asked without breaking what the plan says to keep, write the message to the director (results first, short), keep or sharpen any pushback, and give one idea. If no take fits, say in "redo" exactly what the builder should change.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "order",
  "fits",
  "message",
  "pushback",
  "idea",
  "redo"
 ],
 "properties": {
  "order": {
   "type": "array",
   "items": {
    "type": "integer"
   },
   "description": "take numbers, best first"
  },
  "fits": {
   "type": "array",
   "items": {
    "type": "boolean"
   },
   "description": "one per take in its original numbering (take 1 first, not your ranking): does it do what the note and plan asked?"
  },
  "message": {
   "type": "string",
   "description": "2-4 short sentences to the human director, results first"
  },
  "pushback": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "idea": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "redo": {
   "anyOf": [
    {
     "type": "string",
     "description": "only if no take fits: exactly what the builder should change, 1-3 sentences"
    },
    {
     "type": "null"
    }
   ]
  }
 }
}

===== END OF QUESTION 10 =====

===== QUESTION 11 (pushback-punchline) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

NOTE: "1F, cut kiran's line, it's pointless"
GOAL: 1F, cut kiran's line, it's pointless
PLAN: Do exactly what the note says on 1F.
KEEP: everything the note doesn't mention
SUCCESS: the note is visibly done and nothing else changed

TAKES (all passed the grammar, permission, locality and QC checks; that says nothing about whether they do what was asked):
1. Cut the line
1F.2 -
changes 1F; fixes 0 QC issue(s); adds 0

2. Keep it but make it drier
1F.2 = kiran say "Suspiciously."
changes 1F; fixes 0 QC issue(s); adds 0

THE SHOTS (before any take):
[scene1] scene 1 kitchen night act 1
[1A] 1A WS   (7.2s in the cut, at 0:00.0)  ...
[1B] 1B MCU kiran   (3.3s in the cut, at 0:07.2)  ...
[1C] 1C CU mum   (1.8s in the cut, at 0:10.5)  ...
[1D] 1D MCU kiran push.slow   (7.9s in the cut, at 0:12.3)  ...
[1E] 1E OTS kiran>mum   (3.4s in the cut, at 0:20.2)  ...
[1F] 1F CU kiran   (1.8s in the cut, at 0:23.6)
[1F.1]  kiran nod   @0.0-0.6s
[1F.2]  kiran say "Very."   @0.6-1.4s
[1G] 1G TWO kiran>mum   (5.7s in the cut, at 0:25.4)  ...

Judge each take by its patch, not by its purpose line: purposes can be wrong. Order the takes best first by number, say for each take in its original numbering (take 1 first, not your ranking) whether it does what the note and plan asked without breaking what the plan says to keep, write the message to the director (results first, short), keep or sharpen any pushback, and give one idea. If no take fits, say in "redo" exactly what the builder should change.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "order",
  "fits",
  "message",
  "pushback",
  "idea",
  "redo"
 ],
 "properties": {
  "order": {
   "type": "array",
   "items": {
    "type": "integer"
   },
   "description": "take numbers, best first"
  },
  "fits": {
   "type": "array",
   "items": {
    "type": "boolean"
   },
   "description": "one per take in its original numbering (take 1 first, not your ranking): does it do what the note and plan asked?"
  },
  "message": {
   "type": "string",
   "description": "2-4 short sentences to the human director, results first"
  },
  "pushback": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "idea": {
   "anyOf": [
    {
     "type": "string"
    },
    {
     "type": "null"
    }
   ]
  },
  "redo": {
   "anyOf": [
    {
     "type": "string",
     "description": "only if no take fits: exactly what the builder should change, 1-3 sentences"
    },
    {
     "type": "null"
    }
   ]
  }
 }
}

===== END OF QUESTION 11 =====

===== QUESTION 12 (outline-two-scenes) =====


SYSTEM INSTRUCTIONS:

You are part of Crew, an AI film crew that takes direction from a human director.
A film is SCENE source compiled into 3D. Every line has an address, and a note changes exactly what was asked and nothing else.

How the crew works:
- Each role may only write its own line types. The schema you answer in enforces this.
- Patches are line ops against addresses from the listing (e.g. 1D.2). Addresses always refer to the listing you were shown.
- Return 2 or 3 takes. Each take states its purpose in one sentence, in story terms ("lets the guilt land"), not mechanics.
- Default to subtraction: trim before adding, fewer cuts, longer holds, fewer words.
- Smallest change that resolves the note. Never touch shots outside the targets: a locality guard re-renders every shot and rejects any take that changes one the note didn't name.
- Real-world defaults: walking 1.35 m/s, speaking pace from the cast list, real lenses on a 36x24 sensor. Don't write values the Style Bible already supplies.
- If the note would hurt the cut, still offer the takes, and push back with a reason.
- Offer one idea per round that the director didn't ask for. It is not applied.

SCENE LANGUAGE REFERENCE

Episode file:
  episode 1 "Title"
  scene 1 kitchen night act 1          scene <n> <set> <day|night|dawn|dusk> [act N]
  1D MCU kiran push.slow lens 50       shot header (column 0): <id> <type> [subjects] [move[.speed]] [lens mm] [angle low|eye|high] [side left|right]
    kiran@counter open fridge.door     body lines are indented, one beat each; actor@anchor pins where the actor is
    kiran shock ~2                     ~N = beat length in seconds
    with sfx sting                     with = starts together with the previous beat
    kiran say "Hi." to mum             dialogue; timing comes from the character's speaking pace
    mum walk kiran 1.2                 number after walk/run = speed in m/s
    light practical                    shot lighting
    trim 0.4 0.8                       cut 0.4s from the head and 0.8s from the tail of this shot
    hold 1                             freeze-extend the end of this shot by 1s

Addresses: "1D" is the header of shot 1D, "1D.2" its second body line.

Shot types: ECU CU MCU MS MLS FS WS EWS OTS POV TWO INSERT
  sizes (frame height at subject): ECU 0.18m, CU 0.38m, MCU 0.62m, MS 1m, MLS 1.45m, FS 2.3m, WS 4.5m, EWS 11m
  OTS: over the shoulder (a>b: over a's shoulder onto b)
  POV: point of view (a>b: a's eyes looking at b)
  TWO: two shot, both subjects framed
  INSERT: insert on a prop
  no subject = frame everyone present
Camera moves: static (locked off); push (dolly in toward the subject); pull (dolly out from the subject); pan (camera fixed, aim follows the subject); track (camera travels alongside the subject); orbit (camera arcs around the subject); crane (camera rises); tilt (camera tilts up the subject); zoom (focal length increases (flattens space, unlike push)); handheld (organic operator shake)
Move speeds: slow med fast
Light: day (neutral daylight); night (low blue ambient, warm practicals); warm (golden, soft); cool (cold, desaturated); dim (underexposed, moody); bright (high key); practical (lit by an in-scene source (fridge, lamp, screen)); moon (hard blue key from a window)

Blocking verbs (Blocking role):
  enter: appear at @anchor (or the set entrance), then walk to the target if given
  exit: walk to the target (default: entrance) and leave
  walk: walk to an anchor or character; optional number = speed m/s
  run: run to an anchor or character; optional number = speed m/s
  sit: sit (at target if given)
  stand: stand up
  kneel: kneel
  lean: lean (on target if given)
  turn: turn the body to face a target
  open: open a prop
  close: close a prop
  take: pick up a prop
  give: give <prop> <char>
  put: put <prop> <anchor> (default: where you stand)
  wait: hold position (use ~N)
Performance verbs (Animator role):
  look: eyeline to a target (persists)
  glare: angry look at a target
  neutral: relax the face
  smile: smile
  laugh: laugh
  frown: frown
  shock: startle / shock
  sad: sadness
  angry: anger
  scared: fear
  guilty: caught out / guilt
  think: thinking
  nod: nod
  shake: head shake
  shrug: shrug
  sigh: sigh
  cry: cry
  wave: wave (at target)
  point: point at target
  blink: slow blink
Dialogue (Writers' room): say whisper shout  "text" [to <char>] [~N]
Sound (Sound role):
  sfx <name> [~N]: door door.creak knock footsteps fridge.hum fridge.open glass mug plate fork phone clock rain thunder wind crash chair kettle sting whoosh light.switch
  music <cue>: tense warm sad upbeat mystery comic stop
  ambience <name>: room night kitchen rain street stop
  silence ~N
Edit (Editor role): trim <head> <tail>, hold <seconds>, or delete a shot header to drop the shot.

Show bible sets (show.scene; the crew reads these, people write them):
  include <library-set> [as <id>]    pull in a ready-made set from the library (boarding_room cafe classroom library_corner living_room london_street office park staffroom veranda_corridor); anchor/prop/dress lines after it extend it
  set <id> size <w> <d> [open] [entrance <anchor>]    open = outdoors, no walls
  anchor <id> at <x> <z> [face <deg>] [is <prop>]    a stand mark; furniture sits in front of it (chairs, sofas, beds sit on it); is none = no furniture
  dress <prop> at <x> <z> [face <deg>] [height <y> | on <anchor>] [scale <s>]    set dressing with no stand mark; centred on x z, front pointing at face (0 = +z)
  prop <id> at <x> <z> [height <y> | on <anchor>] [is <prop>]    a prop people can take, give, put and open; drawn as the library prop
  face 0 looks toward +z (the default camera); x runs right, z toward the camera.

Patch text (for humans and tools):
  1D.2 ~2.5 -> ~1.5        token edit
  1D.2 = kiran shock ~1.5  replace line
  1D.2 + kiran sigh        insert after line (after a header = first body line)
  1D.2 -                   delete line (delete a header = drop the shot)
  1D ++ 1DA CU mum         new shot after 1D (DP only)

Physics: walk 1.35 m/s (foot-slide above 2.3), run 3.4 m/s, `walk <char>` stops 0.9m away, people are 0.48m wide.
Continuity: characters keep their position, pose, expression and props across cuts within a scene. Changing where someone ends a shot moves where they start the next one; pin them with actor@anchor if that is not wanted.

SHOW BIBLE (show.scene)

show "Midnight Snack"

# Style Bible: what this show always does. Agents only write what differs.
style lens 35
style sensor 36x24
style fps 24
style twos on
style asl 3.5
style move static
style speed slow
style pace 165
style side left
style palette warm
style act 1 palette night

cast kiran name "Kiran" height 1.74 color teal voice male pace 175 model male tts preset:bob
cast mum name "Mum" height 1.63 color coral voice female pace 150 model female tts preset:anna

# Anchors are stand marks; `face` is where a character settles facing.
# Furniture is drawn in front of its mark (doors and windows behind it; chairs under it).
set kitchen size 7 5.5 entrance door
  anchor door at -3.1 0.9 face 90
  anchor sink at 1.5 0.9 face 0
  anchor counter at 0.9 -1.45 face 180
  anchor fridge at 2.3 -1.45 face 180
  anchor table at -0.15 0.55 face 180
  anchor chair at -1.15 -0.2 face 90 is chair
  anchor window at -1.2 -2.4 face 0 is window
  prop cake at 2.3 -2.0 on fridge height 1.05
  prop fridge.door at 2.3 -1.72 on fridge
  prop fork at 0.9 -1.95 on counter
  prop mug at -0.4 -0.2 on table

---

REQUEST:

Break this script into an episode outline for this show.
- One scene per location/time change; set and time from the lists.
- Shot ids are scene number + letter (1A, 1B, ...), in order. Cover dialogue the way a good editor would cut it: establish, then singles or OTS on the speaker or the listener whose reaction matters.
- "beat" says what happens in the shot in one or two sentences, with any dialogue word for word.
- Use only this show's cast and sets.

SCRIPT:
INT. KITCHEN - NIGHT
KIRAN (16) creeps in and opens the fridge. MUM is at the table in the dark.
MUM: Hungry?
KIRAN: (startled) I was just getting water.
MUM: From the cake?
He freezes. She smiles.

INT. KITCHEN - DAWN
Kiran is asleep at the table. Mum puts a plate with the last slice of cake beside him.
MUM: (softly) Happy birthday.

---
REPLY FORMAT: reply with only a JSON object (no code fences, no prose) matching this JSON Schema:
{
 "type": "object",
 "additionalProperties": false,
 "required": [
  "title",
  "scenes"
 ],
 "properties": {
  "title": {
   "type": "string"
  },
  "scenes": {
   "type": "array",
   "minItems": 1,
   "items": {
    "type": "object",
    "additionalProperties": false,
    "required": [
     "set",
     "time",
     "shots"
    ],
    "properties": {
     "set": {
      "type": "string",
      "enum": [
       "kitchen"
      ]
     },
     "time": {
      "type": "string",
      "enum": [
       "day",
       "night",
       "dawn",
       "dusk"
      ]
     },
     "shots": {
      "type": "array",
      "minItems": 1,
      "items": {
       "type": "object",
       "additionalProperties": false,
       "required": [
        "id",
        "type",
        "subjects",
        "beat"
       ],
       "properties": {
        "id": {
         "type": "string",
         "description": "scene number + letter: 1A, 1B, ... 2A"
        },
        "type": {
         "type": "string",
         "enum": [
          "ECU",
          "CU",
          "MCU",
          "MS",
          "MLS",
          "FS",
          "WS",
          "EWS",
          "OTS",
          "POV",
          "TWO",
          "INSERT"
         ]
        },
        "subjects": {
         "type": "array",
         "items": {
          "type": "string",
          "enum": [
           "kiran",
           "mum"
          ]
         }
        },
        "beat": {
         "type": "string",
         "description": "what happens in this shot, including any dialogue word for word"
        }
       }
      }
     }
    }
   }
  }
 }
}

===== END OF QUESTION 12 =====

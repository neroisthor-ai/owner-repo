# The Bob previs: all the code

Everything that built the 3D previs of *The Bob*, grouped so you can lift any piece out and reuse it.

## What's where

| Folder | What it is | Take it if you want... |
|---|---|---|
| `web/real/index.html` | The finished page, real names | The film itself. Needs the assets pack next to it. |
| `web/alias/index.html` | The finished page, alias names (Carver, Hale, Fenwick, Dr Clara) | The anonymised version |
| `src/index_master.html` | **The master source.** One self-contained HTML file: three.js scenes, characters, animation, camera director, lip-sync player, grading, renderer, UI | Anything visual. This is the single source of truth. |
| `src/modules/` | Earlier standalone copies of chunks that were spliced into the master: `director.js` (shot list and framing solver), `perform.js` (walk cycle, idle, eyelines, lip-sync faces), `moshi.js` (Kilimanjaro, campus, drone shots), `film.js` (older scene code) | Reading one system on its own. The master has newer versions, so copy from the master for real use. |
| `pipeline/characters/` | `mii.py` builds the Mii-style characters, `people.py` holds the shape tools (SDF modelling, meshing, skinning, packing into `.mesh.wasm`) | Making new characters |
| `pipeline/voices/` | `lines.py` holds every line of dialogue, with an alias copy. `humanvo.py` generates the human-sounding voices (blended Kokoro voices, natural pauses, breaths). `tts_all.py` and `vo.py` are the older voice generators. | New voices or a recast |
| `pipeline/timing_lipsync/` | `timeline.py` lays out the film's timings from the real voice lengths. `lipsync.py` turns audio into mouth shapes. | Retiming after line changes; lip-sync for any audio |
| `pipeline/audio/` | `mix.py` mixes the opening (camcorder sound, narrator), and `mix_full.py` the rest of the film (rooms, reverb, music stand-ins, effects) | Sound design |
| `pipeline/variants/` | `embed.py` builds the real and alias pages from the master, and `runvar.sh` rebuilds both versions end to end | Making more versions, such as other names or languages |
| `tools/render_checks/` | Headless Chrome scripts that render any shot or time to PNG (`allshots.js`, `ev.js`), make contact sheets (`sheet2.py`) and test the full renderer (`mtest.js`) | Checking shots without opening the page |
| `tools/qa/` | `audit.js` and `audit_run.js` step through every shot looking for bodies inside furniture, hands under tables, the camera inside walls and blocked subjects. `summ.py` summarises the results. | Catching glitches before anyone sees them |
| `data/` | Timelines, lip-sync data and voice durations for both versions | Reusing the exact timings |

## The parts most worth stealing

1. **The director (framing solver)**, in `src/index_master.html`: search for `DIRECTOR`. You give it a shot type (single, two shot, over-the-shoulder, insert) and a size (ECU to EWS). It places the camera with proper headroom, look room and the 180-degree rule, then keeps it out of walls and people.
2. **The film renderer**: search for `async function renderFilm`.
   - Adaptive passes per frame, with shadows drawn once per motion-blur step.
   - Off-screen grass and switched-off lights are skipped.
   - It saves in parts cut on shot boundaries, can resume after a crash, keeps going in background tabs and spots a graphics-card reset.
   - It encodes MP4 with sound through WebCodecs.
3. **The performance layer**: search for `PERFORMANCE`. It covers walk cycles, breathing and idle movement, eyelines, and lip-sync faces driven by the audio.
4. **The QA audit**, `tools/qa/audit.js`. It's generic, so it works on any three.js scene that exposes its state.
5. **The variant builder**, `pipeline/variants/embed.py`. It's a simple pattern for producing several versions from one master.

## How to run it

**The page**
1. Put `index.html` in a folder with the assets: the seven `*.mesh.wasm` character files and `soundtrack.mp3`, from the assets pack.
2. Serve the folder with `python -m http.server 8000`. Opening it as a file won't work, because the page loads files.
3. Open `localhost:8000` in Chrome.

**The pipeline (Python 3)**
- Packages: `numpy scipy soundfile scikit-image kokoro-onnx`.
- The Kokoro model files come from the kokoro-onnx releases.
- The order is: voices, then `timeline.py`, then `lipsync.py`, then `mix.py` and `mix_full.py`, then `embed.py`.
- The scripts still have this machine's folder paths written in (`/home/claude/...`). Change them to your own before running.

**Tools**: Node.js with Playwright (`npm i playwright`).

## Licences and credits

- three.js (MIT) and mp4-muxer (MIT) load from a CDN.
- Kokoro TTS is Apache-2.0.
- The music is original temp material standing in for the real songs.
- The script and story belong to Abeer Seth and the crew.

# M45 Timelapse: the plan

SPEC-6.md M45: while a city plays, small frames from a few fixed views are kept at regular game-time
steps; City history makes a 15, 30 or 60 second video from them, with overlays and optional music,
exported as a file that plays on phones and in group chats, plus the first and last frames as pictures.

## 1. Recording
- **Views**: `wide` (the whole map, a fixed pose high over its middle) and `orbit` (the busiest area:
  the 256 m cell with the most built floor, recomputed each game month and kept unless another is
  clearly busier; the camera circles it, a few degrees further round each frame).
- **When**: every `TIMELAPSE.step` game ticks (3 game hours; 7.5 s of real time at 3×), the two views
  taking turns, so each view gets a frame every 6 game hours (4 a game month). Only while the page is
  visible, playing (not the menu, photo mode, a battle viewer, a visit or a run being watched), and
  the setting is on. A jump of many steps at once (fast-forward, a slow tab) takes one frame.
- **How**: `GameRenderer.captureView(pose, w, h)` draws one frame through the ordinary pipeline from
  the view's pose (problem icons, previews, data maps and zone paint hidden, as photo mode does),
  copies the canvas into a small 2D canvas (no resize: the post targets stay allocated), and puts the
  player's camera back before the frame they see is drawn. The copy is encoded as JPEG off the frame
  (`convertToBlob`).
- **Size**: 960×540, JPEG quality 0.72 (about 40–70 kB a frame). Measured on the bench city: the
  capture's main-thread time and its draw calls; logged.
- **Store** (`src/client/timelapseStore.ts`, IndexedDB `citybloom-timelapse`): frames keyed by city,
  view and tick, with the population and the city's date; a city record (name, when recording started,
  whether the city is older than timelapses, bytes and frames kept). Limits: 400 frames a view and
  32 MB a city (past either, the older half of the frames is thinned to every other one: a long city
  keeps its whole life, thinner further back); 160 MB for all cities (the city recorded least recently
  goes first). The thinning is pure (`timelapseThin.ts`) and tested on a twenty-year city.
- **Which city**: a key the page keeps beside the city in its saves (`SaveMeta.timelapse`, written by
  the page as the region binding is, never in the sim's state, so hashes and replays don't move). A new
  city gets one at founding; a saved city without one (any city from before this update) gets one when
  it's opened and its recording starts then, which the history panel says plainly. A joined shared
  city records under the room's code on each player's own machine; nothing is sent.
- **Setting**: "Record a timelapse" (Settings → Game), on by default.

## 2. Making the video
- City history (Y): a Timelapse section: what's recorded (frames, since when, size), and Make
  timelapse: length 15, 30 or 60 s, view (whole map or busiest area), overlays (city name, date,
  population, milestones and disasters from the chronicle), music, then Make. A progress bar; the
  result plays in the panel with Share or Download, and Save first picture / Save last picture.
- **Frames to video**: 30 frames a second; video time runs evenly through game time (an early year
  takes as long as a late one even where older frames were thinned), each output frame cross-fading
  between the two stored frames either side. Overlays are drawn on the frames. 960×540.
- **Format**: MP4 with H.264 video (and AAC audio where the browser can encode it), the one format
  that plays everywhere a video is sent: iPhones, Android, WhatsApp, iMessage, Chrome, Edge and
  Safari. Encoded with WebCodecs' `VideoEncoder` (Chrome and Edge 94+, Safari 16.4+), much faster than
  real time, muxed with `mp4-muxer`. Where H.264 can't be encoded, `MediaRecorder` records it in real
  time (MP4 where offered, else WebM). Logged in DECISIONS.
- **Music**: a short loop made from the game's own synthesiser (`src/audio`), rendered offline to the
  video's length; AAC where the browser encodes it, else Opus in MP4 (Chrome, Edge, Android play it).
- **Sharing**: the share sheet on a phone (as the save export does), else a download.

## 3. Tests
- Unit: the thinning (limits held on a twenty-year city, first and last kept, spread even), the busiest
  area, the overlay text, the frame schedule (frame index → the two stored frames and their mix).
- E2E: a city grown for several game years with recording on (a coarser step in test builds), each
  length made through the panel; the file loads in a `<video>`, lasts its length, and its last frame
  shows more town than its first (pixels that aren't grass); storage under its limit. Phones upright and
  sideways.
- Budget: the capture's cost on the bench city (main-thread ms, draw calls, triangles) in the VM, and on
  the Mac's GPU under "To check on the Mac".

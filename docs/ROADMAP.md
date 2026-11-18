# Atelier roadmap

Atelier is going to be used a lot, and soon. This file says what comes next and why, in order.
Each item gets its own spec and an approved plan before any code is written.

## The first real use: an AI refresher course

The first material made with Atelier is a refresher course on AI. **Topic 1: understanding
hallucinations and how to catch them.**

Everything below is prioritised by what that lesson needs: slides, a voiceover, the presenter's
face in the corner, and later a transcript. If a feature doesn't help produce that lesson, it
waits.

## 1. Bring over what video-studio got right

`video-studio/` in the course repo (Remotion) is being replaced by Atelier. Before it is archived:

- **GUIDE-01 as a deck.** `video-studio/scenes/guide-01.json` holds an 11-shot lesson: each shot
  has its voiceover script, its layout, and the order things appear. Rebuild it as 11 Atelier
  pages and keep the scripts. This also tests whether Atelier can hold a full lesson.
- **The microphone recorder.** `video-studio/capture/recorder.ts` (95 lines, no dependencies)
  records the mic in the browser and saves a 16-bit mono wav. Port it as is.
- **The background render job.** The server runs a slow export while the page checks on it
  every few seconds. Use it for video export.

Remotion, the React Flow view and the old diagram renderer are not coming over.

## 2. Presenter mode

What video-studio taught us: build the voiceover and the reveal together.

- Each element can have a **reveal step**. A page shows its elements in steps, not all at once.
- Each page has **speaker notes**: the script, shown under the picture while presenting.
- Present full screen. `→` reveals the next step, then moves to the next page. `←` goes back.

## 3. Recording, Loom-style: face in the corner

Record a lesson while presenting: slides, voice, and the **camera in a corner bubble**.

Proposed approach, to confirm in the spec: **record the parts separately and combine them on
export.** Don't capture the screen as one video.

- Save three things: camera video, mic audio, and the time of every `→` press.
- On export, render the slides from SVG at those times, put the camera bubble on top, and add the
  voice (ffmpeg, as a background render job).
- Why: text stays sharp because it is drawn, not filmed. A typo on a slide gets fixed without
  re-recording. The bubble's corner, size and shape can change after recording.
- What it costs: export runs on the server, and is slower than a screen recording.

Open questions to settle by measuring, not guessing:

- Whether webm from the browser works reliably with ffmpeg on this machine, for both camera and
  mic.
- How long exporting a 10-minute lesson takes.
- Bubble defaults: corner, size, circle or rounded square, mirrored or not.

## 4. Transcript (near future)

A transcript of every recorded take, used three ways: captions for the video, a text version of
the lesson, and a check that what was said matches the script.

Anthropic has no speech-to-text model, so this needs a second provider, chosen the same way as
the image provider: run the same real recordings through each candidate and measure accuracy and
latency. **Lessons are recorded in English for now**, so accuracy here means English technical
vocabulary. Spanish support can wait. The candidates are not decided yet.

## Already designed: AI image generation

A ninth chat tool, `generate_image(prompt, aspect)`. It saves the image into `data/images` by
hash and places an Image element. Providers to compare: OpenAI and Google, on three real course
prompts, comparing latency and cost.

**The rule: generate illustration, never content.** Covers, backgrounds, visual metaphors and
missing icons are fine. Anything with words inside is not: diagrams, tables and charts stay
native elements so they remain editable, and the text in the PDF stays selectable and
searchable. Each teacher gets a usage limit, and a log records who asked for what, with which
model.

## Known issues

- Atelier's dev server and video-studio's capture page both use port **5174**.
- Diagrams are local JSON files in `data/`. Once teachers use Atelier, that has to become a
  database. That is the next big architecture decision.

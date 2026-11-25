# On Deck

A chief of staff for the Even Realities G2. Claude reads your Gmail and Google Calendar and keeps a short queue of the few things that need a decision from you. The lens shows one card at a time: what needs you, why it matters, and the action Claude already drafted. Tap to approve, swipe to skip, or say what to change.

Entry for the Heads Up: Even Realities Hackathon, **AI Assistants & Work** track.

**Business model:** a subscription chief of staff for busy professionals, at about $3 a month. Today it works with your own Claude and Deepgram keys.

## Track fit

**Claude is the core of On Deck.** Claude decides which emails and invites need a decision, ranks them, drafts every reply, answer and message, revises drafts from your voice or a quick edit, and writes the day summary. Google Workspace (Gmail and Google Calendar) is the data source. Both Claude and Google Workspace are listed apps for this track. Without Claude there is no queue and no draft; the app only shows and sends what Claude produced and you approved.

## How it works on the glasses

| Card | What it shows | The drafted action |
|---|---|---|
| Reply | An email that needs an answer | A reply in the same thread |
| Calendar | An invite or a conflict | Accept, decline or maybe, with an optional note to the organizer |
| Prep | Your next meeting | One message to that meeting's attendees |

| Input | What happens |
|---|---|
| Tap | Approve. A 3-second countdown starts; tap again to undo. Then it sends. |
| Swipe up | Skip to the next card. Skipped cards can be reviewed at the end. |
| Swipe down | Voice edit: say the change ("tell him I'll be ten minutes late"), tap, and Claude revises the draft on the lens. Tap again to send. |
| Hold | Menu: read the full draft, three one-tap edits, edit by voice, skip, refresh. |
| Double-tap | Exit (system dialog), or back from a sub-screen. |

Tap and the R1 ring are the whole interface: no phone, no typing.

When the queue is empty: **All clear. Head up.** plus a one-line summary of your day.

**Nothing sends without your tap.** Every approval has a 3-second undo. Demo mode never sends anything.

## Demo mode (no accounts needed)

```bash
npm install
npm run dev                 # http://localhost:5173
npm run simulate            # Even Hub simulator, demo mode
```

Or open `http://localhost:5173/?demo=1` in a browser (arrows swipe, Enter taps, Backspace double-taps, M opens the menu).

On the glasses with nothing set up, the first screen offers **Tap to try the demo**, so anyone can run the full flow from the glasses alone.

Demo mode loads a sample inbox and calendar with fictional people. Without a Claude key it uses pre-written sample cards and sample edits, labeled as samples. **With a Claude key, Claude ranks and drafts the sample inbox live and revises from your voice**, and still nothing is sent.

## Connect your own accounts

On Deck runs inside the Even Realities app's WebView, which sets three limits: every server must be listed in `app.json`, Google sign-in doesn't work inside an embedded WebView, and there is no built-in speech-to-text. So every connection is bring-your-own, and the phone talks to each service directly:

1. **Claude.** Paste your Claude API key on the phone screen. Calls go from the phone to `api.anthropic.com` with the key you entered. Default model: `claude-sonnet-5-5`.
2. **Gmail and Google Calendar.** Deploy the Apps Script bridge in [`apps-script/Code.gs`](apps-script/Code.gs) to your own Google account, from a computer (steps at the top of the file, about 5 minutes). It runs as you and can do only five things: read a snapshot, reply in an existing thread, answer an invite, email the attendees of your own event, and ping. Every request needs a secret only you have; run `revoke` to shut it off. Paste the web app URL and secret on the phone screen.
3. **Voice (optional).** Paste a Deepgram key. Your voice goes from the glasses mic to Deepgram only while you're dictating an edit. Without a key, voice falls back to the three one-tap edits on each card.

Keys are stored on your phone only and are never packaged in the app. See [PRIVACY.md](PRIVACY.md).

## Publish to Even Hub

The `store` folder has the listing: a 24 x 24 pixel icon, the description, release notes and simulator screenshots.

1. Sign in once (needs your Even Realities password): `npx evenhub login`
2. `bash store/upload-beta.sh you@example.com` builds, packs, uploads, invites you as a tester and promotes the build to beta.
3. Test from the glasses menu with the phone locked, then promote the build to Public in the developer portal to submit it for review.

## Safety

- Nothing is sent, answered or changed without a tap on the glasses, and each tap has a 3-second undo.
- Email content is treated as data; Claude is told never to follow instructions inside it.
- Every card is checked before it's shown: the thread or event must be in your snapshot, calendar answers only go to invites, and prep messages only go to that event's attendees. The Google bridge checks the same things again before it sends.

## Tests

```bash
npm test
```

20 tests: the glasses flow and the five demo beats with a fake clock and network, the Apps Script bridge's guards against fake Google services, and the Deepgram client against a fake socket. Every lens screen is also checked to fit 576 x 288 without overflow.

## Hackathon disclosure

### What existed before Nov 23, 2026

- **Uplift**, Davison Vann's iPhone and Apple Watch workout app. On Deck reuses its bring-your-own-key pattern for the Claude API.
- **Lift HUD**, Davison's Even Hub workout app (its first code was written Nov 25, 2026). On Deck reuses its Even Hub shell: the lens renderer that updates text in place, the measured font widths, the text fitting and the phone-side mirror.
- Even's official SDK, CLI, simulator and `evenhub-templates`.

### What was built Nov 25 to 29, 2026

On Deck itself: the card engine and queue, the Claude ranking, drafting and revision calls, the Gmail and Calendar bridge, voice edits, demo mode, the phone screen, the tests, and this README.

## License

MIT

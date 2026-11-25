# On Deck privacy

On Deck has no server of its own. It talks directly from your phone to the services you connect, using keys you enter.

**What goes where**
- **Claude API (api.anthropic.com):** your unread email (sender, subject, up to 1,200 characters of the latest message) and your calendar for the next 36 hours, so Claude can pick and draft your cards. Sent with your own Claude API key.
- **Your Google Apps Script bridge (script.google.com, script.googleusercontent.com):** a script you deploy to your own Google account. It reads that email and calendar data, and sends only what you approve with a tap.
- **Deepgram (api.deepgram.com), only if you add a key:** audio from the glasses microphone, only while you are dictating an edit to a draft.

**Microphone (g2-microphone):** used only during a voice edit, which you start by swiping down. It stops when you tap or double-tap.

**On your phone:** your keys, settings, the current queue and a short activity log are stored in On Deck's own storage in the Even Realities app. Nothing is sent to the developer.

**Demo mode** uses built-in sample data and sends nothing anywhere, unless you add a Claude key, in which case the sample data goes to Claude to be drafted.

To stop all access, clear your keys on the phone screen and run `revoke` in your Apps Script (or delete its deployment).

Contact: Davison Vann, developer of On Deck.

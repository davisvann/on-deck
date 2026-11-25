# On Deck — DoraHacks submission draft

**Track:** AI Assistants & Work

**One line:** A chief of staff on your Even G2: Claude turns your inbox and calendar into one decision at a time, already drafted. Tap to send.

**The problem.** Your phone is in your pocket and your inbox is full. Most of it doesn't need you, but a few things do: a flight that moved, a friend asking if you're still on, an invite that clashes. Finding those means pulling out the phone, opening two apps and typing on glass.

**Who it's for.** People who live in Gmail and Google Calendar and are often away from a screen: founders, operators, salespeople, anyone walking between meetings.

**How it works.** Claude reads your unread mail and the next day and a half of your calendar, picks the few items that need a decision, ranks them and drafts the action for each: a reply, an answer to an invite, or a note to the people in your next meeting. The G2 shows one card at a time: what needs you, why it matters, and the draft. Tap to approve. Swipe to skip. Swipe down and say what to change ("tell Sam I'll be ten minutes late"), and Claude rewrites the draft on the lens. When you're done: "All clear. Head up."

**Business model.** A subscription chief of staff for busy professionals, at about $3 a month. Today it works with your own Claude and Deepgram keys.

**Claude is the core.** Claude does the ranking, the drafting and the revising. Google Workspace (Gmail and Google Calendar) is the source.

**Safety.** Nothing sends without your tap, and each tap has a 3-second undo. Every card is checked against your real threads and events, and messages can only go to people already in that thread or meeting.

**Built with.** Even Hub SDK (TypeScript), the Claude API (Claude Sonnet 5.5), Gmail and Google Calendar through an Apps Script bridge you deploy to your own account, and Deepgram for voice.

**Hands-free.** Tap and the R1 ring do everything: approve, skip, edit by voice.

**Try it.** On the glasses, the first screen offers "Tap to try the demo", with no accounts needed. Or run it in the Even Hub simulator: `npm install`, `npm run dev`, `npm run simulate`. Add a Claude key to see Claude draft the sample inbox live.

**Repo:** https://github.com/davisvann/on-deck  **Video:** (link)

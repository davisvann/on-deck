// Demo mode: a realistic sample inbox and calendar (fictional people), so judges can run
// the whole flow in the simulator with no accounts connected. In demo mode nothing is ever
// sent anywhere. With a Claude key, Claude ranks and drafts these samples live; without
// one, the pre-written sample cards below are used and labeled as samples.

import type { Snapshot, Queue, Card } from './types'

const iso = (ms: number) => new Date(ms).toISOString()
const at = (base: Date, h: number, m = 0, dayOffset = 0) => { const d = new Date(base); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.getTime() }

export function demoSnapshot(now = Date.now()): Snapshot {
  const d = new Date(now)
  return {
    now: iso(now),
    me: 'you@example.com',
    threads: [
      { threadId: 'demo-t-flight', subject: 'Your Austin flight was moved', from: 'Priya Shah <priya@northwind-travel.example>', date: iso(now - 25 * 60e3), messages: 1,
        snippet: "Hi, the airline moved your 6:10 PM flight to Austin to 8:45 PM tonight. That lands after your 9:30 dinner with the Halvorsen team. I can rebook you on the 5:30 PM, which still has aisle seats. Want me to switch it? I need to confirm within the hour. Priya" },
      { threadId: 'demo-t-sam', subject: 'Still on for 2?', from: 'Sam Ortiz <sam@ortiz.example>', date: iso(now - 50 * 60e3), messages: 3,
        snippet: "Hey, still good for 2:00 at Octane? I'll grab a table by the window. Sam" },
      { threadId: 'demo-t-pitch', subject: 'Quick sponsorship idea for Q1', from: 'Kendra Lowe <kendra@brightline-media.example>', date: iso(now - 3 * 3600e3), messages: 1,
        snippet: "Hi! Loved your recent post. We run a newsletter for ops leaders and think a Q1 sponsorship could be a great fit. Do you have 20 minutes next week? Kendra" },
      { threadId: 'demo-t-receipt', subject: 'Your receipt from Octane Coffee', from: 'Octane Coffee <receipts@octane.example>', date: iso(now - 20 * 3600e3), messages: 1,
        snippet: 'Thanks for your order. Total $6.25.' },
    ],
    events: [
      { eventId: 'demo-e-sam', title: 'Coffee with Sam', start: iso(at(d, 14)), end: iso(at(d, 14, 45)), location: 'Octane Coffee', myStatus: 'yes', organizer: 'sam@ortiz.example', guests: ['sam@ortiz.example'] },
      { eventId: 'demo-e-lena', title: 'Vendor call: Lena (Fieldworks)', start: iso(at(d, 16)), end: iso(at(d, 16, 30)), myStatus: 'owner', organizer: 'you@example.com', guests: ['lena@fieldworks.example'],
        description: 'Agenda: SOW sign-off, launch date. Lena asked for the final SOW before the call.' },
      { eventId: 'demo-e-roadmap', title: 'Q1 roadmap review', start: iso(at(d, 10, 0, 1)), end: iso(at(d, 11, 0, 1)), myStatus: 'invited', organizer: 'alex@yourco.example', guests: ['alex@yourco.example', 'you@example.com', 'team@yourco.example'] },
      { eventId: 'demo-e-dentist', title: 'Dentist', start: iso(at(d, 10, 0, 1)), end: iso(at(d, 11, 0, 1)), myStatus: 'owner', organizer: 'you@example.com', guests: [] },
    ],
  }
}

export function demoQueue(now = Date.now()): Queue {
  const cards: Card[] = [
    { id: 'c-flight', kind: 'reply', who: 'Priya Shah', title: 'Flight moved to 8:45 PM. Rebook?',
      why: 'You would land after the 9:30 Halvorsen dinner.',
      action: { type: 'reply', threadId: 'demo-t-flight', body: 'Yes please, rebook me on the 5:30 PM. Aisle seat if you can. Thanks, Priya!' },
      quickEdits: ['Keep the 8:45 instead', 'Ask for an exit row', 'Shorter'],
      presetRevisions: {
        'Keep the 8:45 instead': "Thanks Priya, let's keep the 8:45. I'll let the Halvorsen team know I'll be late.",
        'Ask for an exit row': 'Yes please, rebook me on the 5:30 PM. Exit row if possible, aisle otherwise. Thanks!',
        'Shorter': 'Yes, the 5:30 please. Thanks!',
      } },
    { id: 'c-sam', kind: 'reply', who: 'Sam Ortiz', title: 'Coffee at 2:00 still on?',
      why: 'Sam is grabbing a table for you at Octane.',
      action: { type: 'reply', threadId: 'demo-t-sam', body: 'Yes, still on. See you at 2:00 at Octane!' },
      quickEdits: ["I'll be 10 minutes late", 'Move it to 3:00', 'Shorter'],
      presetRevisions: {
        "I'll be 10 minutes late": "Still on, but I'm running about ten minutes late. See you around 2:10!",
        'Move it to 3:00': 'Could we push to 3:00? Same spot. Sorry for the shuffle!',
        'Shorter': 'Yes! See you at 2.',
      } },
    { id: 'c-pitch', kind: 'reply', who: 'Kendra Lowe', title: 'Sponsorship pitch wants a call',
      why: 'Cold pitch. Safe to skip or decline politely.',
      action: { type: 'reply', threadId: 'demo-t-pitch', body: "Thanks Kendra, we're not taking on sponsorships this quarter. I'll reach out if that changes." },
      quickEdits: ['Offer 20 min next week', 'Ask for a one-pager', 'Shorter'],
      presetRevisions: {
        'Offer 20 min next week': 'Thanks Kendra. Happy to do 20 minutes next week. Send a couple of times that work.',
        'Ask for a one-pager': 'Thanks Kendra. Could you send a one-pager with rates and audience first?',
        'Shorter': 'Thanks, not this quarter.',
      } },
    { id: 'c-roadmap', kind: 'calendar', who: 'Alex (invite)', title: 'Roadmap review clashes with dentist',
      why: 'Tomorrow 10:00, same slot as your dentist appointment.',
      action: { type: 'rsvp', eventId: 'demo-e-roadmap', response: 'no', note: "I have a conflict at 10. Could we do 11:30, or I'll send notes ahead?" },
      quickEdits: ['Accept anyway', 'Maybe, join late', 'Decline, no note'],
      presetRevisions: {
        'Accept anyway': 'Accept',
        'Maybe, join late': "Maybe. Note: I may join 15 minutes late. I'll catch up from the notes.",
        'Decline, no note': 'Decline',
      } },
    { id: 'c-lena', kind: 'prep', who: 'Lena, 4:00 PM', title: 'Vendor call at 4:00 with Lena',
      why: 'She asked for the final SOW before the call.',
      action: { type: 'email', eventId: 'demo-e-lena', to: ['lena@fieldworks.example'], subject: 'Before our 4:00',
        body: "Hi Lena, quick agenda for 4:00: 1) SOW sign-off, 2) launch date. The final SOW is coming your way within the hour. Talk soon." },
      quickEdits: ['Push the call to 4:30', 'Add: bring the timeline', 'Shorter'],
      presetRevisions: {
        'Push the call to 4:30': 'Hi Lena, could we start at 4:30 instead? Same agenda: SOW sign-off and launch date.',
        'Add: bring the timeline': 'Hi Lena, agenda for 4:00: 1) SOW sign-off, 2) launch date. Could you bring the rollout timeline? Final SOW is on its way.',
        'Shorter': 'Hi Lena, see you at 4. SOW sign-off and launch date. SOW coming within the hour.',
      } },
  ]
  return { cards, summary: 'Coffee with Sam at 2, Lena at 4, flight to Austin tonight.', builtAt: now, source: 'sample' }
}

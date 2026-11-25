// Shared shapes: what the Google bridge returns, what Claude produces, what the lens shows.

export interface MailThread {
  threadId: string
  subject: string
  from: string          // "Name <email>"
  date: string          // ISO
  snippet: string       // plain text of the latest message, trimmed
  messages: number
}

export interface CalEvent {
  eventId: string
  title: string
  start: string         // ISO
  end: string
  allDay?: boolean
  location?: string
  myStatus: 'yes' | 'no' | 'maybe' | 'invited' | 'owner'
  organizer?: string    // email
  guests: string[]      // emails
  description?: string
}

export interface Snapshot {
  now: string           // ISO, the bridge's clock
  me: string            // the account's email
  threads: MailThread[]
  events: CalEvent[]    // next ~36 h, plus pending invites up to 14 days out
}

export type Action =
  | { type: 'reply'; threadId: string; body: string }
  | { type: 'rsvp'; eventId: string; response: 'yes' | 'no' | 'maybe'; note?: string }
  | { type: 'email'; eventId: string; to: string[]; subject: string; body: string }

export interface Card {
  id: string
  kind: 'reply' | 'calendar' | 'prep'
  who: string           // the person or thing it's about, short
  title: string         // what needs you, a few words
  why: string           // one line: why it matters
  action: Action        // the drafted action; nothing happens until the user taps
  quickEdits: string[]  // up to three one-tap revisions
  revised?: boolean     // the draft was changed by a voice or quick edit
  presetRevisions?: Record<string, string>  // demo only: canned results for quick edits
}

export interface Queue {
  cards: Card[]
  summary: string       // one-line day summary for the empty state
  builtAt: number
  source: 'claude' | 'sample'
}

export interface Settings {
  claudeKey: string
  model: string
  bridgeUrl: string
  bridgeSecret: string
  deepgramKey: string
  demo: boolean
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5'
export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recommended)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
]

/** The text a card's draft shows on the lens and the phone. */
export function draftText(a: Action): string {
  if (a.type === 'reply') return a.body
  if (a.type === 'email') return a.body
  const verb = a.response === 'yes' ? 'Accept' : a.response === 'no' ? 'Decline' : 'Maybe'
  return a.note ? `${verb}. Note: ${a.note}` : verb
}

export function withDraft(a: Action, text: string): Action {
  if (a.type === 'rsvp') {
    const m = text.match(/^(Accept|Decline|Maybe)\.?\s*(?:Note:\s*)?([\s\S]*)$/i)
    if (m) {
      const response = m[1].toLowerCase() === 'accept' ? 'yes' : m[1].toLowerCase() === 'decline' ? 'no' : 'maybe'
      return { ...a, response, note: m[2].trim() || undefined }
    }
    return { ...a, note: text.trim() || undefined }
  }
  return { ...a, body: text }
}

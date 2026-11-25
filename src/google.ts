// Gmail + Google Calendar through the user's own Apps Script "bridge".
//
// Why a bridge: Google blocks its sign-in inside embedded WebViews, and Even Hub apps
// can't open the system browser. So the user deploys a small Apps Script (apps-script/Code.gs)
// under their own Google account, once, from a computer. It runs as them, holds no data,
// and only does five things: ping, snapshot, reply, rsvp, email-an-attendee. Every request
// carries a secret only the user has. The phone talks to it directly; there is no server
// of ours in the middle.
//
// Requests are "simple" CORS requests (POST, text/plain body, no custom headers), so the
// WebView sends no preflight; Apps Script answers through script.googleusercontent.com.

import type { Snapshot, Action, Settings } from './types'
import type { Fetch } from './claude'

async function post(s: Settings, op: string, payload: object, f: Fetch, signal?: AbortSignal): Promise<any> {
  if (!s.bridgeUrl || !s.bridgeSecret) throw new Error('Google bridge not set up')
  const res = await f(s.bridgeUrl, { method: 'POST', redirect: 'follow', signal, body: JSON.stringify({ op, secret: s.bridgeSecret, ...payload }) })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json) throw new Error(`Google bridge error ${res.status}`)
  if (!json.ok) throw new Error(json.error || 'Google bridge refused the request')
  return json
}

export async function ping(s: Settings, f: Fetch = fetch): Promise<string> {
  return (await post(s, 'ping', {}, f)).email
}

export async function snapshot(s: Settings, f: Fetch = fetch, signal?: AbortSignal): Promise<Snapshot> {
  const j = await post(s, 'snapshot', {}, f, signal)
  return { now: j.now, me: j.me, threads: j.threads || [], events: j.events || [] }
}

/** Carry out an approved action. Only ever called after the user's tap on the glasses. */
export async function perform(s: Settings, a: Action, f: Fetch = fetch): Promise<void> {
  if (a.type === 'reply') await post(s, 'reply', { threadId: a.threadId, body: a.body }, f)
  else if (a.type === 'rsvp') await post(s, 'rsvp', { eventId: a.eventId, response: a.response, note: a.note || '' }, f)
  else await post(s, 'email', { eventId: a.eventId, to: a.to, subject: a.subject, body: a.body }, f)
}

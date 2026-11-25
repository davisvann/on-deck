// Runs apps-script/Code.gs in a sandbox with fake Google services, to check the bridge's
// guards: the secret, reply-in-thread only, invites only, attendees only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const sent: any[] = []
const replies: any[] = []
const statuses: any[] = []
const props: Record<string, string> = {}
const me = 'me@example.com'

const ev = (id: string, status: string, owned = false) => ({
  getId: () => id, getTitle: () => `Event ${id}`, getStartTime: () => new Date(), getEndTime: () => new Date(), isAllDayEvent: () => false,
  getLocation: () => '', getMyStatus: () => status, isOwnedByMe: () => owned, getCreators: () => ['alex@co.example'],
  getGuestList: () => [{ getEmail: () => 'lena@fieldworks.example' }], getDescription: () => 'desc',
  setMyStatus: (s: string) => statuses.push([id, s]),
})
const events: Record<string, any> = { inv: ev('inv', 'INVITED'), mine: ev('mine', 'OWNER', true) }

const sandbox: any = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null, setProperty: (k: string, v: string) => { props[k] = v }, deleteProperty: (k: string) => { delete props[k] } }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ setMimeType: () => ({ body: JSON.parse(s) }) }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => me }) },
  Utilities: { getUuid: () => '1234-5678' },
  Logger: { log: () => {} },
  GmailApp: {
    getInboxUnreadCount: () => 1,
    search: () => [{ getId: () => 't1', getFirstMessageSubject: () => 'Hi', getMessages: () => [{ getFrom: () => 'Sam <sam@x.example>', getDate: () => new Date(), getPlainBody: () => 'Still on?' }] }],
    getThreadById: (id: string) => id === 't1' ? { reply: (b: string) => replies.push([id, b]) } : null,
    sendEmail: (to: string, subject: string, body: string) => sent.push({ to, subject, body }),
  },
  CalendarApp: {
    GuestStatus: { YES: 'YES', NO: 'NO', MAYBE: 'MAYBE' },
    getDefaultCalendar: () => ({ getName: () => 'cal', getEvents: () => Object.values(events) }),
    getEventById: (id: string) => events[id] || null,
  },
}
vm.createContext(sandbox)
vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), sandbox)
const call = (req: object) => sandbox.doPost({ postData: { contents: JSON.stringify(req) } }).body

let pass = 0
const test = (n: string, fn: () => void) => { fn(); pass++; console.log('ok -', n) }

test('refuses everything before setup and with a wrong secret', () => {
  assert.equal(call({ op: 'ping', secret: '' }).error, 'Unauthorized')
  sandbox.setup()
  assert.equal(call({ op: 'ping', secret: 'nope' }).error, 'Unauthorized')
})
const secret = props.ONDECK_SECRET
test('ping and snapshot', () => {
  assert.equal(call({ op: 'ping', secret }).email, me)
  const s = call({ op: 'snapshot', secret })
  assert.equal(s.ok, true); assert.equal(s.threads[0].threadId, 't1'); assert.ok(s.events.some((e: any) => e.eventId === 'inv' && e.myStatus === 'invited'))
})
test('reply only into an existing thread', () => {
  assert.equal(call({ op: 'reply', secret, threadId: 't1', body: 'Yes!' }).ok, true)
  assert.deepEqual(replies, [['t1', 'Yes!']])
  assert.match(call({ op: 'reply', secret, threadId: 'zzz', body: 'x' }).error, /not found/)
  assert.match(call({ op: 'reply', secret, threadId: 't1', body: '  ' }).error, /empty/)
})
test('rsvp only on invites; note goes to the organizer', () => {
  assert.equal(call({ op: 'rsvp', secret, eventId: 'inv', response: 'no', note: 'Conflict' }).ok, true)
  assert.deepEqual(statuses, [['inv', 'NO']]); assert.equal(sent[0].to, 'alex@co.example')
  assert.match(call({ op: 'rsvp', secret, eventId: 'mine', response: 'yes' }).error, /own this event/)
  assert.match(call({ op: 'rsvp', secret, eventId: 'inv', response: 'sure' }).error, /Bad response/)
})
test('email only to people on the event', () => {
  assert.equal(call({ op: 'email', secret, eventId: 'mine', to: ['lena@fieldworks.example'], subject: 'Agenda', body: 'Hi' }).ok, true)
  assert.match(call({ op: 'email', secret, eventId: 'mine', to: ['attacker@evil.example'], subject: 'x', body: 'x' }).error, /on the event/)
})
test('revoke shuts it off', () => { sandbox.revoke(); assert.equal(call({ op: 'ping', secret }).error, 'Unauthorized') })
console.log(`\n${pass} tests passed`)

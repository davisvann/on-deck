// Logic tests: drive On Deck exactly as glasses input would, with a fake clock and fake network.
import assert from 'node:assert/strict'
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { OnDeck, blankState, UNDO_MS } from '../src/app'
import { validateCards } from '../src/claude'
import { demoSnapshot } from '../src/demo'
import { draftText } from '../src/types'
import { textWidth, innerWidth, maxLines } from '../src/lens'

let T = new Date(2026, 10, 27, 9, 0, 0).getTime()
const clock = () => T
const settle = () => new Promise(r => setTimeout(r, 0))

const tap = (a: OnDeck) => a.handle({ sysEvent: {} as never })
const dbl = (a: OnDeck) => a.handle({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } as never })
const up = (a: OnDeck) => a.handle({ textEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } as never })
const down = (a: OnDeck) => a.handle({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } as never })
const menu = (a: OnDeck, re: RegExp) => { const m = a.build().menu!.find(x => re.test(x.name)); assert.ok(m, `no menu ${re}`); a.handle({ menuItemClickEvent: { itemID: m!.id } as never }) }
const tick = (a: OnDeck, ms: number) => { T += ms; (a as any).tick() }

type Call = { url: string; init: any; body: any }
function fakeNet(handler: (c: Call) => any) {
  const calls: Call[] = []
  const f = (async (url: string, init: any) => {
    const c = { url, init, body: init?.body ? JSON.parse(init.body) : null }
    calls.push(c)
    const out = await handler(c)
    return { ok: out.status ? out.status < 400 : true, status: out.status || 200, json: async () => out.json ?? out }
  }) as unknown as typeof fetch
  return { f, calls }
}

const claudeQueue = (snapIds: { thread: string; sam: string; invite: string; lena: string }) => ({
  content: [{ type: 'tool_use', name: 'deliver_queue', input: {
    summary: 'Sam at 2, Lena at 4.',
    cards: [
      { kind: 'reply', who: 'Priya Shah', title: 'Flight moved. Rebook?', why: 'Lands after dinner.', action: { type: 'reply', threadId: snapIds.thread, body: 'Yes, the 5:30 please.' }, quickEdits: ['Keep 8:45', 'Exit row', 'Shorter'] },
      { kind: 'reply', who: 'Sam Ortiz', title: 'Coffee at 2?', why: 'Sam is saving a table.', action: { type: 'reply', threadId: snapIds.sam, body: 'Yes, see you at 2!' }, quickEdits: ['Ten minutes late', 'Move to 3', 'Shorter'] },
      { kind: 'calendar', who: 'Alex', title: 'Roadmap clashes', why: 'Dentist at 10.', action: { type: 'rsvp', eventId: snapIds.invite, response: 'no', note: 'Conflict at 10.' }, quickEdits: ['Accept', 'Maybe', 'No note'] },
      { kind: 'prep', who: 'Lena', title: 'Call at 4', why: 'Wants SOW.', action: { type: 'email', eventId: snapIds.lena, to: ['lena@fieldworks.example'], subject: 'Before 4', body: 'Agenda: SOW, launch.' }, quickEdits: ['Push to 4:30', 'Add timeline', 'Shorter'] },
      // Must be dropped: unknown thread, and a recipient who isn't on the event.
      { kind: 'reply', who: 'X', title: 'x', why: 'x', action: { type: 'reply', threadId: 'nope', body: 'hi' }, quickEdits: [] },
      { kind: 'prep', who: 'Y', title: 'y', why: 'y', action: { type: 'email', eventId: snapIds.lena, to: ['attacker@evil.example'], subject: 's', body: 'b' }, quickEdits: [] },
    ] } }],
})

let pass = 0
async function test(name: string, fn: () => Promise<void> | void) { await fn(); pass++; console.log('ok -', name) }

function demoApp(net = fakeNet(() => { throw new Error('demo mode must not touch the network') })) {
  const a = new OnDeck(null, clock, net.f)
  a.s = blankState(); a.s.settings.demo = true
  return { a, net }
}

await test('first run without settings shows the setup card', () => {
  const a = new OnDeck(null, clock); a.s = blankState(); a.page = a.restPage()
  assert.equal(a.page.name, 'setup')
  assert.match(a.build().texts.map(t => t.content).join('\n'), /Set up On Deck on your phone/)
})

await test('a judge with no phone setup can start the demo from the glasses with one tap', async () => {
  const a = new OnDeck(null, clock, (() => { throw new Error('no network in demo') }) as never); a.s = blankState(); a.page = a.restPage()
  tap(a); await settle()
  assert.equal(a.s.settings.demo, true); assert.equal(a.page.name, 'card')
})

await test('demo without a Claude key: sample queue, no network at all', async () => {
  const { a, net } = demoApp()
  await a.refresh()
  assert.equal(a.s.queue!.source, 'sample'); assert.equal(a.s.queue!.cards.length, 5)
  assert.equal(a.page.name, 'card'); assert.equal(net.calls.length, 0)
  const p = a.build()
  assert.match(p.texts[0].content, /REPLY\s+\/\s+Priya Shah/); assert.match(p.texts[1].content, /1 of 5/)
})

await test('beat 2: tap approves, 3-second undo window, then sent (demo sends nothing)', async () => {
  const { a, net } = demoApp(); await a.refresh()
  tap(a); assert.equal(a.page.name, 'sending')
  tap(a); assert.equal(a.page.name, 'card', 'tap during countdown undoes')
  tap(a); tick(a, UNDO_MS - 100); assert.equal(a.page.name, 'sending')
  tick(a, 200); await settle()
  assert.equal(a.page.name, 'sent'); assert.match(a.build().texts.find(t => t.name === 'title')!.content, /Reply sent to Priya/)
  assert.match(a.build().texts.find(t => t.name === 'box')!.content, /Demo mode: nothing left this phone/)
  assert.match(a.build().texts.find(t => t.name === 'why')!.content, /4 left on deck/)
  assert.equal(net.calls.length, 0)
  tick(a, 2000); assert.equal(a.page.name, 'card'); assert.match(a.build().texts[0].content, /Sam Ortiz/)
})

await test('beat 3 (sample fallback): quick edit "ten minutes late" revises, tap sends', async () => {
  const { a } = demoApp(); await a.refresh()
  tap(a); tick(a, UNDO_MS); await settle(); tick(a, 2000) // flight done
  menu(a, /10 minutes late/)
  assert.equal(a.page.name, 'card')
  const c = a.current()!
  assert.match(draftText(c.action), /ten minutes late/); assert.ok(c.revised)
  assert.match(a.build().texts.find(t => t.name === 'why')!.content, /sample edit/)
})

await test('voice without a Claude key falls back to quick edits, with the reason', async () => {
  const { a } = demoApp(); await a.refresh()
  down(a)
  assert.equal(a.page.name, 'quick'); assert.match(a.build().texts.find(t => t.name === 'title')!.content, /Claude key/)
  dbl(a); assert.equal(a.page.name, 'card')
})

await test('beat 4 and 5: swipe skips, queue empties to "All clear. Head up." with the day summary; skipped can be reviewed', async () => {
  const { a } = demoApp(); await a.refresh()
  for (let i = 0; i < 5; i++) up(a)
  assert.equal(a.page.name, 'clear')
  const txt = a.build().texts.map(t => t.content).join('\n')
  assert.match(txt, /All clear\. Head up\./); assert.match(txt, /Coffee with Sam at 2/); assert.match(txt, /5 skipped/)
  up(a); assert.equal(a.page.name, 'card'); assert.equal(a.counts().pending, 5)
})

await test('demo WITH a Claude key: Claude builds the queue from the sample snapshot; bad cards are dropped; Google is never called', async () => {
  const snap = demoSnapshot(T)
  const net = fakeNet(c => {
    assert.equal(c.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(c.init.headers['anthropic-dangerous-direct-browser-access'], 'true'); assert.equal(c.init.headers['x-api-key'], 'sk-test')
    if (c.body.tools[0].name === 'deliver_queue') return claudeQueue({ thread: 'demo-t-flight', sam: 'demo-t-sam', invite: 'demo-e-roadmap', lena: 'demo-e-lena' })
    return { content: [{ type: 'tool_use', name: 'deliver_revision', input: { text: "Still on, but running ten minutes late. See you at 2:10!" } }] }
  })
  const { a } = demoApp(net); a.s.settings.claudeKey = 'sk-test'
  await a.refresh()
  assert.equal(a.s.queue!.source, 'claude'); assert.equal(a.s.queue!.cards.length, 4, 'two invalid cards dropped')
  assert.ok(snap.threads.length)
  up(a) // skip flight
  await a.applyEdit("Tell Sam I'll be ten minutes late")
  assert.match(draftText(a.current()!.action), /ten minutes late/)
  assert.match(a.build().texts.find(t => t.name === 'why')!.content, /Revised by Claude/)
  assert.ok(net.calls.every(c => !c.url.includes('script.google')))
})

await test('live mode: snapshot from the bridge, Claude drafts, tap + 3 s performs exactly the drafted reply', async () => {
  const snap = demoSnapshot(T)
  const net = fakeNet(c => {
    if (c.url.startsWith('https://script.google.com')) {
      assert.equal(c.init.method, 'POST'); assert.equal(c.init.headers, undefined, 'no custom headers: simple CORS request')
      assert.equal(c.body.secret, 'shh')
      if (c.body.op === 'snapshot') return { ok: true, ...snap }
      if (c.body.op === 'reply') return { ok: true }
      if (c.body.op === 'rsvp') return { ok: false, error: 'Event not found' }
    }
    return claudeQueue({ thread: 'demo-t-flight', sam: 'demo-t-sam', invite: 'demo-e-roadmap', lena: 'demo-e-lena' })
  })
  const a = new OnDeck(null, clock, net.f); a.s = blankState()
  Object.assign(a.s.settings, { claudeKey: 'sk-test', bridgeUrl: 'https://script.google.com/macros/s/abc/exec', bridgeSecret: 'shh' })
  await a.refresh()
  assert.equal(a.page.name, 'card')
  tap(a); tick(a, UNDO_MS); await settle(); await settle()
  const sent = net.calls.filter(c => c.body?.op === 'reply')
  assert.equal(sent.length, 1); assert.deepEqual({ threadId: sent[0].body.threadId, body: sent[0].body.body }, { threadId: 'demo-t-flight', body: 'Yes, the 5:30 please.' })
  assert.equal(a.page.name, 'sent')
  // Skip Sam; the calendar answer fails at the bridge and the card stays, with the reason.
  tick(a, 2000); up(a)
  tap(a); tick(a, UNDO_MS); await settle(); await settle()
  assert.equal(a.page.name, 'card'); assert.match(a.current()!.why, /Not sent: Event not found/)
})

await test('nothing is sent without a tap: refreshing, skipping and editing never call reply/rsvp/email', async () => {
  const net = fakeNet(c => c.url.startsWith('https://script.google.com') ? { ok: true, ...demoSnapshot(T) } : claudeQueue({ thread: 'demo-t-flight', sam: 'demo-t-sam', invite: 'demo-e-roadmap', lena: 'demo-e-lena' }))
  const a = new OnDeck(null, clock, net.f); a.s = blankState()
  Object.assign(a.s.settings, { claudeKey: 'k', bridgeUrl: 'https://script.google.com/macros/s/abc/exec', bridgeSecret: 's' })
  await a.refresh(); up(a); up(a); await a.refresh(); menu(a, /Read full/); dbl(a)
  assert.ok(net.calls.every(c => !['reply', 'rsvp', 'email'].includes(c.body?.op)))
})

await test('validateCards guards ids, invite status and recipients', () => {
  const snap = demoSnapshot(T)
  const ok = validateCards([
    { kind: 'calendar', action: { type: 'rsvp', eventId: 'demo-e-sam', response: 'yes' } },       // not an invite -> drop
    { kind: 'calendar', action: { type: 'rsvp', eventId: 'demo-e-roadmap', response: 'yes' } },   // ok
    { kind: 'prep', action: { type: 'email', eventId: 'demo-e-lena', to: ['LENA@fieldworks.example'], body: 'hi' } }, // ok, case-insensitive
  ], snap)
  assert.equal(ok.length, 2); assert.equal(ok[1].action.type === 'email' && ok[1].action.subject, 'Vendor call: Lena (Fieldworks)')
})

await test('root double-tap opens the system exit dialog (mode 1); sub-pages go back', async () => {
  const calls: number[] = []
  const a = new OnDeck({ shutDownPageContainer: async (m: number) => { calls.push(m); return true }, setLocalStorage: async () => true, createStartUpPageContainer: async () => 0, rebuildPageContainer: async () => true, textContainerUpgrade: async () => true } as never, clock)
  a.s = blankState(); a.s.settings.demo = true; await a.refresh()
  menu(a, /Read full/); dbl(a); assert.equal(a.page.name, 'card'); assert.deepEqual(calls, [])
  dbl(a); assert.deepEqual(calls, [1])
})

await test('every page fits the lens: no overflow, one capture container, menu and list limits', async () => {
  const { a } = demoApp(); await a.refresh()
  const check = () => {
    const p = a.build()
    assert.ok(p.texts.length <= 8)
    assert.equal(p.texts.filter(t => t.capture).length + (p.list ? 1 : 0), 1, `one capture on ${p.key}`)
    for (const t of p.texts) {
      if (t.name === 'full') { assert.ok(t.content.length <= 1000); continue } // the read page scrolls on purpose
      const lines = t.content.split('\n')
      assert.ok(lines.length <= maxLines(t), `${p.key}/${t.name}: ${lines.length} lines`)
      for (const l of lines) assert.ok(textWidth(l) <= innerWidth(t), `${p.key}/${t.name} too wide: "${l}" ${textWidth(l)} > ${innerWidth(t)}`)
      assert.ok(t.name.length <= 16)
    }
    for (const m of p.menu || []) assert.ok(new TextEncoder().encode(m.name).length <= 32)
    assert.ok((p.menu || []).length <= 10)
    if (p.list) assert.ok(p.list.items.length <= 20 && p.list.items.every(i => new TextEncoder().encode(i).length <= 63))
  }
  for (let i = 0; i < 5; i++) { check(); menu(a, /Read full/); check(); dbl(a); down(a); check(); dbl(a); tap(a); check(); tap(a); up(a) }
  check()
  a.page = { name: 'error', message: 'Google bridge refused the request: Unauthorized. '.repeat(6) }; check()
  a.page = { name: 'loading' }; check(); a.page = { name: 'setup' }; check()
  a.transcript = 'Tell Sam I will be ten minutes late and that I am bringing the deck and also the printed agenda for both of us'; a.page = { name: 'listening' }; check(); a.page = { name: 'revising' }; check()
})

console.log(`\n${pass} tests passed`)

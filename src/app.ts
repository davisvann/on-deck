// On Deck controller: the decision queue, glasses input, and every lens page.
// Promise: nothing is sent, answered or changed without the user's tap, and every tap
// gets a 3-second window to undo before anything leaves the phone.

import { OsEventTypeList, AudioInputSource, type EvenHubEvent, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Card, Queue, Settings } from './types'
import { DEFAULT_MODEL, draftText, withDraft } from './types'
import { buildQueue, revise, type Fetch } from './claude'
import * as G from './google'
import { demoQueue, demoSnapshot } from './demo'
import { deepgram, browserSpeech, type Transcriber } from './stt'
import { LensRenderer, PageSpec, TextBox, ListBox, MenuItem, fit, fitBox, clampLines, innerWidth, textWidth } from './lens'

export type Status = 'pending' | 'sent' | 'skipped'

export interface State {
  v: 1
  settings: Settings
  queue: Queue | null
  status: Record<string, Status>
  log: { at: number; text: string }[]
  savedAt: number
}

export const KEY = 'ondeck.state.v1'
export const UNDO_MS = 3000

type Page =
  | { name: 'setup' } | { name: 'loading' } | { name: 'error'; message: string }
  | { name: 'card' } | { name: 'sending'; until: number } | { name: 'sent'; text: string; until: number }
  | { name: 'listening' } | { name: 'revising' } | { name: 'quick'; reason?: string } | { name: 'read' } | { name: 'clear' }

const M = { READ: 1, VOICE: 2, QUICK0: 3, QUICK1: 4, QUICK2: 5, SKIP: 6, REFRESH: 7 }

export function blankState(): State {
  return { v: 1, settings: { claudeKey: '', model: DEFAULT_MODEL, bridgeUrl: '', bridgeSecret: '', deepgramKey: '', demo: false }, queue: null, status: {}, log: [], savedAt: 0 }
}

const byteFit = (s: string, max = 32) => { let o = ''; for (const ch of s) { if (new TextEncoder().encode(o + ch).length > max) break; o += ch } return o }
const byteLen = (s: string) => new TextEncoder().encode(s).length
const rightAlign = (s: string, w: number) => { const gap = Math.floor((w - 4 - textWidth(s)) / 5); return gap > 0 ? ' '.repeat(gap) + s : s }
const KIND = { reply: 'REPLY', calendar: 'CALENDAR', prep: 'PREP' } as const
const firstName = (who: string) => who.split(/[\s,(]/)[0] || who

// ---------- Layout (576 x 288, 27 px lines) ----------
const ROW0 = { x: 0, y: 0, w: 466, h: 32 }
const ROW0R = { x: 470, y: 0, w: 106, h: 32 }
const TITLE = { x: 0, y: 32, w: 576, h: 30 }
const WHY = { x: 0, y: 62, w: 576, h: 30 }
const BOX = { x: 0, y: 94, w: 576, h: 154, border: 2, radius: 8, pad: 8 }
const HINT = { x: 0, y: 254, w: 576, h: 34 }
const LIST = { x: 0, y: 66, w: 576, h: 222 }

export class OnDeck {
  s: State = blankState()
  page: Page = { name: 'setup' }
  renderer: LensRenderer
  listActions: (() => void)[] = []
  onState: () => void = () => {}
  transcript = ''
  private stt: Transcriber | null = null
  private abort: AbortController | null = null
  private ticker: ReturnType<typeof setInterval> | null = null
  private sendingCard: string | null = null

  constructor(private bridge: EvenAppBridge | null, public now: () => number = () => Date.now(), private f: Fetch = (...a) => fetch(...a)) {
    this.renderer = new LensRenderer(bridge)
  }

  // ---------- Lifecycle ----------

  async load() {
    let local: State | null = null, remote: State | null = null
    const parse = (raw?: string | null) => { try { const x = raw ? JSON.parse(raw) : null; return x && x.v === 1 ? x as State : null } catch { return null } }
    try { local = parse(localStorage.getItem(KEY)) } catch { /* no storage */ }
    if (this.bridge) { try { remote = parse(await this.bridge.getLocalStorage(KEY)) } catch { /* unavailable */ } }
    const best = [local, remote].filter(Boolean).sort((a, b) => b!.savedAt - a!.savedAt)[0]
    if (best) this.s = { ...blankState(), ...best, settings: { ...blankState().settings, ...best.settings } }
    this.page = this.restPage()
  }

  persist() {
    this.s.savedAt = this.now()
    const raw = JSON.stringify(this.s)
    try { localStorage.setItem(KEY, raw) } catch { /* private mode */ }
    if (this.bridge) this.bridge.setLocalStorage(KEY, raw).catch(() => {})
    this.onState()
  }

  start() { this.render(); this.ticker = setInterval(() => this.tick(), 250) }
  stop() { if (this.ticker) clearInterval(this.ticker) }

  get configured() { const st = this.s.settings; return st.demo || (!!st.claudeKey && !!st.bridgeUrl && !!st.bridgeSecret) }
  get mode(): 'demo' | 'live' { return this.s.settings.demo ? 'demo' : 'live' }

  /** The page to show when nothing is in progress. */
  restPage(): Page {
    if (!this.configured) return { name: 'setup' }
    if (!this.s.queue) return { name: 'loading' }
    return this.current() ? { name: 'card' } : { name: 'clear' }
  }

  current(): Card | null {
    const q = this.s.queue
    if (!q) return null
    return q.cards.find(c => (this.s.status[c.id] || 'pending') === 'pending') || null
  }

  counts() {
    const q = this.s.queue
    const st = (c: Card) => this.s.status[c.id] || 'pending'
    const cards = q ? q.cards : []
    return { total: cards.length, sent: cards.filter(c => st(c) === 'sent').length, skipped: cards.filter(c => st(c) === 'skipped').length, pending: cards.filter(c => st(c) === 'pending').length }
  }

  private tick() {
    const p = this.page
    if (p.name === 'sending' && this.now() >= p.until) { void this.commitSend(); return }
    if (p.name === 'sent' && this.now() >= p.until) { this.page = this.restPage(); this.render(); return }
    if (p.name === 'sending') this.render()
  }

  private log(text: string) { this.s.log.unshift({ at: this.now(), text }); this.s.log = this.s.log.slice(0, 50); this.persist() }

  // ---------- Queue ----------

  async refresh() {
    if (!this.configured) { this.page = { name: 'setup' }; this.render(); return }
    this.abort?.abort()
    const ac = new AbortController(); this.abort = ac
    this.page = { name: 'loading' }; this.render()
    try {
      const st = this.s.settings
      let q: Queue
      if (st.demo) q = st.claudeKey ? await buildQueue(st, demoSnapshot(this.now()), this.f, ac.signal) : demoQueue(this.now())
      else q = await buildQueue(st, await G.snapshot(st, this.f, ac.signal), this.f, ac.signal)
      if (ac.signal.aborted) return
      this.s.queue = q; this.s.status = {}
      this.log(`Queue built by ${q.source === 'claude' ? 'Claude' : 'sample data'}: ${q.cards.length} cards`)
      this.page = this.restPage()
    } catch (e) {
      if (ac.signal.aborted) return
      this.page = { name: 'error', message: (e as Error).message }
    }
    this.render()
  }

  // ---------- Input ----------

  handle(e: EvenHubEvent) {
    if (e.audioEvent?.audioPcm) { this.stt?.sendPcm(e.audioEvent.audioPcm); return }
    if (e.menuItemClickEvent) { this.onMenu(e.menuItemClickEvent.itemID || 0); return }
    const type = (env?: { eventType?: OsEventTypeList }) => env ? (env.eventType ?? OsEventTypeList.CLICK_EVENT) : null
    if (e.listEvent) {
      const t = type(e.listEvent)
      if (t === OsEventTypeList.CLICK_EVENT) { const a = this.listActions[e.listEvent.currentSelectItemIndex ?? 0]; if (a) a() }
      else if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) this.onBack()
      return
    }
    if (e.textEvent) {
      const t = type(e.textEvent)
      if (t === OsEventTypeList.SCROLL_TOP_EVENT) this.onSwipe('up')
      else if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT) this.onSwipe('down')
      else if (t === OsEventTypeList.CLICK_EVENT) this.onTap()
      else if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) this.onBack()
      return
    }
    if (e.sysEvent) {
      const t = type(e.sysEvent)
      if (t === OsEventTypeList.CLICK_EVENT) { if (!this.renderer.page?.list) this.onTap() }
      else if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) this.onBack()
      else if (t === OsEventTypeList.SYSTEM_EXIT_EVENT || t === OsEventTypeList.ABNORMAL_EXIT_EVENT) { this.stopVoice(); this.persist() }
    }
  }

  onTap() {
    switch (this.page.name) {
      case 'card': return this.approve()
      case 'sending': return this.undoSend()
      case 'sent': this.page = this.restPage(); return this.render()
      case 'listening': return void this.finishVoice()
      case 'read': this.page = { name: 'card' }; return this.render()
      case 'clear': case 'error': case 'loading': return void this.refresh()
      case 'setup': if (!this.configured) { this.s.settings.demo = true; this.persist() } return void this.refresh()
    }
  }

  onSwipe(dir: 'up' | 'down') {
    switch (this.page.name) {
      case 'card': return dir === 'up' ? this.skip() : this.startVoice()
      case 'clear': if (dir === 'up' && this.counts().skipped) return this.reviewSkipped(); return
    }
  }

  onBack() {
    switch (this.page.name) {
      case 'sending': return this.undoSend()
      case 'listening': this.stopVoice(); this.page = { name: 'card' }; return this.render()
      case 'revising': this.abort?.abort(); this.page = { name: 'card' }; return this.render()
      case 'quick': case 'read': this.page = { name: 'card' }; return this.render()
      default:
        // Root pages: double-tap opens the system exit dialog.
        this.stopVoice(); this.persist()
        this.bridge?.shutDownPageContainer(1)
    }
  }

  onMenu(id: number) {
    const c = this.current()
    if (!c || this.page.name !== 'card') { if (id === M.REFRESH) void this.refresh(); return }
    if (id === M.READ) { this.page = { name: 'read' }; return this.render() }
    if (id === M.VOICE) return this.startVoice()
    if (id === M.SKIP) return this.skip()
    if (id === M.REFRESH) return void this.refresh()
    const qi = [M.QUICK0, M.QUICK1, M.QUICK2].indexOf(id)
    if (qi >= 0 && c.quickEdits[qi]) return void this.applyEdit(c.quickEdits[qi])
  }

  // ---------- Actions ----------

  approve() {
    const c = this.current()
    if (!c) return
    this.sendingCard = c.id
    this.page = { name: 'sending', until: this.now() + UNDO_MS }
    this.render()
  }

  undoSend() {
    this.sendingCard = null
    this.page = { name: 'card' }
    this.render()
  }

  private async commitSend() {
    const c = this.s.queue?.cards.find(x => x.id === this.sendingCard)
    this.sendingCard = null
    if (!c) { this.page = this.restPage(); return this.render() }
    const label = this.doneLabel(c)
    if (this.mode === 'demo') {
      // Demo mode never sends anything anywhere.
      this.s.status[c.id] = 'sent'
      this.log(`${label} (demo: nothing was sent)`)
      this.page = { name: 'sent', text: label, until: this.now() + 1600 }
      return this.render()
    }
    this.page = { name: 'sent', text: 'Sending...', until: Number.MAX_SAFE_INTEGER }; this.render()
    try {
      await G.perform(this.s.settings, c.action, this.f)
      this.s.status[c.id] = 'sent'
      this.log(label)
      this.page = { name: 'sent', text: label, until: this.now() + 1600 }
    } catch (e) {
      this.log(`Failed: ${label}: ${(e as Error).message}`)
      c.why = `Not sent: ${(e as Error).message}. Tap to try again.`
      this.persist()
      this.page = { name: 'card' }
    }
    this.render()
  }

  doneLabel(c: Card): string {
    const a = c.action
    if (a.type === 'reply') return `Reply sent to ${firstName(c.who)}`
    if (a.type === 'email') return `Message sent to ${firstName(c.who)}`
    return a.response === 'yes' ? 'Invite accepted' : a.response === 'no' ? 'Invite declined' : 'Answered maybe'
  }

  skip() {
    const c = this.current()
    if (!c) return
    this.s.status[c.id] = 'skipped'
    this.log(`Skipped: ${c.title}`)
    this.page = this.restPage()
    this.render()
  }

  reviewSkipped() {
    for (const [id, st] of Object.entries(this.s.status)) if (st === 'skipped') this.s.status[id] = 'pending'
    this.persist()
    this.page = this.restPage()
    this.render()
  }

  // ---------- Edits (voice and quick) ----------

  startVoice() {
    const c = this.current()
    if (!c) return
    const st = this.s.settings
    if (!st.claudeKey) { this.page = { name: 'quick', reason: 'Voice edits need a Claude key. Pick an edit:' }; return this.render() }
    this.transcript = ''
    const onText = (t: string) => { this.transcript = t; if (this.page.name === 'listening') this.render() }
    const onErr = (e: Error) => { this.stopVoice(); this.page = { name: 'quick', reason: `${e.message} Pick an edit:` }; this.render() }
    if (st.deepgramKey && this.bridge) {
      this.stt = deepgram(st.deepgramKey, onText, onErr)
      this.bridge.audioControl(true, AudioInputSource.Glasses).catch(() => onErr(new Error('Glasses mic unavailable.')))
    } else if (!this.bridge) {
      this.stt = browserSpeech(onText, onErr)
    }
    if (!this.stt) { this.page = { name: 'quick', reason: 'Voice needs a Deepgram key. Pick an edit:' }; return this.render() }
    this.page = { name: 'listening' }
    this.render()
  }

  stopVoice() {
    if (this.bridge && this.stt) this.bridge.audioControl(false).catch(() => {})
    this.stt?.cancel(); this.stt = null
  }

  async finishVoice() {
    const stt = this.stt
    if (!stt) return
    if (this.bridge) this.bridge.audioControl(false).catch(() => {})
    this.page = { name: 'revising' }; this.render()
    const text = (await stt.finish()).trim() || this.transcript.trim()
    this.stt = null
    if (!text) { this.page = { name: 'card' }; this.render(); return }
    await this.applyEdit(text)
  }

  async applyEdit(instruction: string) {
    const c = this.current()
    if (!c) return
    const preset = c.presetRevisions?.[instruction]
    if (preset && !this.s.settings.claudeKey) {
      // Sample queue without a Claude key: use the pre-written sample edit.
      c.action = withDraft(c.action, preset); c.revised = true
      this.persist(); this.page = { name: 'card' }; return this.render()
    }
    if (!this.s.settings.claudeKey) { this.page = { name: 'quick', reason: 'Edits need a Claude key. Pick a sample edit:' }; return this.render() }
    const ac = new AbortController(); this.abort = ac
    this.transcript = instruction
    this.page = { name: 'revising' }; this.render()
    try {
      const a = await revise(this.s.settings, c, instruction, this.f, ac.signal)
      if (ac.signal.aborted) return
      c.action = a; c.revised = true
      this.log(`Claude revised ${c.who}: "${instruction}"`)
    } catch (e) {
      if (ac.signal.aborted) return
      c.why = `Edit failed: ${(e as Error).message}`
    }
    this.persist()
    this.page = { name: 'card' }
    this.render()
  }

  // ---------- Rendering ----------

  render() { this.renderer.render(this.build()) }

  private text(id: number, name: string, g: { x: number; y: number; w: number; h: number }, content: string, color?: number, extra: Partial<TextBox> = {}): TextBox {
    const b: TextBox = { id, name, ...g, content: '', color, ...extra }
    b.content = fitBox(b, content.split('\n'))
    return b
  }

  private boxed(id: number, lines: string[], capture = true): TextBox {
    return { id, name: 'box', ...BOX, borderColor: 12, content: lines.join('\n'), color: 4, capture }
  }

  private hint(s: string) { return this.text(9, 'hint', HINT, s, 2) }

  private list(items: string[], actions: (() => void)[]): ListBox {
    this.listActions = actions
    return { id: 8, name: 'list', ...LIST, pad: 4, capture: true, items: items.slice(0, 20).map(s => { const f = fit(s, LIST.w - 40); return byteLen(f) > 63 ? byteFit(f, 60) + '...' : f }) }
  }

  private draftLines(c: Card, n = 4) {
    return clampLines(draftText(c.action), innerWidth(BOX) - 6, n)
  }

  private top(left: string, right: string): TextBox[] {
    return [this.text(1, 'kind', ROW0, left, 3), this.text(2, 'pos', ROW0R, rightAlign(right, ROW0R.w), 3)]
  }

  private demoTag() { return this.mode === 'demo' ? 'DEMO' : '' }

  build(): PageSpec {
    this.listActions = []
    const p = this.page
    const c = this.current()
    const k = this.counts()
    const pos = c && this.s.queue ? `${k.sent + k.skipped + 1} of ${k.total}` : ''
    switch (p.name) {
      case 'setup': return {
        key: 'setup',
        texts: [
          ...this.top('ON DECK', ''),
          this.text(3, 'title', TITLE, 'Set up On Deck on your phone', 4),
          this.text(4, 'why', WHY, 'Or tap to try it now with a sample inbox.', 2),
          this.boxed(5, ['To use your own email and calendar, open', 'On Deck in the Even Realities app and add', 'your Claude key and Google bridge.', ''], true),
          this.hint('Tap  try the demo        Double-tap  exit'),
        ],
      }
      case 'loading': return {
        key: 'loading',
        texts: [
          ...this.top('ON DECK', this.demoTag()),
          this.text(3, 'title', TITLE, this.s.settings.claudeKey ? 'Claude is reading your day...' : 'Loading sample cards...', 4),
          this.text(4, 'why', WHY, this.mode === 'demo' ? 'Demo inbox and calendar' : 'Unread email and the next 36 hours', 2),
          this.boxed(5, ['Finding the few things that need you,', 'ranking them, and drafting each action.', '', 'Nothing is sent without your tap.'], true),
          this.hint('Double-tap  exit'),
        ],
      }
      case 'error': return {
        key: 'error',
        texts: [
          ...this.top('ON DECK', this.demoTag()),
          this.text(3, 'title', TITLE, "Couldn't build your queue", 4),
          this.text(4, 'why', WHY, 'Check the settings on your phone.', 2),
          this.boxed(5, clampLines(p.message, innerWidth(BOX) - 6, 4).lines, true),
          this.hint('Tap  try again        Double-tap  exit'),
        ],
      }
      case 'clear': {
        const lines = clampLines(this.s.queue?.summary || '', innerWidth(BOX) - 6, 2).lines
        const tally = `${k.sent} handled${k.skipped ? `, ${k.skipped} skipped` : ''}`
        return {
          key: 'clear',
          texts: [
            ...this.top('ON DECK', this.demoTag()),
            this.text(3, 'title', TITLE, 'All clear. Head up.', 4),
            this.text(4, 'why', WHY, tally, 2),
            this.boxed(5, ['Today', ...lines, ''], true),
            this.hint(k.skipped ? 'Tap  refresh      ▲  review skipped      Double-tap  exit' : 'Tap  refresh        Double-tap  exit'),
          ],
        }
      }
      case 'card': {
        if (!c) { this.page = this.restPage(); return this.build() }
        const d = this.draftLines(c)
        const why = c.revised ? (this.s.settings.claudeKey ? 'Revised by Claude. Tap to send.' : 'Revised (sample edit). Tap to send.') : c.why
        const menu: MenuItem[] = [{ id: M.READ, name: 'Read full draft' }, { id: M.VOICE, name: 'Edit by voice' }]
        // The menu shows about 230 px of each label; keep quick edits readable in full.
        c.quickEdits.slice(0, 3).forEach((q, i) => menu.push({ id: [M.QUICK0, M.QUICK1, M.QUICK2][i], name: byteFit(fit(q, 230)) }))
        menu.push({ id: M.SKIP, name: 'Skip this card' }, { id: M.REFRESH, name: 'Refresh queue' })
        return {
          key: 'card',
          texts: [
            ...this.top(`${KIND[c.kind]}  /  ${c.who}`, pos),
            this.text(3, 'title', TITLE, c.title, 4),
            this.text(4, 'why', WHY, why, 2),
            this.boxed(5, d.lines, true),
            this.hint('Tap  send       ▲  skip       ▼  voice       Hold  more'),
          ],
          menu,
        }
      }
      case 'sending': {
        const left = Math.max(0, Math.ceil((p.until - this.now()) / 1000))
        const cc = this.s.queue?.cards.find(x => x.id === this.sendingCard) || c
        return {
          key: 'sending',
          texts: [
            ...this.top(cc ? `${KIND[cc.kind]}  /  ${cc.who}` : 'ON DECK', pos),
            this.text(3, 'title', TITLE, `${cc && cc.action.type === 'rsvp' ? 'Answering' : 'Sending'} in ${left}...`, 4),
            this.text(4, 'why', WHY, 'Tap to undo.', 2),
            this.boxed(5, cc ? this.draftLines(cc).lines : [], true),
            this.hint('Tap  undo        Double-tap  undo'),
          ],
        }
      }
      case 'sent': return {
        key: 'sent',
        texts: [
          ...this.top('ON DECK', this.demoTag()),
          this.text(3, 'title', TITLE, p.text, 4),
          this.text(4, 'why', WHY, p.text === 'Sending...' ? '' : k.pending ? `${k.pending} left on deck` : 'That was the last one.', 2),
          { id: 5, name: 'box', ...BOX, border: 0, content: this.mode === 'demo' && p.text !== 'Sending...' ? 'Demo mode: nothing left this phone.' : '', color: 2, capture: true },
          this.hint(p.text === 'Sending...' ? '' : 'Tap  next'),
        ],
      }
      case 'listening': {
        const t = this.transcript ? clampLines(this.transcript, innerWidth(BOX) - 6, 99).lines.slice(-4) : ['Listening...']
        return {
          key: 'listening',
          texts: [
            ...this.top(`VOICE EDIT  /  ${c?.who || ''}`, pos),
            this.text(3, 'title', TITLE, 'Say the change, then tap.', 4),
            this.text(4, 'why', WHY, 'e.g. "Tell him I\'ll be ten minutes late"', 2),
            this.boxed(5, t, true),
            this.hint('Tap  done        Double-tap  cancel'),
          ],
        }
      }
      case 'revising': return {
        key: 'revising',
        texts: [
          ...this.top(`EDIT  /  ${c?.who || ''}`, pos),
          this.text(3, 'title', TITLE, 'Claude is revising the draft...', 4),
          this.text(4, 'why', WHY, this.transcript ? `"${this.transcript}"` : '', 2),
          this.boxed(5, c ? this.draftLines(c).lines : [], true),
          this.hint('Double-tap  cancel'),
        ],
      }
      case 'quick': {
        if (!c) { this.page = this.restPage(); return this.build() }
        const items = [...c.quickEdits.slice(0, 3), 'Keep the draft as is']
        const acts = [...c.quickEdits.slice(0, 3).map(q => () => void this.applyEdit(q)), () => { this.page = { name: 'card' }; this.render() }]
        return {
          key: `quick-${c.id}-${p.reason || ''}`,
          texts: [...this.top(`EDIT  /  ${c.who}`, pos), this.text(3, 'title', { x: 0, y: 32, w: 576, h: 30 }, p.reason || 'Pick an edit:', 2)],
          list: this.list(items, acts),
        }
      }
      case 'read': {
        if (!c) { this.page = this.restPage(); return this.build() }
        const body = clampLines(draftText(c.action), 576 - 30, 99).lines
        return {
          key: `read-${c.id}`,
          texts: [
            ...this.top(`FULL DRAFT  /  ${c.who}`, pos),
            // Long drafts scroll here: swipes move the text, tap or double-tap goes back.
            { id: 3, name: 'full', x: 0, y: 34, w: 576, h: 254, pad: 6, border: 0, content: body.join('\n'), color: 4, capture: true },
          ],
        }
      }
    }
  }
}

export { innerWidth }

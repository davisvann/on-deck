// Phone screen: a live mirror of the lens, the queue with full drafts, connections, and the
// activity log. Approving happens on the glasses; the phone never sends anything itself.

import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import type { OnDeck } from './app'
import type { PageSpec } from './lens'
import { CANVAS_W, CANVAS_H } from './lens'
import { MODELS, draftText } from './types'
import * as G from './google'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export function mountPhone(app: OnDeck, onGlasses: boolean) {
  const st = app.s.settings
  document.getElementById('app')!.innerHTML = `
  <header class="top">
    <div class="brand"><span class="mark" aria-hidden="true"></span><div><h1>On Deck</h1><p>Your decisions, one card at a time</p></div></div>
    <span class="chip ${onGlasses ? 'on' : ''}">${onGlasses ? 'On your glasses' : 'Browser preview'}</span>
  </header>
  <section class="card glass">
    <div class="card-h"><h2>On your lens now</h2><span class="muted" id="pagename"></span></div>
    <div class="lens-wrap"><div class="lens" id="lens" role="img" aria-label="Live view of the glasses display"></div></div>
    <div class="pad ${onGlasses ? 'hidden' : ''}" id="pad">
      <button data-in="up">▲ Skip</button><button data-in="click" class="primary">Tap</button><button data-in="down">▼ Voice</button>
      <button data-in="double">Double-tap</button><button data-in="menu">Menu</button>
    </div>
    <p class="hint ${onGlasses ? 'hidden' : ''}">Keys: arrows swipe, Enter taps, Backspace double-taps, M opens the menu.</p>
  </section>
  <section class="card glass">
    <div class="card-h"><h2>Queue</h2><span class="muted" id="qmeta"></span></div>
    <p class="muted small">Ranked and drafted by Claude. Approve on the glasses: nothing is sent from here.</p>
    <ol class="queue" id="queue"></ol>
    <button class="btn ghost wide" id="refresh">Refresh queue</button>
  </section>
  <section class="card glass">
    <div class="card-h"><h2>Connections</h2><span class="muted" id="cstate"></span></div>
    <label class="toggle"><input type="checkbox" id="demo" ${st.demo ? 'checked' : ''}> <span><b>Demo mode.</b> Sample inbox and calendar; nothing is ever sent. With a Claude key, Claude drafts the samples live.</span></label>
    <label class="field">Claude API key<input id="claudeKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-..." value="${esc(st.claudeKey)}"></label>
    <label class="field">Model<select id="model">${MODELS.map(m => `<option value="${m.id}" ${m.id === st.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
    <label class="field">Google bridge URL<input id="bridgeUrl" type="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(st.bridgeUrl)}"></label>
    <label class="field">Google bridge secret<input id="bridgeSecret" type="password" autocomplete="off" spellcheck="false" value="${esc(st.bridgeSecret)}"></label>
    <label class="field">Deepgram key (voice edits, optional)<input id="deepgramKey" type="password" autocomplete="off" spellcheck="false" value="${esc(st.deepgramKey)}"></label>
    <div class="row"><button class="btn" id="save">Save</button><button class="btn ghost" id="test">Test connections</button></div>
    <p class="msg" id="cmsg" role="status"></p>
    <p class="muted small">Keys stay on this phone. The Google bridge is a small script you deploy to your own Google account from a computer; see the README.</p>
  </section>
  <section class="card glass">
    <div class="card-h"><h2>Activity</h2></div>
    <ul class="log" id="log"></ul>
  </section>
  <div class="menu hidden" id="menu" role="dialog" aria-label="Glasses menu"><div class="menu-in" id="menuin"></div></div>`

  // ---------- Lens mirror ----------
  const lens = $('#lens')
  let listSel = 0, lastKey = ''
  const draw = (p: PageSpec) => {
    if (p.key !== lastKey) { listSel = 0; lastKey = p.key }
    const box = (x: number, y: number, w: number, h: number) => `left:${(x / CANVAS_W) * 100}%;top:${(y / CANVAS_H) * 100}%;width:${(w / CANVAS_W) * 100}%;height:${(h / CANVAS_H) * 100}%`
    let html = ''
    for (const t of p.texts) {
      const bw = t.border ? `border:${t.border}px solid rgba(90,255,120,.75);border-radius:${t.radius || 0}px;` : ''
      html += `<div class="lt c${t.color ?? 4}" style="${box(t.x, t.y, t.w, t.h)};${bw}padding:${t.pad || 0}px">${esc(t.content).replace(/\n/g, '<br>')}</div>`
    }
    if (p.list) html += `<div class="ll" style="${box(p.list.x, p.list.y, p.list.w, p.list.h)};padding:${p.list.pad || 0}px">${p.list.items.map((it, i) => `<div class="li${!onGlasses && i === listSel ? ' sel' : ''}">${esc(it)}</div>`).join('')}</div>`
    lens.innerHTML = html
    $('#pagename').textContent = p.key.split('-')[0]
    renderQueue()
  }
  app.renderer.onRendered = draw
  const fitLens = () => { const wrap = lens.parentElement!; const w = wrap.clientWidth - 20; lens.style.transform = `scale(${w / CANVAS_W})`; wrap.style.height = `${Math.round(w * CANVAS_H / CANVAS_W) + 20}px` }
  window.addEventListener('resize', fitLens); fitLens()

  // ---------- Browser preview input ----------
  const menu = $('#menu')
  const openMenu = () => {
    const items = app.renderer.page?.menu || []
    $('#menuin').innerHTML = `<p class="muted small">Glasses menu</p>${items.map(m => `<button data-mi="${m.id}">${esc(m.name)}</button>`).join('') || '<p class="muted">No menu on this screen</p>'}<button data-mi="0" class="ghost">Close</button>`
    menu.classList.remove('hidden')
  }
  menu.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null
    menu.classList.add('hidden')
    if (b && +b.dataset.mi!) app.handle({ menuItemClickEvent: { itemID: +b.dataset.mi! } as never })
  })
  const send = (kind: string) => {
    const p = app.renderer.page
    if (kind === 'menu') return openMenu()
    if (p?.list) {
      if (kind === 'up') listSel = Math.max(0, listSel - 1)
      else if (kind === 'down') listSel = Math.min(p.list.items.length - 1, listSel + 1)
      else if (kind === 'click') app.handle({ listEvent: { currentSelectItemIndex: listSel, eventType: OsEventTypeList.CLICK_EVENT } as never })
      else if (kind === 'double') app.handle({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } as never })
      if (kind === 'up' || kind === 'down') draw(p)
      return
    }
    if (kind === 'up') app.handle({ textEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } as never })
    else if (kind === 'down') app.handle({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } as never })
    else if (kind === 'click') app.handle({ sysEvent: {} as never })
    else if (kind === 'double') app.handle({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } as never })
  }
  if (!onGlasses) {
    $('#pad').addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b) send(b.dataset.in!) })
    window.addEventListener('keydown', e => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const k = ({ ArrowUp: 'up', ArrowDown: 'down', Enter: 'click', Backspace: 'double', m: 'menu', M: 'menu' } as Record<string, string>)[e.key]
      if (k) { e.preventDefault(); send(k) }
    })
  }

  // ---------- Queue + activity ----------
  const renderQueue = () => {
    const q = app.s.queue
    const cur = app.current()
    const k = app.counts()
    $('#qmeta').textContent = q ? `${q.source === 'claude' ? 'Claude' : 'Sample cards'}: ${k.pending} left, ${k.sent} done` : 'Not built yet'
    $('#queue').innerHTML = (q?.cards || []).map(c => {
      const s = app.s.status[c.id] || 'pending'
      return `<li class="q ${s}${cur && cur.id === c.id ? ' now' : ''}"><div class="q-h"><span class="tag">${c.kind}</span><b>${esc(c.title)}</b><span class="st">${s === 'pending' ? (cur && cur.id === c.id ? 'on the lens' : 'waiting') : s}</span></div><p class="muted small">${esc(c.who)}: ${esc(c.why)}</p><p class="draft">${esc(draftText(c.action))}</p></li>`
    }).join('') || '<li class="muted">Tap Refresh to build your queue.</li>'
    $('#log').innerHTML = app.s.log.slice(0, 12).map(l => `<li><span class="muted">${new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span> ${esc(l.text)}</li>`).join('') || '<li class="muted">Nothing yet.</li>'
    const s = app.s.settings
    $('#cstate').textContent = s.demo ? 'Demo mode' : s.claudeKey && s.bridgeUrl && s.bridgeSecret ? 'Live' : 'Not set up'
  }
  app.onState = renderQueue
  renderQueue()
  $('#refresh').addEventListener('click', () => void app.refresh())

  // ---------- Settings ----------
  const cmsg = $('#cmsg')
  const read = () => {
    const v = (id: string) => ($<HTMLInputElement>('#' + id).value || '').trim()
    Object.assign(app.s.settings, {
      claudeKey: v('claudeKey'), model: $<HTMLSelectElement>('#model').value, bridgeUrl: v('bridgeUrl'),
      bridgeSecret: v('bridgeSecret'), deepgramKey: v('deepgramKey'), demo: $<HTMLInputElement>('#demo').checked,
    })
  }
  $('#save').addEventListener('click', () => {
    read()
    if (app.s.settings.bridgeUrl && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(app.s.settings.bridgeUrl)) { cmsg.textContent = 'The bridge URL should look like https://script.google.com/macros/s/.../exec'; return }
    app.s.queue = null; app.persist(); cmsg.textContent = 'Saved. Building your queue...'; void app.refresh()
  })
  $('#demo').addEventListener('change', () => { read(); app.s.queue = null; app.persist(); void app.refresh() })
  $('#test').addEventListener('click', async () => {
    read(); app.persist()
    const out: string[] = []
    const s = app.s.settings
    if (s.claudeKey) {
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': s.claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: s.model, max_tokens: 8, messages: [{ role: 'user', content: 'Say ok' }] }) })
        out.push(r.ok ? 'Claude: connected' : `Claude: ${(await r.json().catch(() => ({})))?.error?.message || r.status}`)
      } catch (e) { out.push(`Claude: ${(e as Error).message}`) }
    } else out.push('Claude: no key')
    if (s.bridgeUrl && s.bridgeSecret) { try { out.push(`Google: connected as ${await G.ping(s)}`) } catch (e) { out.push(`Google: ${(e as Error).message}`) } }
    else out.push('Google: not set up')
    out.push(s.deepgramKey ? 'Voice: Deepgram key saved (checked on first use)' : 'Voice: no key, quick edits only')
    cmsg.textContent = out.join('. ') + '.'
  })
}

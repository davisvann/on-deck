// Lens layout primitives: page specs, text measuring, and a renderer that sends the
// fewest possible calls (in-place text upgrades; a full rebuild only when layout changes).

import {
  EvenAppBridge, TextContainerProperty, ListContainerProperty, CreateStartUpPageContainer,
  RebuildPageContainer, TextContainerUpgrade, StartUpPageCreateResult, ListItemContainerProperty,
  MenuContainerProperty, MenuItemProperty,
} from '@evenrealities/even_hub_sdk'
import { W } from './fontwidths'

export const CANVAS_W = 576
export const CANVAS_H = 288
export const LINE_H = 27

export interface TextBox {
  id: number; name: string; x: number; y: number; w: number; h: number
  content: string; color?: number; border?: number; borderColor?: number; radius?: number; pad?: number; capture?: boolean
}
export interface ListBox {
  id: number; name: string; x: number; y: number; w: number; h: number
  items: string[]; capture?: boolean; border?: number; pad?: number
}
export interface MenuItem { id: number; name: string }
export interface PageSpec { key: string; texts: TextBox[]; list?: ListBox; menu?: MenuItem[] }

// ---------- Text measuring (widths measured from the simulator's firmware font) ----------

export function textWidth(s: string): number {
  let w = 0
  for (const ch of s) w += W[ch] ?? 20
  return w
}

/** Truncate to fit a pixel width, adding "..." when cut. */
export function fit(s: string, px: number): string {
  if (textWidth(s) <= px) return s
  const ell = '...'
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + ell) > px) break
    out += ch
  }
  return out.replace(/[\s,/(-]+$/, '') + ell
}

/** Pad with spaces so `right` starts at roughly `col` px from the left. */
export function cols(left: string, right: string, col: number): string {
  const gap = Math.max(2, Math.round((col - textWidth(left)) / (W[' '] || 5)))
  return left + ' '.repeat(gap) + right
}

export function innerWidth(b: { w: number; border?: number; pad?: number }) {
  return b.w - 2 * (b.pad ?? 0) - 2 * (b.border ?? 0)
}

export function maxLines(b: { h: number; border?: number; pad?: number }) {
  return Math.max(1, Math.floor((b.h - 2 * (b.pad ?? 0) - 2 * (b.border ?? 0)) / LINE_H))
}

/** Make box content safe: every line fits on one row, and the box never overflows
 *  (an overflowing event-capture box scrolls instead of reporting swipes). */
export function fitBox(b: TextBox, lines: string[]): string {
  const iw = innerWidth(b) - 4
  const n = maxLines(b)
  return lines.slice(0, n).map(l => fit(l, iw)).join('\n')
}

// ---------- Renderer ----------

const geomSig = (p: PageSpec) => JSON.stringify({
  k: p.key,
  t: p.texts.map(({ content, color, ...g }) => g),
  l: p.list || null,
  m: p.menu || null,
})

export class LensRenderer {
  private current: PageSpec | null = null
  private sig = ''
  private started = false
  private queue: Promise<unknown> = Promise.resolve()
  onRendered: (p: PageSpec) => void = () => {}

  constructor(private bridge: EvenAppBridge | null) {}

  get page() { return this.current }

  render(p: PageSpec) {
    this.queue = this.queue.then(() => this.apply(p)).catch(e => console.error('render failed', e))
    return this.queue
  }

  private textProps(t: TextBox) {
    return new TextContainerProperty({
      xPosition: t.x, yPosition: t.y, width: t.w, height: t.h, containerID: t.id, containerName: t.name,
      content: t.content, borderWidth: t.border ?? 0, borderColor: t.borderColor ?? 12, borderRadius: t.radius ?? 0,
      paddingLength: t.pad ?? 0, isEventCapture: t.capture ? 1 : 0, ...(t.color != null ? { textColor: t.color } : {}),
    })
  }

  private listProps(l: ListBox) {
    return new ListContainerProperty({
      xPosition: l.x, yPosition: l.y, width: l.w, height: l.h, containerID: l.id, containerName: l.name,
      borderWidth: l.border ?? 0, borderColor: 12, borderRadius: 0, paddingLength: l.pad ?? 0, isEventCapture: l.capture ? 1 : 0,
      itemContainer: new ListItemContainerProperty({ itemCount: l.items.length, itemName: l.items, isItemSelectBorderEn: 1 }),
    })
  }

  private async apply(p: PageSpec) {
    const sig = geomSig(p)
    const b = this.bridge
    if (!this.started || sig !== this.sig) {
      const body = {
        containerTotalNum: p.texts.length + (p.list ? 1 : 0),
        textObject: p.texts.map(t => this.textProps(t)),
        ...(p.list ? { listObject: [this.listProps(p.list)] } : {}),
        ...(p.menu && p.menu.length ? { menuObject: new MenuContainerProperty({ menuItems: p.menu.map(m => new MenuItemProperty({ itemID: m.id, itemName: m.name })) }) } : {}),
      }
      if (b) {
        if (!this.started) {
          const r = await b.createStartUpPageContainer(new CreateStartUpPageContainer(body))
          if (r !== StartUpPageCreateResult.success) console.error('createStartUpPageContainer failed', r)
        } else {
          const ok = await b.rebuildPageContainer(new RebuildPageContainer(body))
          if (!ok) console.error('rebuildPageContainer failed for', p.key)
        }
      }
      this.started = true
      this.sig = sig
      this.current = p
      this.onRendered(p)
      return
    }
    // Same layout: update only the text that changed, in place (no flicker).
    const prev = this.current!
    for (const t of p.texts) {
      const o = prev.texts.find(x => x.id === t.id)
      if (o && o.content === t.content && o.color === t.color) continue
      if (b) {
        await b.textContainerUpgrade(new TextContainerUpgrade({
          containerID: t.id, containerName: t.name, content: t.content, ...(t.color != null ? { textColor: t.color } : {}),
        }))
      }
    }
    this.current = p
    this.onRendered(p)
  }
}

/** Word-wrap text into lines that each fit `px`, using the measured lens font.
 *  Returns every line; callers decide how many to show. */
export function wrap(text: string, px: number): string[] {
  const out: string[] = []
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word
      if (textWidth(cand) <= px) { line = cand; continue }
      if (line) out.push(line)
      // A single word wider than the line gets hard-split.
      let w = word
      while (textWidth(w) > px) { let cut = ''; for (const ch of w) { if (textWidth(cut + ch) > px) break; cut += ch } out.push(cut); w = w.slice(cut.length) }
      line = w
    }
    out.push(line)
  }
  while (out.length && !out[out.length - 1]) out.pop()
  return out
}

/** Wrap and clamp to `n` lines; the last shown line ends in "..." when text was cut. */
export function clampLines(text: string, px: number, n: number): { lines: string[]; cut: boolean } {
  const all = wrap(text, px)
  if (all.length <= n) return { lines: all, cut: false }
  const lines = all.slice(0, n)
  let last = lines[n - 1]
  while (last && textWidth(last + '...') > px) last = last.slice(0, -1)
  lines[n - 1] = last.replace(/[\s,;:]+$/, '') + '...'
  return { lines, cut: true }
}

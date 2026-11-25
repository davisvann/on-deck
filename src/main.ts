import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { OnDeck, blankState } from './app'
import { mountPhone } from './phone'

async function getBridge(): Promise<EvenAppBridge | null> {
  const w = window as unknown as { flutter_inappwebview?: unknown }
  if (!w.flutter_inappwebview) return null // plain browser: preview mode
  return Promise.race([waitForEvenAppBridge(), new Promise<null>(r => setTimeout(() => r(null), 5000))])
}

const bridge = await getBridge()
const q = new URLSearchParams(location.search)
const app = new OnDeck(bridge)
await app.load()
// ?demo=1 turns on demo mode (sample inbox, nothing ever sends). Dev-only: ?fresh=1 starts empty.
if (import.meta.env.DEV && q.get('fresh')) app.s = blankState()
if (q.get('demo') && !app.s.settings.demo) { app.s.settings.demo = true; app.s.queue = null; app.persist() }
app.page = app.restPage()
mountPhone(app, !!bridge)
if (bridge) bridge.onEvenHubEvent(e => app.handle(e))
app.start()
if (app.configured && !app.s.queue) void app.refresh()
console.log('ONDECK_READY', bridge ? 'glasses' : 'preview')
;(window as unknown as { ondeck: OnDeck }).ondeck = app

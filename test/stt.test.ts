// Deepgram streaming client against a fake WebSocket.
import assert from 'node:assert/strict'
import { deepgram } from '../src/stt'

class FakeWS {
  static last: FakeWS
  sent: any[] = []; binaryType = ''; onopen: any; onmessage: any; onerror: any; onclose: any
  constructor(public url: string, public protocols: string[]) { FakeWS.last = this }
  send(d: any) { this.sent.push(d); if (typeof d === 'string' && JSON.parse(d).type === 'CloseStream') setTimeout(() => this.onclose?.(), 5) }
  close() { this.onclose?.() }
}
const texts: string[] = []
const t = deepgram('dg-key', s => texts.push(s), e => { throw e }, FakeWS as unknown as typeof WebSocket)
const ws = FakeWS.last
assert.deepEqual(ws.protocols, ['token', 'dg-key'])
assert.match(ws.url, /^wss:\/\/api\.deepgram\.com\/v1\/listen\?.*encoding=linear16.*sample_rate=16000/)
t.sendPcm(new Uint8Array([1, 2])) // before open: queued
ws.onopen(); assert.equal(ws.sent.length, 1)
const msg = (transcript: string, is_final: boolean) => ws.onmessage({ data: JSON.stringify({ type: 'Results', is_final, channel: { alternatives: [{ transcript }] } }) })
msg('tell sam', false); msg("Tell Sam I'll be", true); msg('ten minutes late', false)
assert.equal(texts.at(-1), "Tell Sam I'll be ten minutes late")
const done = t.finish(); msg('ten minutes late.', true)
assert.equal(await done, "Tell Sam I'll be ten minutes late.")
console.log('ok - deepgram stream: auth subprotocol, queued audio, interim + final text, CloseStream\n\n1 tests passed')

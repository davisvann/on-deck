// Voice edits. The glasses mic streams PCM (s16le, 16 kHz, mono) through the Even Hub SDK;
// Even ships no speech-to-text, so it's bring-your-own. On Deck streams the PCM to Deepgram
// with the user's own key. In a plain browser preview (no glasses), the browser's own
// speech recognition is used instead when it exists.

export interface Transcriber {
  sendPcm(chunk: Uint8Array): void
  /** Stop listening; resolves with the final transcript. */
  finish(): Promise<string>
  cancel(): void
}

export type OnText = (text: string) => void

export function deepgram(key: string, onText: OnText, onError: (e: Error) => void, WS: typeof WebSocket = WebSocket): Transcriber {
  const params = new URLSearchParams({ model: 'nova-3', encoding: 'linear16', sample_rate: '16000', channels: '1', interim_results: 'true', smart_format: 'true', punctuate: 'true' })
  const ws = new WS(`wss://api.deepgram.com/v1/listen?${params}`, ['token', key])
  ws.binaryType = 'arraybuffer'
  let finals = '', interim = '', open = false, done = false
  const pending: Uint8Array[] = []
  let resolveFinal: ((t: string) => void) | null = null
  const text = () => `${finals} ${interim}`.replace(/\s+/g, ' ').trim()
  ws.onopen = () => { open = true; for (const c of pending.splice(0)) ws.send(c) }
  ws.onmessage = ev => {
    try {
      const m = JSON.parse(String(ev.data))
      if (m.type !== 'Results') return
      const t = m.channel?.alternatives?.[0]?.transcript || ''
      if (m.is_final) { if (t) finals = `${finals} ${t}`.trim(); interim = '' } else interim = t
      onText(text())
    } catch { /* ignore non-JSON frames */ }
  }
  ws.onerror = () => { if (!done) onError(new Error('Voice service connection failed. Check the Deepgram key.')) }
  ws.onclose = () => { if (resolveFinal) { resolveFinal(text()); resolveFinal = null } }
  return {
    sendPcm(c) { if (done) return; if (open) ws.send(c); else pending.push(c) },
    finish() {
      done = true
      return new Promise(res => {
        resolveFinal = res
        try { if (open) ws.send(JSON.stringify({ type: 'CloseStream' })); else ws.close() } catch { res(text()) }
        setTimeout(() => { if (resolveFinal) { resolveFinal(text()); resolveFinal = null; try { ws.close() } catch { /* already closed */ } } }, 2500)
      })
    },
    cancel() { done = true; try { ws.close() } catch { /* already closed */ } },
  }
}

/** Browser preview only: Web Speech API, when the browser has it. */
export function browserSpeech(onText: OnText, onError: (e: Error) => void): Transcriber | null {
  const W = window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }
  const SR = W.SpeechRecognition || W.webkitSpeechRecognition
  if (!SR) return null
  const r = new SR()
  r.lang = 'en-US'; r.interimResults = true; r.continuous = true
  let finalText = '', interim = ''
  let resolveFinal: ((t: string) => void) | null = null
  r.onresult = (e: any) => {
    interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) finalText += t; else interim += t
    }
    onText(`${finalText} ${interim}`.trim())
  }
  r.onerror = (e: any) => onError(new Error(`Speech recognition: ${e.error || 'failed'}`))
  r.onend = () => { if (resolveFinal) { resolveFinal(`${finalText} ${interim}`.trim()); resolveFinal = null } }
  r.start()
  return {
    sendPcm() { /* uses the phone mic directly */ },
    finish() { return new Promise(res => { resolveFinal = res; r.stop(); setTimeout(() => { if (resolveFinal) { resolveFinal(`${finalText} ${interim}`.trim()); resolveFinal = null } }, 2000) }) },
    cancel() { try { r.abort() } catch { /* not running */ } },
  }
}

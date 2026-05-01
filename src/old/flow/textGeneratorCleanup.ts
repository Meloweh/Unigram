/** Clears all text-generator cleanup state: timers, hidden spans, and audio nodes. */
export function cleanupTextGenerator(
  textGenTimersRef: React.MutableRefObject<number[]>,
  textGenHiddenSpansRef: React.MutableRefObject<{ el: HTMLElement; origVisibility: string }[]>,
  textGenAudioNodesRef: React.MutableRefObject<{ osc?: OscillatorNode; gain?: GainNode; source?: AudioBufferSourceNode; ctx: AudioContext }[]>,
) {
  for (const t of textGenTimersRef.current) clearTimeout(t)
  textGenTimersRef.current = []
  for (const { el, origVisibility } of textGenHiddenSpansRef.current) {
    if (origVisibility === '__textgen_text__') {
      // Restore original textContent that was truncated during generation
      const orig = el.getAttribute('data-textgen-orig')
      if (orig != null) {
        el.textContent = orig
        el.removeAttribute('data-textgen-orig')
      }
    } else if (origVisibility === '__textgen_wrapper__') {
      // Restore wrapper sizing
      el.style.width = el.getAttribute('data-textgen-orig-width') ?? ''
      el.style.minWidth = el.getAttribute('data-textgen-orig-minwidth') ?? ''
      el.style.height = el.getAttribute('data-textgen-orig-height') ?? ''
      el.style.minHeight = el.getAttribute('data-textgen-orig-minheight') ?? ''
      el.style.transition = el.getAttribute('data-textgen-orig-transition') ?? ''
      el.removeAttribute('data-textgen-orig-width')
      el.removeAttribute('data-textgen-orig-minwidth')
      el.removeAttribute('data-textgen-orig-height')
      el.removeAttribute('data-textgen-orig-minheight')
      el.removeAttribute('data-textgen-orig-transition')
    } else {
      el.style.visibility = origVisibility
    }
  }
  textGenHiddenSpansRef.current = []
  for (const snd of textGenAudioNodesRef.current) {
    try { snd.osc?.stop() } catch { /* already stopped */ }
    try { snd.source?.stop() } catch { /* already stopped */ }
    try { snd.gain?.disconnect() } catch { /* ok */ }
  }
  textGenAudioNodesRef.current = []
}

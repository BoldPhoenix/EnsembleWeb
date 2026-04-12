type Listener = () => void

export const audioState = {
  volume: 0,
  cancelAudio: false,
  currentAudio: null as HTMLAudioElement | null,
  _listeners: [] as Listener[],
  subscribe(fn: Listener) {
    this._listeners.push(fn)
    return () => {
      this._listeners = this._listeners.filter(l => l !== fn)
    }
  },
  notify() {
    for (const fn of this._listeners) fn()
  },
  setVolume(v: number) {
    this.volume = v
    this.notify()
  },
  stop() {
    this.cancelAudio = true
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio = null
    }
    this.volume = 0
    this.notify()
  }
}

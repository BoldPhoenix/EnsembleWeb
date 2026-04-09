export const audioState = {
  volume: 0,
  cancelAudio: false,
  currentAudio: null as HTMLAudioElement | null,
  stop() {
    this.cancelAudio = true
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio = null
    }
    this.volume = 0
  }
}
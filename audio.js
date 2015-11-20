var AudioSlot = require('audio-slot')
var extend = require('xtend')
var workerTimer = require('worker-timer')
var Observ = require('observ')

var context = {
  audio: new AudioContext(),
  nodes: {
    osc: require('audio-slot/sources/oscillator'),
    env: require('audio-slot/params/envelope'),
    filter: require('audio-slot/processors/filter'),
    sample: require('audio-slot/sources/sample'),
    fetch: FetchAudioBuffer,
    reverb: require('audio-slot/processors/reverb'),
    drive: require('audio-slot/processors/overdrive')
  }
}

var synth = Pitched(context, {
  sources: [
    { node: 'osc',
      shape: 'sawtooth',
      amp: { node: 'env', attack: 1, release: 1, value: 0.4 }
    }
  ],
  processors: [
    { node: 'filter',
      frequency: { node: 'env', value: 20000, decay: 0.5, sustain: 0.01 }
    }
  ]
})

var synthFx = AudioSlot(context, {
  processors: [
    { node: 'drive', gain: 5, postCut: 20000 },
    { node: 'reverb', time: 2 }
  ]
})

synth.connect(synthFx.input)
synthFx.connect(context.audio.destination)

var drums = Triggers(context, [
  { sources: [
    { node: 'sample', mode: 'oneshot',
      buffer: { node: 'fetch', src: 'samples/kick.wav' }
    }
  ]},
  { sources: [
    { node: 'sample', mode: 'oneshot',
      buffer: { node: 'fetch', src: 'samples/snare.wav' }
    }
  ]},
  { sources: [
    { node: 'sample', mode: 'oneshot',
      buffer: { node: 'fetch', src: 'samples/hihat.wav' }
    }
  ]},
  { sources: [
    { node: 'sample', mode: 'oneshot',
      buffer: { node: 'fetch', src: 'samples/open-hihat.wav' }
    }
  ]}
])

drums.connect(context.audio.destination)

var bass = Pitched(context, {
  sources: [
    { node: 'osc', shape: 'square', octave: -3,
      amp: { node: 'env', attack: 0.1, release: 0.4, value: 0.4 }
    }
  ],
  processors: [
    { node: 'filter', Q: 6,
      frequency: { node: 'env', value: 5000, decay: 0.2, sustain: 0.3 }
    }
  ]
})

bass.connect(context.audio.destination)

module.exports = {
  drums: drums,
  synth: synth,
  bass: bass
}



function Triggers (context, descriptors) {
  var output = context.audio.createGain()
  var triggers = descriptors.map((descriptor) => {
    var slot = AudioSlot(context, descriptor)
    slot.connect(output)
    return slot
  })
  output.write = (message) => {
    if (message[0] === 144) {
      var slot = triggers[message[1] - 36]
      if (slot) {
        if (message[2]) {
          slot.triggerOn(context.audio.currentTime)
        } else {
          slot.triggerOff(context.audio.currentTime)
        }
      }
    }
  }
  return output
}

function FetchAudioBuffer (context) {
  var obs = Observ({})
  obs.resolved = Observ()
  obs((data) => {
    if (data) {
      fetch(data.src).then((response) => {
        return response.arrayBuffer()
      }).then((arrayBuffer) => {
        context.audio.decodeAudioData(arrayBuffer, (audioBuffer) => {
          obs.resolved.set(audioBuffer)
        })
      })
    }
  })
  return obs
}

function Pitched (context, descriptor) {
  var synth = context.audio.createGain()
  var notes = {}
  synth.write = (message) => {
    if (message[0] === 144) {
      var slot = notes[message[1]]
      if (message[2]) {
        if (!slot) {
          slot = notes[message[1]] = AudioSlot(context, extend(descriptor, {
            noteOffset: message[1] - 69
          }))
          slot.connect(synth)
        }
        slot.triggerOn(context.audio.currentTime)
      } else {
        slot && slot.triggerOff(context.audio.currentTime)
      }
    }
  }
  return synth
}

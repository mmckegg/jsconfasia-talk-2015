var MidiStream = require('midi-stream')
var Observ = require('observ')
var ArrayGrid = require('array-grid')
var Transform = require('observ-transform')
var connect = require('observ-transform/connect')
var send = require('observ-transform/send')

var output = MidiStream('JAVASCRIPT MUSIC', {
  virtual: true
})

var midiClock = MidiStream.openInput('CLOCK INPUT', {
  virtual: true,
  includeTiming: true
})

midiClock.on('data', console.log)

var currentPosition = PositionFromMidiClock(midiClock)
currentPosition(console.log)

var launchpad = MidiStream('Launchpad Mini')
connect(
  LaunchpadToGrid(launchpad),
  Repeater(currentPosition, 1 / 2),
  send(
    connect(Range([3, 8], [0, 0]), GridToMidi(output, (value, i) => {
      return [144, scale(i, -1), value]
    })),
    connect(Range([2, 8], [3, 0]), GridToMidi(output, (value, i) => {
      return [145, scale(i, -1), value]
    })),
    connect(Range([1, 8], [5, 0]), GridToMidi(output, (value, i) => {
      return [146, scale(i, 0), value]
    })),
    connect(Range([1, 4], [6, 0]), GridToMidi(output, (value, i) => {
      return [147, 36 + i, value]
    })),
    connect(Range([1, 4], [7, 0]), GridToMidi(output, (value, i) => {
      return [148, 36 + i, value]
    })),
    connect(Range([2, 4], [6, 4]), GridToMidi(output, (value, i) => {
      return [149, scale(i), value]
    })),
    GridToMidi(launchpad, (value, i) => {
      var id = (i % 8) + (Math.floor(i / 8) * 16)
      return [144, id, value]
    })
  )
)

function scale (pos, octave) {
  var notes = [ 0, 2, 3, 4, 5, 7, 9, 10 ]
  var scalePosition = Math.floor(pos % notes.length)
  var multiplier = Math.floor(pos / notes.length) + (octave || 0)
  var note = notes[scalePosition]
  return note + (multiplier * 12) + 63
}
var outputLights = GridToMidi(launchpad, (value, i) => {
  var id = (i % 8) + (Math.floor(i / 8) * 16)
  return [144, id, value]
})

function Repeater (currentPosition, rate) {
  var currentFrame = null
  return Transform((input, args) => {
    if (args.rate) {
      var pos = (args.currentPosition % args.rate)
      if (pos === 0) {
        currentFrame = input
      }
      return (pos / args.rate) < 0.5 ? currentFrame : null
    } else {
      return input
    }
  }, {
    rate: rate,
    currentPosition: currentPosition
  })
}

function PositionFromMidiClock (port) {
  var obs = Observ(0)
  var ticks = 0
  port.on('data', (data) => {
    if (data[0] === 248) {
      ticks += 1
      obs.set(ticks / 24)
    }
  })
  return obs
}

function Range (shape, offset) {
  return Transform((input) => {
    return input && input.getRange(shape, offset)
  })
}

function GridToMidi (port, fn) {
  var obs = Observ()
  var outputValues = {}
  obs(function (grid) {
    if (grid) {
      var length = grid.shape[0] * grid.shape[1]
      for (var i = 0; i < length; i++) {
        var value = grid.data[i] || 0
        var message = fn(value, i)
        if (message) {
          var key = message[0] + '/' + message[1]
          var lastValue = outputValues[key] && outputValues[key][2] || 0
          if (lastValue !== value) {
            outputValues[key] = message
            port.write(message)
          }
        }
      }
    } else {
      Object.keys(outputValues).forEach(function (key) {
        var lastMessage = outputValues[key]
        if (lastMessage && lastMessage[2]) {
          port.write(outputValues[key] = [lastMessage[0], lastMessage[1], 0])
        }
      })
    }
  })
  return obs
}

function LaunchpadToGrid (midiPort) {
  var obs = Observ(ArrayGrid([], [8, 8]))
  midiPort.on('data', (data) => {
    var col = data[1] % 16
    var row = Math.floor(data[1] / 16)
    if (col < 8 && row < 8) {
      var newValue = ArrayGrid(obs().data.slice(), obs().shape)
      newValue.set(row, col, data[2])
      obs.set(newValue)
    }
  })
  return obs
}

var MidiStream = require('midi-stream')
var Observ = require('observ')
var ArrayGrid = require('array-grid')
var Transform = require('observ-transform')
var connect = require('observ-transform/connect')
var send = require('observ-transform/send')
var watch = require('observ/watch')
var when = require('observ-transform/when')
var audio = require('./audio.js')
var workerTimer = require('worker-timer')

var launchpad = MidiStream('Launchpad Mini')
var currentPosition = PositionTicker(120)
var recordedEvents = []

var repeatRate = ToggleButtons(launchpad, 144, {
  8: null,
  24: 1,
  40: 2 / 3,
  56: 1 / 2,
  72: 1 / 3,
  88: 1 / 4,
  104: 1 / 6,
  120: 1 / 8
}, null)

var loopLength = Observ(16)
var currentLoop = Observ()
var undos = []
var redos = []

var suppressing = Observ(false)
var holdPosition = Observ(null)
var clearing = Observ(false)

launchpad.write([176, 0, 0])
launchpad.write([176, 106, 13])
launchpad.write([176, 107, 13])

MidiButtons(launchpad, 176, {
  104: function store () {
    undos.push(currentLoop())
    currentLoop.set(
      getLoop(currentPosition() - loopLength(), loopLength())
    )
  },
  105: function clear () {
    undos.push(currentLoop())
    currentLoop.set(null)
  },
  106: function undo () {
    redos.push(currentLoop())
    currentLoop.set(undos.pop())
  },
  107: function redo () {
    undos.push(currentLoop())
    currentLoop.set(redos.pop())
  },
  108: [
    function startHold () {
      holdPosition.set(currentPosition() - 1 / 24)
    },
    function endHold () {
      holdPosition.set(null)
    }
  ],
  109: [
    function startHold () {
      suppressing.set(true)
    },
    function endHold () {
      suppressing.set(false)
    }
  ],
  111: [
    function startClear () {
      clearing.set(true)
    },
    function endClear () {
      clearing.set(false)
    }
  ]
})

var transformedLoop = connect(
  currentLoop,
  HoldLoop(holdPosition, repeatRate),
  Suppress(suppressing)
)

var playback = connect(
  transformedLoop,
  PlayLoop(currentPosition),
  Overlay(connect(
    LaunchpadToGrid(launchpad),
    when(clearing, GrabGrid(clearAt), Repeater(currentPosition, repeatRate))
  )),
  send(
    connect(Range([3, 8], [0, 0]), GridToMidi(audio.synth, (value, i) => {
      return [144, scale(i, -1), value]
    })),
    connect(Range([2, 8], [3, 0]), GridToMidi(audio.bass, (value, i) => {
      return [144, scale(i), value]
    })),
    connect(Range([1, 4], [6, 0]), GridToMidi(audio.drums, (value, i) => {
      return [144, 36 + i, value]
    })),
    // connect(Range([1, 4], [7, 0]), GridToMidi(output, (value, i) => {
    //   return [148, 36 + i, value]
    // })),
    // connect(Range([2, 4], [6, 4]), GridToMidi(output, (value, i) => {
    //   return [149, scale(i), value]
    // })),
    RecordTo(recordedEvents, currentPosition)
  )
)

connect(
  connect(playback, RecentlyTriggered(currentPosition, loopLength, 13)),
  Overlay(connect(currentLoop, ActiveToGrid(20))),
  Overlay(playback),
  GridToMidi(launchpad, (value, i) => {
    var id = (i % 8) + (Math.floor(i / 8) * 16)
    return [144, id, value]
  })
)

function PositionTicker (tempo) {
  var obs = Observ(0)
  var ticks = 0
  var interval = 1 / (tempo / 60) / 12 * 1000
  workerTimer.setInterval(() => {
    ticks += 1
    obs.set(ticks / 12)
  }, interval)
  return obs
}

function clearAt (index) {
  undos.push(currentLoop())
  currentLoop.set({
    length: currentLoop().length,
    events: currentLoop().events.map((event) => {
      return {
        at: event.at,
        value: event.value && ArrayGrid(event.value.data.map((value, i) => {
          return i === index ? null : value
        }), event.value.shape) || null
      }
    })
  })
}

function GrabGrid (cb) {
  var obs = Observ()
  var lastValue = []
  obs.set = (value) => {
    if (value) {
      var length = value.shape[0] * value.shape[1]
      for (var i = 0; i < length; i++) {
        if (lastValue[i] !== value.data[i] && value.data[i]) {
          cb(i)
        }
      }
      lastValue = value.data
    } else {
      lastValue = []
    }
  }
  return obs
}

function Suppress (active) {
  return Transform(function (input, args) {
    if (!args.active) {
      return input
    }
  }, { active: active })
}

function HoldLoop (start, loopLength) {
  return Transform((input, args) => {
    if (input && args.start != null) {
      var length = args.loopLength || 2
      var start = args.start % input.length
      var end = (args.start + length) % input.length
      return {
        length: length,
        events: input.events.filter((event) => {
          if (start < end) {
            return event.at >= start && event.at < end
          } else {
            return event.at >= start || event.at < end
          }
        }).concat({
          at: start, value: null
        }).map((event) => {
          return {
            at: event.at % length,
            value: event.value
          }
        }).sort((a, b) => {
          return a.at - b.at
        })
      }
    } else {
      return input
    }
  }, { start: start, loopLength: loopLength })
}

function ActiveToGrid (value) {
  return Transform((loop) => {
    if (loop) {
      var result = []
      var shape = null
      loop.events.forEach((event) => {
        if (event && event.value) {
          shape = event.value.shape
          event.value.data.forEach((v, i) => {
            v && (result[i] = value)
          })
        }
      })
      return shape && ArrayGrid(result, shape)
    }
  })
}

function RecentlyTriggered (currentPosition, windowLength, value) {
  var lastTriggered = []
  var shape = null
  return Transform((input, args) => {
    if (input) {
      shape = input.shape
      for (var i = 0; i < input.shape[0] * input.shape[1]; i++) {
        input.data[i] && (lastTriggered[i] = currentPosition())
      }
    }
    return shape && ArrayGrid(lastTriggered.map((pos) => {
      return (pos > args.currentPosition - args.windowLength) ? value : null
    }), shape)
  }, { currentPosition: currentPosition, windowLength: windowLength })
}

function Overlay (grid) {
  return Transform((input, args) => {
    if (!input || !args.grid) {
      return input || args.grid
    } else {
      var result = []
      var length = input.shape[0] * input.shape[1]
      for (var i = 0; i < length; i++) {
        result[i] = args.grid.data[i] || input.data[i]
      }
      return ArrayGrid(result, input.shape)
    }
  }, { grid: grid })
}

function PlayLoop (currentPosition) {
  return Transform((input, args) => {
    if (input && input.events.length) {
      var value = input.events[input.events.length - 1].value
      for (var i = 0; i < input.events.length; i++) {
        if (input.events[i].at > args.currentPosition % input.length) {
          return value
        } else {
          value = input.events[i].value
        }
      }
      return value
    }
  }, { currentPosition: currentPosition })
}

function getLoop (start, length) {
  return {
    length: length,
    events: recordedEvents.filter((event) => {
      return event.at >= start && event.at < start + length
    }).map((event) => {
      return {
        at: event.at % length,
        value: event.value
      }
    }).sort((a, b) => { return a.at - b.at })
  }
}

function MidiButtons (port, message, handlers) {
  port.on('data', (data) => {
    if (data[0] === message) {
      var handler = handlers[data[1]]
      if (data[2]) {
        var fn = Array.isArray(handler) ? handler[0] : handler
        fn && fn()
      } else if (Array.isArray(handler) && handler[1]) {
        handler[1]()
      }
    }
  })
}

function RecordTo (target, currentPosition) {
  var obs = Observ()
  watch(obs, (value) => {
    var last = target[target.length - 1]
    if (last && last.at === currentPosition()) {
      target.pop()
    }
    target.push({
      at: currentPosition(),
      value: value
    })
  })
  return obs
}

function ToggleButtons (port, message, values, defaultValue) {
  var obs = Observ(defaultValue)
  port.on('data', function (data) {
    if (data[0] === message && data[2] && data[1] in values) {
      obs.set(values[data[1]])
    }
  })
  watch(obs, (value) => {
    for (var k in values) {
      port.write([message, parseInt(k, 10), values[k] === value ? 127 : 0])
    }
  })
  return obs
}

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

function scale (pos, octave) {
  var notes = [ 0, 2, 3, 4, 5, 7, 9, 10 ]
  var scalePosition = Math.floor(pos % notes.length)
  var multiplier = Math.floor(pos / notes.length) + (octave || 0)
  var note = notes[scalePosition]
  return note + (multiplier * 12) + 63
}

function Range (shape, offset) {
  return Transform((input) => {
    return input && input.getRange(shape, offset)
  })
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

function logGrid (grid) {
  var result = ''
  for (var row = 0; row < grid.shape[0]; row++) {
    for (var col = 0; col < grid.shape[1]; col++) {
      result += ('  ' + (grid.get(row, col) || 0)).slice(-3) + ' '
    }
    result += '\n'
  }
  console.log(result)
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

var fs = require('fs')
var ejs = require('ejs')
var markdown = require('./lib/markdown')
var additionalStyles = fs.readFileSync(require.resolve('highlight.js/styles/monokai.css'), 'utf8')
var raw = fs.readFileSync('README.md', 'utf8')
var template = ejs.compile(fs.readFileSync('slides.html.ejs', 'utf8'))

fs.writeFileSync('output.html', template({ 
  body: markdown.render(raw),
  additionalStyles: additionalStyles
}))

var fs = require('../')
  , compileUrl = fs.utils.compileUrl
  , expect = require('chai').expect;

var fixtures = [
  ['abc{d}ds', {d: 'E'}, 'abcEds', 'find & replace single'],
  ['abc{d}ds', {}, 'abcds', 'swallow missing'],
  ['abc/{d}/ds', {d: 'a/b&2=3'}, 'abc/a%2Fb%262%3D3/ds', 'escape args'],
  ['ab{d}c{d}ds', {d: 'E'}, 'abEcEds', 'find & replace single twice'],
  ['ab/{man}/c{d}ds', {d: 'E', man: 'Woman'}, 'ab/Woman/cEds', 'find & replace two'],
  ['ab/{man}/c{d}ds', {d: 'E'}, 'ab//cEds', 'find & replace & swallow'],
  ['example{?arg}', {}, 'example', 'swallow missing query'],
  ['example{?arg}', {arg: 'thing'}, 'example?arg=thing', 'do query right'],
  ['example{?arg,arg2}', {arg: 'thing'}, 'example?arg=thing', 'do query right & swallow'],
  ['example{?arg,arg2}', {arg: 'thing', arg2: 'mensch'}, 'example?arg=thing&arg2=mensch', 'do query right for two'],
  ['example{?arg}', {arg: 'a&b=2'}, 'example?arg=a%26b%3D2', 'escape query value'],
];

describe('UrlCompiler', function () {
  fixtures.forEach(function (item) {
    it('should ' + item[3], function () {
      expect(compileUrl(item[0])(item[1])).to.equal(item[2]);
    });
  });
});


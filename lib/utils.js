
var debug = require('debug')('familysearch:utils');

module.exports.compileUrl = function (template) {
  debug('Compiling', template);
  var inlines = []
    , queries = [];
  template = template.replace(/\{[^}]+\}/g, function (matched, index) {
    if (matched[1] === '?') {
      queries = matched.slice(2, -1).split(',');
      return '';
    }
    inlines.push(matched.slice(1, -1));
    return matched;
  });
  debug('compiled', template, inlines, queries);
  return function(options) {
    var tpl = template;
    inlines.forEach(function (name) {
      tpl = tpl.replace('{' + name + '}', encodeURIComponent(options[name] || ''));
    });
    var args = [];
    queries.forEach(function (name) {
      if (typeof (options[name]) !== 'undefined') {
        args.push(name + '=' + encodeURIComponent(options[name]));
      }
    });
    if (args.length) {
      tpl += '?' + args.join('&');
    }
    return tpl;
  };
}

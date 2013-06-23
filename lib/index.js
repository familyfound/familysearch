
var request = require('superagent')
  , debug = require('debug')('familyfound:fs')

  , utils = require('./utils');

var FS = function FS() {
  this.links = null;
  this.ondone = [];
  this.getMeta();
};

FS.prototype = {
  metaUrl: 'https://familysearch.org/.well-known/app-meta',
  getMeta: function () {
    var self = this;
    request.get(this.metaUrl)
      .set('Accept', 'application/json')
      .end(function (err, res) {
        if (err) {
          debug('Unable to get app-meta');
          return;
        }
        self.links = res.body.links;
        for (var name in self.links) {
          self.links[name].url = utils.compileUrl(self.links[name].template);
        }
        debug('Got app-meta');
        if (self.ondone.length) {
          self.ondone.forEach(function(fn) {
            fn();
          });
        }
      });
  },
  getRaw: function (url, token, next) {
    debug('Getting', url, token);
    request.get(url)
      .set('Accept', 'application/json')
      .set('Authorization', 'Bearer ' + token)
      .end(function (err, res) {
        if (err) {
          debug('Error', err.message);
          return next(err);
        }
        next(null, res);
      });
  },
  get: function (endpoint, options, token, next) {
    if (!this.links[endpoint]) {
      debug('Invalid endpoint', endpoint);
      return next('Invalid endpoint');
    }
    var url = this.links[endpoint].url(options);
    return this.getRaw(url, token, next);
  },
};

var single = null;

module.exports = {
  FS: FS,
  utils: utils,
  single: function () {
    if (single == null) single = new FS();
    return single;
  }
};


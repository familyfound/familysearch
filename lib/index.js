
var request = require('superagent')
  , debuggers = require('debug')
  , debug = debuggers('familysearch:main')
  , error = debuggers('familysearch:error')
  , requestlog = debuggers('familysearch:request')

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
          error('Unable to get app-meta', err);
          return;
        }
        self.links = res.body.links;
        debug('Got meta links', self.links.length);
        for (var name in self.links) {
          if (self.links[name].template) {
            self.links[name].url = utils.compileUrl(self.links[name].template);
          }
        }
        debug('Got app-meta');
        if (self.ondone.length) {
          self.ondone.forEach(function(fn) {
            fn();
          });
        }
      });
  },
  // next(err, body, res)
  getRaw: function (url, token, etag, next) {
    if (arguments.length === 3) {
      next = etag
      etag = null
    }
    requestlog('Getting', url, token);
    var req = request.get(url)
    req = req.set('Accept', 'application/json')
      .set('Authorization', 'Bearer ' + token)
    if (etag) {
      req = req.set('If-None-Match', etag)
    }
    req.end(function (err, res) {
      if (err) {
        error('Error', err.message);
        return next(err);
      }
      requestlog('from url', url, res.body);
      if (res.body.code && res.body.code !== 200) {
        return next(res.body);
      }
      next(null, res.body, res);
    });
    return this;
  },
  get: function (endpoint, options, token, etag, next) {
    if (arguments.length === 4) {
      next = etag
      etag = null
    }
    if (!this.links[endpoint]) {
      error('Invalid endpoint', endpoint);
      return next('Invalid endpoint');
    }
    var url = this.links[endpoint].href || this.links[endpoint].url(options);
    return this.getRaw(url, token, etag, next);
  }
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


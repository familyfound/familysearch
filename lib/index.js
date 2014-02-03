
var request = require('superagent')
  , debuggers = require('debug')
  , debug = debuggers('familysearch:main')
  , error = debuggers('familysearch:error')
  , requestlog = debuggers('familysearch:request')

  , utils = require('./utils');

function accessorize(link) {
  if (true || !link.type) return 'application/json'
  var fs = 'application/x-fs-v1+json'
    , gx = 'application/x-gedcomx-v1+json'
  if (link.type.indexOf(gx) !== -1) return gx
  if (link.type.indexOf(fs) !== -1) return fs
  return 'application/json'
}

var FS = function FS() {
  this.links = null;
  this.ondone = [];
  this.queue = {}
  this.queuing = {};
  this.getMeta();
};

FS.prototype = {
  metaUrl: 'https://familysearch.org/.well-known/app-meta',
  onDone: function (func) {
    if (this.links !== null) return func()
    this.ondone.push(func)
  },
  getMeta: function () {
    var self = this;
    request.get(this.metaUrl)
      .set('Accept', 'application/json')
      .end(function (err, res) {
        if (err) {
          error('Unable to get app-meta', err);
          throw new Error('Familysearch api failing?')
          return;
        }
        if (res.status !== 400 && !res.body.links) {
          console.error('links meta returned unexpected response', res.status, res.header, res.text)
          throw new Error('meta links bad')
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
  getRaw: function (endpoint, options, token, etag, next) {
    if (arguments.length === 3) {
      next = etag
      etag = null
    }
    if (!this.links[endpoint]) {
      error('Invalid endpoint', endpoint);
      return next('Invalid endpoint: ' + endpoint);
    }
    var url = this.links[endpoint].href || this.links[endpoint].url(options)
      , req = request.get(url)
      , accept = accessorize(this.links[endpoint])
    debug('Getting', url, this.links[endpoint].type, accept, token)
    req = req.set('Accept', accept)
      .set('Authorization', 'Bearer ' + token)
    if (etag) {
      req = req.set('If-None-Match', etag)
    }
    req.end(function (err, res) {
      if (err) {
        error('Error', err.message);
        return next(err, null, res);
      }
      requestlog('from url', url, res.body);
      if (res.body.code && res.body.code !== 200) {
        return next(res.body, null, res);
      }
      if (res.header.warning) {
        error('Got a warning from familysearch:', res.header.warning, url, token, etag)
      }
      next(null, res.body, res);
    });
    return this;
  },
  get: function (endpoint, options, token, etag, next) {
    var self = this
    if (arguments.length === 4) {
      next = etag
      etag = null
    }
    if (this.queuing[endpoint]) return this.enqueue(endpoint, options, token, etag, next)
    return this.getRaw(endpoint, options, token, etag, function (err, data, res) {
      if (err && err.code === 429) {
        console.log('Got throttled!', res && res.header)
        return self.enqueue(endpoint, options, token, etag, next, parseInt(res.header['retry-after'], 10) || 500)
      }
      next(err, data, res)
    });
  },
  enqueue: function (endpoint, options, token, etag, next, wait) {
    if (!this.queue[endpoint]) this.queue[endpoint] = []
    this.queue[endpoint].push([options, token, etag, next])
    if (!this.queuing[endpoint]) {
      this.queuing[endpoint] = true
      setTimeout(this.dequeue.bind(this, endpoint), wait || 500)
    }
  },
  dequeue: function (endpoint) {
    if (!this.queue[endpoint]) return console.error('Queue not there while dequeuing', endpoint)
    if (!this.queue[endpoint].length) {
      this.queuing[endpoint] = false
      return
    }
    var next = this.queue[endpoint].shift()
      , self = this
    this.getRaw(endpoint, next[0], next[1], next[2], function (err, data, res) {
      if (err && err.code === 429) {
        console.log('Got throttled again!', res.header)
        self.queue[endpoint].unshift(next)
        return setTimeout(self.dequeue.bind(self, endpoint), parseInt(res.header['retry-after'], 10) || 500)
      }
      next[3](err, data, res)
      self.dequeue(endpoint)
    })
  },
  cached: function (collection, options, done) {
    var endpoint = options.path
      , post = options.data
      , token = options.token
      , newtime = options.newtime || 0
    var that = this
    function gotten(err, data, res) {
      if (err) return done(err, data)
      collection.update({
        endpoint: endpoint,
        post: post
      }, {
        endpoint: endpoint,
        post: post,
        data: data,
        etag: res.header.etag,
        time: new Date()
      }, {upsert: true}, function () {
        done(err, data, res)
      })
    }
    
    collection.findOne({
      endpoint: endpoint,
      post: post
    }, function (err, cached) {
      if (err) {
        console.error('Error getting cached')
        return that.get(endpoint, post, token, gotten)
      }
      if (!cached) return that.get(endpoint, post, token, gotten)
      var now = new Date().getTime()
      // skip the api call
      if ((now - cached.time.getTime())/1000 < newtime) {
        return done(null, cached.data, null)
      }
      that.get(endpoint, post, token, cached.etag, function (err, data, res) {
        if (err) return done(err)
        if (res.status === 304) {
          return done(null, cached.data, res)
        }
        gotten(err, data, res)
      })
    })
        
  }
};

var single = null;

module.exports = {
  FS: FS,
  utils: utils,
  single: function () {
    if (single === null) single = new FS();
    return single;
  }
};


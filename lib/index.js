
var request = require('superagent')
  , debuggers = require('debug')
  , debug = debuggers('familysearch:main')
  , error = debuggers('familysearch:error')
  , perf = debuggers('familysearch:perf')
  , requestlog = debuggers('familysearch:request')

  , CACHE_ONLY = process.env.CACHE_ONLY

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
  this.cache_queue = {}
  this.getMeta();
};

var EXTRA_LINKS = {
  "person-not-a-match-template" : {
    "template" : "https://sandbox.familysearch.org/platform/tree/persons/{pid}/not-a-match.json{?access_token}",
    "type" : "application/atom+xml,application/json,application/x-gedcomx-atom+json,application/xml,text/html",
    "accept" : "*/*",
    "allow" : "GET",
    "title" : "Person Not A Match"
  },
}

function addExtraLinks(links) {
  for (var name in EXTRA_LINKS) {
    links[name] = EXTRA_LINKS[name]
  }
}

FS.prototype = {
  metaUrl: 'https://sandbox.familysearch.org/.well-known/app-meta',
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
        addExtraLinks(self.links)
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
    if (!this.links) {
      return next(new Error("Links not fetched yet..."))
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
      if (res.header.warning) {
        error('Got a warning from familysearch:', res.header.warning, url, token, etag)
      }
      var body = {}
      if (res.text) {
        try {
          body = JSON.parse(res.text)
        } catch(e) {
          error('Error parsing:', res.text, res.status)
          return next(new Error('failed to parse response body'), null, res)
        }
      }
      requestlog('from url', url, body);
      if (body.code && body.code !== 200) {
        return next(res.body, null, res);
      }
      next(null, body, res);
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
  bouncy_cached: function (collection, options, done) {
    var key = options.path + ' : ' + JSON.stringify(options.data) + ' : ' + options.token
    if (this.cache_queue[key]) {
      perf('bounce', key)
      return this.cache_queue[key].push(done)
    }
    var queue = this.cache_queue[key] = [done]
      , that = this
    this.cached(collection, options, function (err, data) {
      for (var i=0; i<queue.length; i++) {
        queue[i](err, data)
      }
      delete that.cache_queue[key]
    })
  },
  cached: function (collection, options, done) {
    var endpoint = options.path
      , post = options.data
      , token = options.token
      , newtime = options.newtime || 0
    var that = this
      , start = new Date()
    function gotten(err, data, res) {
      if (err) return done(err, data)
      perf('Made request', endpoint, post, new Date().getTime() - start.getTime())
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
        perf('Saved in cache', endpoint, post, new Date().getTime() - start.getTime())
        done(err, data, res)
      })
    }
    
    perf('looking for', endpoint, post, start)
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
      if (CACHE_ONLY || (now - cached.time.getTime())/1000 < newtime) {
        perf('Skipping request, cache is new enough', endpoint, post, new Date().getTime() - start.getTime())
        return done(null, cached.data, null)
      }
      that.get(endpoint, post, token, cached.etag, function (err, data, res) {
        if (err) return done(err)
        if (res.status === 304) {
          perf('Cache hit from request', endpoint, post, new Date().getTime() - start.getTime())
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


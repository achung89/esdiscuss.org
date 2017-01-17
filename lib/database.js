var Q = require('q');
var ms = require('ms');
var moment = require('moment');
var crypto = require('crypto');
var querystring = require('querystring');
var mongo = require('then-mongo');
var user = process.env.MONGO_USER || 'read'
var pass = process.env.MONGO_PASS || 'read'
var db = mongo(user + ':' + pass + '@ds039912-a0.mongolab.com:39912,ds039912-a1.mongolab.com:39912/esdiscuss-new?replicaSet=rs-ds039912',
  ['topics', 'headers', 'contents', 'history', 'log', 'runsPerDay'])
var processMessage = require('./process').processMessage

function protect(fn) {
  return function () {
    var self = this
    var args = arguments
    return Q.promise(function (resolve, reject) {
      fn.apply(self, args).then(function (res) {
        resolve(res)
      }, function (err) {
        reject(err)
      })
    })
  }
}

exports.user = function (email) {
  var hash = crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex')
  var user = {
    email: email,
    hash: hash,
    avatar: avatar(hash),
    profile: profile(hash)
  }
  return Q(user)
}
exports.message = protect(function (id) {
  var header = db.headers.findOne({_id: id})
  var content = db.contents.findOne({_id: id})
  return Q.all([header, content]).spread(function (message, content) {
    if (!message) return null
    message.from.hash = crypto.createHash('md5').update(message.from.email.toLowerCase().trim()).digest('hex');
    message.from.avatar = avatar(message.from.hash);
    message.from.profile = profile(message.from.hash);
    message.edited = content.edited || processMessage(content.content)
    message.original = content.content
    return message
  });
});
exports.update = function (id, content, email) {
  var now = new Date()
  return db.history.insert({_id: now.toISOString(), id: id, date: now, user: email, content: content}, {safe: true})
  .then(function () {
    var contentUpdated = Q.promise(function (resolve, reject) {
      db.contents.update({_id: id}, {'$set': { updated: now, edited: content } }, function (err, res) {
        if (err) reject(err)
        else resolve(res)
      })
    })
    var headerUpdated = Q.promise(function (resolve, reject) {
      db.headers.update({_id: id}, {'$set': { updated: now } }, function (err, res) {
        if (err) reject(err)
        else resolve(res)
      })
    })
    return Q.all([contentUpdated, headerUpdated])
  })
};
exports.history = protect(function (id) {
  var now = new Date()
  var original = exports.message(id)
  var edits = Q.all(db.history.find({id: id}).sort({'date':1})
  .then(function (edits) {
    return edits.map(function (e) {
      return exports.user(e.user)
        .then(function (user) {
          e.from = user
          return e
        })
    })
  }))
  return Q.all([original, edits])
    .then(function (args) {
      return {
        original: args[0],
        edits: args[1]
      }
    })
});
exports.fromURL = protect(function (url) {
  return db.headers.find({url: url}).then(function (res) {
    return res[0] || null;
  });
});
exports.location = protect(function (subjectID, date) {
  var path = db.topics.findOne({subjectID: subjectID}).then(function (res) {
    return res._id;
  });
  var messageNum = db.headers.count({ 'subjectID': subjectID, 'date': {'$lt': date} });
  return Q.all([path, messageNum])
          .spread(function (path, messageNum) {
            return {subjectID: path, messageNum: messageNum}
          })
});

exports.topic = protect(function (subjectID) {
  return db.topics.findOne({_id: subjectID})
    .then(function (res) {
      if (!res) {
        return []
      }
      var headers = db.headers.find({subjectID: res.subjectID}).sort({date: 1})
      var contents = db.contents.find({subjectID: res.subjectID})
      return Q.all([headers, contents]).spread(function (headers, contents) {
        headers.forEach(function (message) {
          message.from.hash = crypto.createHash('md5').update(message.from.email.toLowerCase().trim()).digest('hex');
          message.from.avatar = avatar(message.from.hash);
          message.from.profile = profile(message.from.hash);
          var c = contents.filter(function (m) { return m._id === message._id })[0]
          message.edited = c.edited || processMessage(c.content)
          message.original = c.content
          message.updated = message.updated || c.updated
        })
        return headers
      })
    })
});
exports.getNewLocation = protect(function (oldSubjectID) {
  return db.topics.findOne({subjectID: oldSubjectID}).then(function (res) {
    return res && res._id
  })
});

function avatar(hash) {
  return 'https://secure.gravatar.com/avatar/' + hash + '?s=200&d=mm';
}
function profile(hash) {
  return 'http://www.gravatar.com/' + hash;
}

//sample topic
/*
[ { from: { email: 'nrubin@nvidia.com', name: 'Norm Rubin' },
    date: Fri Apr 05 2013 13:54:26 GMT+0100 (GMT Summer Time),
    subject: 'another rivertrail question',
    messageID: '<A4DCC42E2B5835498682FCB0A8F9F8733787065E70@HQMAIL04.nvidia.com>',
    _id: '2013-04/A4DCC42E2B5835498682FCB0A8F9F8733787065E70@HQMAIL04.nvidia.com',
    subjectID: 'anotherrivertrailquestion',
    month: '2013-04',
    id: 'A4DCC42E2B5835498682FCB0A8F9F8733787065E70@HQMAIL04.nvidia.com' },
  { from: { email: 'rick.hudson@intel.com', name: 'Hudson, Rick' },
    date: Fri Apr 05 2013 18:19:59 GMT+0100 (GMT Summer Time),
    subject: 'another rivertrail question',
    inReplyTo: '<A4DCC42E2B5835498682FCB0A8F9F8733787065E70@HQMAIL04.nvidia.com>',
    references: '<A4DCC42E2B5835498682FCB0A8F9F8733787065E70@HQMAIL04.nvidia.com>',
    messageID: '<7B9BA3214DBE2B42AE93AE882BD001960F41400F@fmsmsx110.amr.corp.intel.com>',
    _id: '2013-04/7B9BA3214DBE2B42AE93AE882BD001960F41400F@fmsmsx110.amr.corp.intel.com',
    subjectID: 'anotherrivertrailquestion',
    month: '2013-04',
    id: '7B9BA3214DBE2B42AE93AE882BD001960F41400F@fmsmsx110.amr.corp.intel.com' }]
*/

exports.page = protect(function (page, numberPerPage) {
  numberPerPage = numberPerPage || 20;
  return db.topics.find().sort({end: -1}).skip(page * numberPerPage).limit(numberPerPage + 1)
    .then(function (res) {
      if (res.length < numberPerPage + 1) res.last = true
      else res.pop()

      res.forEach(function (topic) {
        topic.start = moment(topic.start)
        topic.end = moment(topic.end)
      })
      return res
    })
});

//sample page
/*
[ { _id: 'anotherrivertrailquestion',
    subject: 'another rivertrail question',
    messages: 2,
    first: { email: 'nrubin@nvidia.com', name: 'Norm Rubin' },
    last: { email: 'rick.hudson@intel.com', name: 'Hudson, Rick' },
    start: Fri Apr 05 2013 13:54:26 GMT+0100 (GMT Summer Time),
    end: Fri Apr 05 2013 18:19:59 GMT+0100 (GMT Summer Time) },
  { _id: 'howtosubmitaproposalfocmascript',
    subject: 'how to submit a proposal for ECMAScript 7?',
    messages: 2,
    first: { email: 'ohad.assulin@hp.com', name: 'Assulin, Ohad' },
    last: { email: 'bruant.d@gmail.com', name: 'David Bruant' },
    start: Fri Apr 05 2013 11:00:10 GMT+0100 (GMT Summer Time),
    end: Fri Apr 05 2013 11:27:37 GMT+0100 (GMT Summer Time) },

  last: false
]
*/

exports.botRuns = function () {
  return db.runsPerDay.find().then(function (days) {
    return days.sort(function (a, b) {
      return a._id < b._id ? -1 : 1;
    });
  });
};

// TODO: fetch the 10 records once every 10 minutes
exports.getAllMessagesForSearch = function (start, limit) {
  return Q(db.headers.find().sort({date: -1}).skip(start).limit(limit)).then(headers => {
    return Q.all(headers.map(header => {
      return db.contents.findOne({_id: header._id}).then(content => {
        return {
          objectID: header._id,
          subject: header.subject,
          content: content.content.substr(0, 5000),
          fromName: header.from.name,
          fromEmail: header.from.email,
          date: header.date,
          subjectID: header.subjectID,
        };
      });
    }));
  });
};
exports.getTopicFromMessageID = function (messageID) {
  return Q(db.headers.findOne({_id: messageID})).then(header => {
    return db.topics.findOne({subjectID: header.subjectID}).then(topic => {
      return topic._id;
    })
  });
}

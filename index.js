var fs = require('fs'),
    hapi = require('hapi'),
    pg = require('pg'),
    boom = require('boom'),
    pg_copy = require('pg-copy-streams'),
    reformatCsv = require('./lib/reformat-csv');

var user = process.env.DBUsername;
var password = process.env.DBPassword;
var address = process.env.DBAddress;
var database = process.env.Database;

// short term, to prevent the need from building out user authentication until later
var uploadPassword = process.env.uploadPassword;

// on RDS, how do I set a security group?
    // or whitelist this instance or something, somehow
    // this must not happen in the main app, probably in install somewhere

var conString = 'postgres://' +
    user + ':' +
    password + '@' +
    address + '/' +
    database;

var server = new hapi.Server();
var port = 8000;

server.connection({
    port: port,
    routes: {
        cors: true
    }
});

server.route({
    method: 'POST',
    path:'/error/{error}',
    handler: function(request, reply) {
        // get the next item from the table specified in {error}
        console.log(request.params.error);

        pg.connect(conString, function(err, client, done) {
            if (err) return console.log(err);
            client.query('UPDATE $1 x set unixtime=$2 from (select key, unixtime from $1 where unixtime < 1 limit 1) as sub where x.key=sub.key returning t.key, t.value;', [], function() {

            });
        });

        return reply(request.params.error);
    }
});

server.route({
    method: 'POST',
    path: '/fixed/{error}',
    handler: function(request, reply) {
        reply('ok');
    }
});

server.route({
    method: 'POST',
    path: '/csv',
    config: {
        payload: {
            maxBytes: 200000000,
            output: 'stream',
            parse: true
        }
    },
    handler: function(request, reply) {
        // confirm db config vars are set
        // err immeditately if not

        var data = request.payload;

        if (!data.file ||
            (!data.password || data.password === '') ||
            (!data.name || data.name === '')) return reply(boom.badRequest('missing something'));

        if (data.password != uploadPassword) return reply(boom.unauthorized('invalid password'));

        if (data.file) {
            var name = data.file.hapi.filename;
            var internalName = data.name.replace(/[^a-zA-Z]+/g, '').toLowerCase();

            // just looking at the extension for now
            if (name.slice(-4) != '.csv') return reply(boom.badRequest('.csv files only'));

            var path = (process.env.UploadPath || '/mnt/uploads');
            if (path[path.length-1] !== '/') path = path + '/';

            var file = fs.createWriteStream(path + name);

            file.on('error', function (err) {
                reply(boom.badRequest(err));
            });

            data.file.pipe(file);

            data.file.on('end', function (err) {
                reformatCsv(path, path + name, function(err, filename) {
                    if (err) {
                        fs.unlink(path + name, function() {
                            reply(boom.badRequest(err));
                        });
                    } else {
                        var closed = 0;

                        pg.connect(conString, function(err, client, done) {
                            // why does this not catch basic non-auth errors from rds?
                            if (err) return reply(boom.badRequest(err));

                            client.query('create table if not exists temp_' + internalName + ' (key varchar(255), value text);', function(err, results) {
                                if (err) {
                                    client.end();
                                    return reply(boom.badRequest(err));
                                }
                            });

                            var stream = client.query(pg_copy.from('COPY temp_' + internalName + ' FROM STDIN (format csv);'));
                            var fileStream = fs.createReadStream(filename, {encoding: 'utf8'});

                            fileStream
                                .on('error', function(err) {
                                    client.end();
                                    return reply(boom.badRequest(err));
                                })
                                .pipe(stream)
                                    .on('finish', theend)
                                    .on('error', theend);

                            // do this because both will emit something, and reply twice errors
                            function theend(err) {
                                if (err) {
                                    if (!closed) client.end();
                                    closed = 1;
                                    return closed ? null : reply(boom.badRequest(err));
                                }
                                setTimeout(function() {
                                    // https://github.com/brianc/node-pg-copy-streams/issues/22
                                    client.query('alter table temp_' + internalName + ' rename to ' + internalName, function(err, results) {
                                        if (err) {
                                            client.end();
                                            return reply(boom.badRequest(err));
                                        }
                                        client.end();
                                        return reply('ok');
                                    });
                                }, 500);
                            }
                        });

                    }
                });
            });

        }
    }
});

server.start(function() {
    console.log('started on port', port);
});

// curl -i -F name=something -F file=@with-cats.csv http://localhost:8000/csv

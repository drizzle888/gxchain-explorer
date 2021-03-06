import express from 'express';
import logger from 'morgan';
import bodyParser from 'body-parser';
import http from 'http';

import path from 'path';
import Promise from 'bluebird';
import { Apis, Manager } from 'gxbjs-ws';
import { ChainStore } from 'gxbjs';
import BlockSyncTask from './tasks/BlockSyncTask';
import LevelDBService from './services/LevelDBService';
import figlet from 'figlet';
import colors from 'colors/safe';

import opn from 'opn';
import webpackConfig from '../build/webpack.dev.conf';
import webpack from 'webpack';
import config from '../config';

require('debug')('gxb-explorer:server');

let autoOpenBrowser = !!config.dev.autoOpenBrowser;
let app = express();
let compiler = webpack(webpackConfig);

let devMiddleware = null;

let hotMiddleware = null;

if (app.get('env') === 'development') {
  devMiddleware = require('webpack-dev-middleware')(compiler, {
    publicPath: webpackConfig.output.publicPath,
    quiet: true
  });

  hotMiddleware = require('webpack-hot-middleware')(compiler, {
    log: console.log,
    heartbeat: 2000
  });

  compiler.plugin('compilation', function(compilation) {
    compilation.plugin('html-webpack-plugin-after-emit', function(data, cb) {
      hotMiddleware.publish({ action: 'reload' });
      cb();
    });
  });
  app.use(logger('dev'));
  app.use(devMiddleware);
  app.use(hotMiddleware);

  var staticPath = path.posix.join(
    config.dev.assetsPublicPath,
    config.dev.assetsSubDirectory
  );
  app.use(staticPath, express.static('./static'));
} else {
  app.use(logger('combined'));
  app.use(express.static('./dist'));
}

app.use(
  require('connect-history-api-fallback')({
    index: '/',
    rewrites: [
      {
        from: '/api/*',
        to: function(options) {
          return options.parsedUrl.href;
        }
      }
    ]
  })
);

app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: false, limit: '5mb' }));

let connected = false;
const connectedCheck = function(req, res, next) {
  if (connected) {
    next();
  } else {
    res.status(500).send({
      message: '?????????????????????,???????????????'
    });
  }
};

app.use('/api', connectedCheck, require('./routes/api'));

app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

if (app.get('env') === 'development') {
  app.use(function(err, req, res) {
    res.status(err.status || 500);
    res.send({
      message: err.message,
      error: err
    });
  });
}

app.use(function(err, req, res) {
  res.status(err.status || 500);
  res.send({
    message: err.message,
    error: {}
  });
});

/**
 * ????????????????????????
 * @param latencies
 * @param witnesses
 * @returns {Array.<T>|*}
 */
const filterAndSortURLs = (latencies, witnesses) => {
  let us = witnesses
    .filter(a => {
      /* Only keep the nodes we were able to connect to */
      return !!latencies[a];
    })
    .sort((a, b) => {
      return latencies[a] - latencies[b];
    });
  return us;
};

let witnesses =
  process.env.NODE_ENV === 'production'
    ? config.build.witnesses
    : config.dev.witnesses;

if (witnesses.length === 0) {
  console.error('?????????????????????,?????????config.json???????????????common.witnesses');
  process.exit(1);
}
/**
 * ??????witness
 * @param callback
 */
let connect = function(callback) {
  let connectionManager = new Manager({ url: witnesses[0], urls: witnesses });
  connectionManager
    .checkConnections()
    .then(resp => {
      let urls = filterAndSortURLs(resp, witnesses);
      console.log(urls);
      if (urls.length === 0) {
        console.error('???????????????,3????????????');
        setTimeout(function() {
          connect(callback);
        }, 3000);
      } else {
        connectionManager.urls = urls;
        connectionManager
          .connectWithFallback(true)
          .then(() => {
            console.log('?????????');
            connected = true;
            callback && callback();
          })
          .catch(ex => {
            console.error('????????????,3????????????', ex.message);
            setTimeout(function() {
              connect(callback);
            }, 3000);
          });
      }
    })
    .catch(ex => {
      console.error('??????????????????,3????????????', ex.message);
      setTimeout(function() {
        connect(callback);
      }, 3000);
    });
};

/**
 * ??????web??????
 */
let serverStarted = false;
let port = parseInt(process.env.port || '3030');
let startServer = function() {
  if (serverStarted) {
    return;
  }
  serverStarted = true;
  app.set('port', port);
  let server = http.createServer(app);
  server.listen(port);
  server.on('error', onError);
  server.on('listening', () => {
    devMiddleware &&
      devMiddleware.waitUntilValid(() => {
        var uri = `http://localhost:${port}`;
        console.log('> Listening at ' + uri + '\n');
        if (app.get('env') === 'development' && autoOpenBrowser) {
          opn(uri);
        }
      });
  });
  figlet('GXB-EXPLORER', 'Standard', function(err, text) {
    if (err) {
      console.error(err);
    }
    console.log(
      colors.rainbow(
        '\n=*=*=*=*=*=*=*=*=*==*=*=GXChain????????????????????????=*=*=*==*=*=*=*=*=*=*=\n'
      )
    );
    console.log(
      colors.cyan(
        `${(text || '')
          .split('\n')
          .map(function(line) {
            return `${line}`;
          })
          .join('\n')}`
      )
    );
    console.log(
      colors.rainbow(
        '=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=*=**=*=*=*=*=*=*=\n'
      )
    );
  });
};

/**
 * ??????????????????
 * @type {boolean}
 */
let subscribed = false;
let startSubScribe = function() {
  if (subscribed) {
    return;
  }
  subscribed = true;
  ChainStore.subscribe(function() {
    let dynamicGlobal = ChainStore.getObject('2.1.0').toJS();
    // console.log('latest block:', dynamicGlobal.last_irreversible_block_num);
    process.env.SYNC &&
      BlockSyncTask.sync_to_block(dynamicGlobal.last_irreversible_block_num);
  });
  Apis.instance()
    .db_api()
    .exec('get_objects', [['2.1.0']]);
};

/**
 * ???????????????
 */
let initConnection = function() {
  console.log('?????????????????????');
  let promises = [ChainStore.init(), BlockSyncTask.init()];
  Promise.all(promises)
    .then(function() {
      console.log('???????????????');
      startSubScribe();
      startServer();
    })
    .catch(ex => {
      console.error(
        '????????????????????????,?????????:\n1. ???????????????????????? \n2. ????????????????????????\n',
        ex
      );
    });
};
// websocket ????????????
Apis.setRpcConnectionStatusCallback(function(status) {
  var statusMap = {
    open: '??????',
    closed: '??????',
    error: '??????',
    reconnect: '????????????'
  };

  console.log('witness????????????:', statusMap[status] || status);

  if (status === 'reconnect') {
    console.log('????????????');
    ChainStore.resetCache();
  } else if (connected && (status === 'closed' || status === 'error')) {
    // ????????????
    connected = false;
    console.log('??????????????????witness');
    connect(function() {
      ChainStore.subscribed = false;
      ChainStore.subError = null;
      ChainStore.clearCache();
      ChainStore.head_block_time_string = null;
      initConnection();
    });
  }
});
// ????????????
connect(function() {
  initConnection();
});

/**
 * Event listener for HTTP server "error" event.
 */
function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  var bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}

process.stdin.resume();

function exitHandler(reason, err) {
  if (err) console.log(err.stack);
  console.log('????????????:', reason);
  Promise.all([
    BlockSyncTask.store(),
    LevelDBService.put('last-close', new Date().getTime())
  ])
    .then(function() {
      process.exit();
    })
    .catch(() => {
      process.exit();
    });
}

// do something when app is closing
process.on('exit', exitHandler.bind(null, 'exit'));

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, 'SIGINT'));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, 'uncaughtException'));

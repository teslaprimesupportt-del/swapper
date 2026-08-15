// Test what hostname the standalone server binds to
const http = require('http');

// Monkey-patch to see what listen() receives
const origListen = http.Server.prototype.listen;
http.Server.prototype.listen = function(port, host, ...args) {
  console.log('listen() called with:', JSON.stringify({ port, host }));
  return origListen.call(this, port, host, ...args);
};

// Now require and start (simulates standalone server.js)
process.env.PORT = '9999';
process.env.HOSTNAME = '0.0.0.0';

const {startServer} = require('next/dist/server/lib/start-server');
startServer({ dir: '/home/z/my-project', isDev: false, port: 9999 })
  .then(() => {
    console.log('Server started - check listen() output above');
    // Test if we can reach it
    http.get('http://0.0.0.0:9999', (res) => {
      console.log('HTTP response:', res.statusCode);
      process.exit(0);
    }).on('error', (e) => {
      console.log('HTTP error:', e.message);
      process.exit(1);
    });
    setTimeout(() => process.exit(1), 3000);
  })
  .catch((e) => {
    console.error('Start error:', e.message);
    process.exit(1);
  });

'use strict';
const { execSync } = require('child_process');
const path = require('path');

// Verify Administrator privileges
try {
  execSync('net session', { stdio: 'ignore' });
} catch {
  console.error('ERROR: Administrator privileges required.');
  console.error('Please right-click your terminal and select "Run as administrator".');
  process.exit(1);
}

const { Service } = require('node-windows');

const svc = new Service({
  name:   'DoneNextService',
  script: path.resolve(__dirname, '..', 'server.js'),
});

svc.on('uninstall', () => {
  console.log('');
  console.log('==========================================');
  console.log(' DoneNextService stopped and removed.');
  console.log('==========================================');
});

svc.on('error', (err) => {
  console.error('Error:', err);
});

svc.uninstall();

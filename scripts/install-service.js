'use strict';
const { execSync } = require('child_process');
const path = require('path');

// Verify elevated token (High Mandatory Level = S-1-16-12288)
// 'net session' is unreliable in GPO-restricted enterprise environments.
try {
  const groups = execSync('whoami /groups', { encoding: 'utf8' });
  if (!groups.includes('S-1-16-12288')) throw new Error('not elevated');
} catch {
  console.error('ERROR: Administrator privileges required.');
  console.error('Please right-click your terminal and select "Run as administrator".');
  process.exit(1);
}

const { Service } = require('node-windows');

const svc = new Service({
  name:        'DoneNextService',
  displayName: 'DoneNext Task Management',
  description: 'DoneNext internal task management web service.',
  script:      path.resolve(__dirname, '..', 'server.js'),
  wait:        2,
  grow:        0.5,
});

svc.on('install', () => {
  console.log('Service installed. Starting...');
  svc.start();
});

svc.on('start', () => {
  console.log('');
  console.log('==========================================');
  console.log(' DoneNextService installed and started.');
  console.log(' Startup type: Automatic');
  console.log(' View in: services.msc');
  console.log('==========================================');
});

svc.on('alreadyinstalled', () => {
  console.log('DoneNextService is already installed.');
});

svc.on('error', (err) => {
  console.error('Error:', err);
});

svc.install();

const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '.env');
const envVars = {};
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf-8').split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && key.trim() && !key.startsWith('#')) {
      envVars[key.trim()] = vals.join('=').trim();
    }
  });
}

module.exports = {
  apps: [{
    name: 'mavrion-conect',
    script: 'dist/index.cjs',
    cwd: '/var/www/mavrion-conect',
    env: envVars,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    log_file: '/var/log/mavrion/app.log',
    error_file: '/var/log/mavrion/error.log',
    out_file: '/var/log/mavrion/out.log',
    time: true
  }]
};

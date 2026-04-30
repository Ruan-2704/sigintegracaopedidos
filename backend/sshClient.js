const fs = require('fs');
const { Client } = require('ssh2');

function getSshConfig(target = 'files') {
  const prefix = target === 'pedidos' ? 'SSH_PEDIDOS' : 'SSH_FILES';
  const config = {
    host: process.env[`${prefix}_HOST`],
    port: Number(process.env[`${prefix}_PORT`] || 22),
    username: process.env[`${prefix}_USER`],
    readyTimeout: Number(process.env.SSH_READY_TIMEOUT || 20000),
  };
  const privateKeyPath = process.env[`${prefix}_PRIVATE_KEY_PATH`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (privateKeyPath) config.privateKey = fs.readFileSync(privateKeyPath);
  if (password) config.password = password;
  return config;
}

function runSshCommand(command, target = 'files') {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    conn
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) { conn.end(); return reject(err); }
          stream
            .on('close', (code) => { conn.end(); resolve({ code, stdout, stderr, target }); })
            .on('data', (data) => { stdout += data.toString(); });
          stream.stderr.on('data', (data) => { stderr += data.toString(); });
        });
      })
      .on('error', reject)
      .connect(getSshConfig(target));
  });
}

module.exports = { runSshCommand };

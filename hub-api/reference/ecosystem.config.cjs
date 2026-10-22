// Ecosystem da Hub API (pm2 `mavrion-api` na VPS — /var/www/mavrion-api).
// NÃO colocar segredos aqui: os valores vêm do `.env` no mesmo diretório.
// Parser sem dependências (dotenv não está instalado na VPS).
const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {}
  return out;
}

const envFile = loadEnv(path.join(__dirname, ".env"));

module.exports = {
  apps: [{
    name: "mavrion-api",
    script: "dist/index.cjs",
    env: {
      PORT: envFile.PORT || 5002,
      NODE_ENV: "production",
      DATABASE_URL: envFile.DATABASE_URL,
      SESSION_SECRET: envFile.SESSION_SECRET,
      API_KEYS: envFile.API_KEYS,
      FUNAI_SYNC_ENABLED: envFile.FUNAI_SYNC_ENABLED,
      CPRM_SYNC_ENABLED: envFile.CPRM_SYNC_ENABLED,
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: "500M",
  }],
};

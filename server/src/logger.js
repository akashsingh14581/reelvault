// Tiny structured logger. Never pass secrets, tokens or credentials into `meta`.
const SENSITIVE = /(secret|password|token|authorization|api_?key|signature)/i;

function clean(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE.test(k)) continue;
    if (v instanceof Error) out[k] = v.message;
    else out[k] = v;
  }
  return out;
}

function write(level, event, meta) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...clean(meta) });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const log = {
  info: (event, meta) => write('info', event, meta),
  warn: (event, meta) => write('warn', event, meta),
  error: (event, meta) => write('error', event, meta),
};

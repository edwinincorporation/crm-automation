// TEST / LIVE switch. A value set from the portal wins; otherwise the DRY_RUN env value is used.
const { db } = require('./db');
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
const get = () => (db.prepare("SELECT value FROM settings WHERE key='dry_run'").get() || {}).value;
const isDry = () => { const v = get(); return v === '1' ? true : v === '0' ? false : process.env.DRY_RUN === '1'; };
const setDry = (on) => db.prepare("INSERT INTO settings(key,value) VALUES('dry_run',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(on ? '1' : '0');
module.exports = { isDry, setDry };

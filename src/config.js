import 'dotenv/config';

export const config = {
  port: process.env.PORT || '8090',
  dbPath: process.env.DB_PATH || './data/mw-cron.db',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS || 'changeme',
  sessionSecret: process.env.SESSION_SECRET || 'default-secret-change-me',
};

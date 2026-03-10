import { getDb, saveDatabase } from './database.js';

function getNotificationConfig(channel) {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM notification_configs WHERE channel = ?");
  stmt.bind([channel]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

async function sendDiscord(webhookUrl, embed) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'MW-Cron Monitor',
      embeds: [embed],
    }),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status}`);
  }
}

async function sendTelegram(botToken, chatId, message) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }),
  });
  if (!res.ok) {
    throw new Error(`Telegram API failed: ${res.status}`);
  }
}

export async function notify(endpoint, result, previousStatus) {
  const isDown = result.status === 'down';
  const isRecovery = previousStatus === 'down' && result.status === 'up';

  if (!isDown && !isRecovery) return;

  // Discord
  try {
    const discord = getNotificationConfig('discord');
    if (discord && discord.enabled && discord.webhook_url) {
      const shouldNotify = (isDown && discord.notify_on_down) || (isRecovery && discord.notify_on_up);
      if (shouldNotify) {
        const color = isDown ? 0xEF4444 : 0x10B981;
        const statusText = isDown ? '🔴 DOWN' : '🟢 RECOVERED';
        await sendDiscord(discord.webhook_url, {
          title: `${statusText} — ${endpoint.name}`,
          description: `**URL:** ${endpoint.url}\n**Status Code:** ${result.status_code || 'N/A'}\n**Latency:** ${result.latency_ms}ms${result.error_msg ? `\n**Error:** ${result.error_msg}` : ''}`,
          color,
          timestamp: new Date().toISOString(),
          footer: { text: 'MW-Cron Monitor' },
        });
      }
    }
  } catch (err) {
    console.error('[Discord notification error]', err.message);
  }

  // Telegram
  try {
    const telegram = getNotificationConfig('telegram');
    if (telegram && telegram.enabled && telegram.bot_token && telegram.chat_id) {
      const shouldNotify = (isDown && telegram.notify_on_down) || (isRecovery && telegram.notify_on_up);
      if (shouldNotify) {
        const emoji = isDown ? '🔴' : '🟢';
        const statusText = isDown ? 'DOWN' : 'RECOVERED';
        const msg = `${emoji} <b>${statusText}</b> — ${endpoint.name}\n\n<b>URL:</b> ${endpoint.url}\n<b>Status Code:</b> ${result.status_code || 'N/A'}\n<b>Latency:</b> ${result.latency_ms}ms${result.error_msg ? `\n<b>Error:</b> ${result.error_msg}` : ''}`;
        await sendTelegram(telegram.bot_token, telegram.chat_id, msg);
      }
    }
  } catch (err) {
    console.error('[Telegram notification error]', err.message);
  }
}

export async function sendTestNotification(channel) {
  const cfg = getNotificationConfig(channel);
  if (!cfg) throw new Error(`Channel ${channel} not found`);

  if (channel === 'discord') {
    if (!cfg.webhook_url) throw new Error('Discord webhook URL not configured');
    await sendDiscord(cfg.webhook_url, {
      title: '✅ Test Notification',
      description: 'MW-Cron Monitor is working correctly!',
      color: 0x3B82F6,
      timestamp: new Date().toISOString(),
      footer: { text: 'MW-Cron Monitor' },
    });
  } else if (channel === 'telegram') {
    if (!cfg.bot_token || !cfg.chat_id) throw new Error('Telegram bot token or chat ID not configured');
    await sendTelegram(cfg.bot_token, cfg.chat_id, '✅ <b>Test Notification</b>\n\nMW-Cron Monitor is working correctly!');
  }
}

export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_STORAGE_CHAT_ID: string;
}

export function getTelegramEnv(): TelegramEnv {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_STORAGE_CHAT_ID;

  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing.");
  }

  if (!chatId) {
    throw new Error("TELEGRAM_STORAGE_CHAT_ID is missing.");
  }

  return {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_STORAGE_CHAT_ID: chatId,
  };
}
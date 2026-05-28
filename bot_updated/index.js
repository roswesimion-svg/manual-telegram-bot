/**
 * commands/index.js
 * Single entry point — registers all advert commands into the existing bot.
 *
 * Usage in your existing index.js:
 *
 *   const { registerAdvertFeature } = require("./commands/advert/index");
 *   registerAdvertFeature(bot, ADMIN_IDS, db);
 */

const { registerAdvertCommand }        = require("./advert");
const { registerPreviewAdvertCommand } = require("./previewAdvert");
const { registerSendAdvertCommand }    = require("./sendAdvert");
const { registerEditAdvertCommand }    = require("./editAdvert");

/**
 * Register all advert-related commands.
 * Call this ONCE after your bot is initialized.
 *
 * @param {TelegramBot} bot        — your existing bot instance
 * @param {string[]}    ADMIN_IDS  — array of admin chat ID strings
 * @param {object}      db         — your existing db module (needs getAllUsers)
 */
function registerAdvertFeature(bot, ADMIN_IDS, db) {
  registerAdvertCommand(bot, ADMIN_IDS);
  registerPreviewAdvertCommand(bot, ADMIN_IDS);
  registerSendAdvertCommand(bot, ADMIN_IDS, db);
  registerEditAdvertCommand(bot, ADMIN_IDS);

  console.log("✅ Advert feature registered: /advert /previewadvert /sendadvert /editadvert");
}

module.exports = { registerAdvertFeature };

const fs   = require("fs");
const path = require("path");

const ADVERT_FILE = path.join(__dirname, "../data/advert.json");

function loadAdvert() {
  try {
    if (fs.existsSync(ADVERT_FILE)) {
      return JSON.parse(fs.readFileSync(ADVERT_FILE, "utf8"));
    }
  } catch (e) {
    console.error("⚠️ Could not load advert.json:", e.message);
  }
  return { message: "🔥 Choose Your Category Below 🔥", link: "https://t.me/Naughty254Premiumbot", buttons: [] };
}

function saveAdvert(data) {
  try {
    fs.writeFileSync(ADVERT_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("⚠️ Could not save advert.json:", e.message);
    return false;
  }
}

function buildAdvertKeyboard(advertData) {
  const { buttons, link } = advertData;
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = [{ text: buttons[i].text, url: link }];
    if (buttons[i + 1]) row.push({ text: buttons[i + 1].text, url: link });
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

function getNextId(advertData) {
  if (!advertData.buttons.length) return 1;
  return Math.max(...advertData.buttons.map(b => b.id)) + 1;
}

module.exports = { loadAdvert, saveAdvert, buildAdvertKeyboard, getNextId };

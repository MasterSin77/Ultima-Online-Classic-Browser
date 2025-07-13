// === CONFIGURATION ===
const OUTPUT_TO_CONSOLE = true;
const BANDAGE_GRAPHIC = 0xE21;
const MIN_MANA_FOR_SPELLS = 10;
const BANDAGE_COOLDOWN_TIME = 8000;
const POST_COMBAT_GRACE = 100; // 0.5s
const CONSECRATE_INTERVAL_MS = 10000;

let clHeal_lastActionTime = Date.now();
let clHeal_lastBandageTime = 0;
let clHeal_lastPoisonCureTime = 0;
let clHeal_lastCombatTime = Date.now();
let clHeal_lastTargetTime = Date.now();
let clHeal_lastConsecrateTime = 0;

// === BUFF IDS ===
const CLHEAL_CURSE_IDS = [1043, 1044, 1007, 1040, 1041, 1042, 1088];
const CLHEAL_COMBAT_DEBUFF_IDS = [
  1038, 1039, 1155, 1161, 1164, 1165, 1168, 1185, 1189,
  1115, 1116, 1110, 1109, 1049, 1019, 1131, 1123, 1072, 1071, 1064, 1063
];

// === HELPERS ===
function clHeal_log(msg, color = 66) {
  if (OUTPUT_TO_CONSOLE) console.log(msg);
  else client.headMsg(msg, player.serial, color);
}

function clHeal_findItemRecursive(container, graphic) {
  const contents = container?.contents || [];
  for (const item of contents) {
    if (item.graphic === graphic && item.amount > 0) return item;
    if (item.contents && item.contents.length > 0) {
      const found = clHeal_findItemRecursive(item, graphic);
      if (found) return found;
    }
  }
  return undefined;
}

function clHeal_findBandage() {
  return clHeal_findItemRecursive(player.backpack, BANDAGE_GRAPHIC);
}

function clHeal_cooldownPassed(ms, since) {
  return Date.now() - since >= ms;
}

function clHeal_hasAnyCurse() {
  return CLHEAL_CURSE_IDS.some(id => player.hasBuffDebuff(id));
}

function clHeal_countCurses() {
  return CLHEAL_CURSE_IDS.filter(id => player.hasBuffDebuff(id)).length;
}

function clHeal_countCombatDebuffs() {
  return CLHEAL_COMBAT_DEBUFF_IDS.filter(id => player.hasBuffDebuff(id)).length;
}

function clHeal_hasLiveTarget() {
  return target.last && target.last instanceof Mobile && !target.last.isDead;
}

function clHeal_healthBelow(percent) {
  return (player.hits / player.maxHits) * 100 < percent;
}

function clHeal_healthAbove(percent) {
  return (player.hits / player.maxHits) * 100 >= percent;
}

// === ACTIONS ===
function clHeal_tryRemoveCurse() {
  if (!clHeal_hasAnyCurse()) return false;
  if (!clHeal_cooldownPassed(5000, clHeal_lastActionTime)) return false;
  if (player.mana < MIN_MANA_FOR_SPELLS) return false;

  clHeal_log("🗿 Remove Curse", 68);
  player.cast(Spells.RemoveCurse);
  target.waitTargetSelf();
  target.self();
  clHeal_lastActionTime = Date.now();
  return true;
}

function clHeal_tryCleansePoison() {
  if (!player.isPoisoned || !clHeal_cooldownPassed(5000, clHeal_lastPoisonCureTime)) return false;
  if (player.mana < MIN_MANA_FOR_SPELLS) return false;

  clHeal_log("🧪 Poison detected!", 66);
  player.cast(Spells.CleanseByFire);
  target.waitTargetSelf();
  target.self();
  clHeal_lastPoisonCureTime = Date.now();
  clHeal_lastCombatTime = Date.now();
  return true;
}

function clHeal_tryBandage() {
  const bandage = clHeal_findBandage();
  const needHealing = player.hits < player.maxHits;
  const healthLow = clHeal_healthBelow(99); // 🔄 Updated from 90% to 99%

  if (needHealing && healthLow && clHeal_cooldownPassed(BANDAGE_COOLDOWN_TIME, clHeal_lastBandageTime) && bandage) {
    clHeal_log(`🩹 Bandaging at ${player.hits}/${player.maxHits}`, 66);
    player.use(bandage);
    target.waitTargetSelf();
    target.self();
    clHeal_lastBandageTime = Date.now();
    clHeal_lastCombatTime = Date.now();
    return true;
  }

  return false;
}

function clHeal_tryConsecrateWeapon() {
  if (!clHeal_cooldownPassed(CONSECRATE_INTERVAL_MS, clHeal_lastConsecrateTime)) return false;
  if (clHeal_hasAnyCurse()) return false;
  if (!clHeal_healthAbove(90)) return false;
  if (player.mana < MIN_MANA_FOR_SPELLS) return false;

  clHeal_log("⚔️ Consecrate Weapon", 66);
  player.cast(Spells.ConsecrateWeapon);
  clHeal_lastConsecrateTime = Date.now();
  return true;
}

function clHeal_postCombatCleanup() {
  const totalDebuffs = clHeal_countCurses() + clHeal_countCombatDebuffs();
  const canClean = player.mana && (clHeal_cooldownPassed(5000, clHeal_lastActionTime) || (totalDebuffs > 1 && clHeal_healthAbove(50)));

  if (!canClean) return false;

  if (player.isPoisoned) {
    clHeal_log("🧹 Post-combat: Cleansing Poison");
    return clHeal_tryCleansePoison();
  }

  if (clHeal_hasAnyCurse()) {
    clHeal_log("🧹 Post-combat: Removing Curse");
    return clHeal_tryRemoveCurse();
  }

  return false;
}

// === INIT BANDAGE CHECK ===
const clHeal_initialBandage = clHeal_findBandage();
if (!clHeal_initialBandage) {
  clHeal_log("❌ No bandages found (including containers)!", 33);
  exit();
} else {
  clHeal_log(`🩹 Bandages found: ${clHeal_initialBandage.amount}`, 66);
}

// === MAIN LOOP ===
clHeal_log("🌀 CLHeal script active...", 66);

while (true) {
  if (clHeal_hasLiveTarget()) clHeal_lastTargetTime = Date.now();

  if (clHeal_tryRemoveCurse()) continue;
  if (clHeal_tryCleansePoison()) continue;
  if (clHeal_tryBandage()) continue;
  if (clHeal_tryConsecrateWeapon()) continue;

  if (Date.now() - clHeal_lastTargetTime >= POST_COMBAT_GRACE) {
    clHeal_postCombatCleanup();
  }

  sleep(300);
}

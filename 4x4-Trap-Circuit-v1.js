(function () {
  // === CONFIGURATION ===
  const trapBoxSerial = 0x784ED9F8;
  const chatEcho = false;

  const config = {
    maxPathLength: 12,
    removeTrapCooldownMs: 10000,
    gumpWaitTimeoutMs: 3000,
    journalStepTimeoutMs: 1000,
    finalResultTimeoutMs: 5000,
    delayAfterTargetMs: 1000,
    delayBetweenStepsMs: 100,
    delayAfterFailedPathMs: 2500,
    maxSkillCursorAttempts: 20,
    delayedWinGraceMs: 1500
  };

  const directionButtons = { up: 1, right: 2, down: 3, left: 4 };
  const preferredDirections = [3, 2, 1, 4]; // Down > Right > Up > Left
  const deltas = {
    1: [0, -1],
    2: [1, 0],
    3: [0, 1],
    4: [-1, 0]
  };

  let successfulPath: number[] = [];
  let attemptedPaths = new Set<string>();
  let failedSteps = new Set<string>();
  let unsolvableCount = 0;
  let lastSkillUseTime = 0;
  let solveStartTime = 0;
  let lastSolvedKey = "";

  function log(msg: string) {
    console.log(msg);
    if (chatEcho) player.say(msg);
  }

  function resetState() {
    attemptedPaths.clear();
    failedSteps.clear();
    successfulPath = [];
    log("♻️ Resetting state for new puzzle.");
  }

  function* generateValidPaths(
    maxLength: number,
    path: number[] = [],
    pos: [number, number] = [0, 0],
    visited: Set<string> = new Set(["0,0"])
  ): Generator<number[]> {
    if (pos[0] === 3 && pos[1] === 3) {
      yield path;
      return;
    }
    if (path.length >= maxLength) return;

    for (const dir of preferredDirections) {
      const [dx, dy] = deltas[dir];
      const [x, y] = pos;
      const newX = x + dx;
      const newY = y + dy;
      if (newX < 0 || newX > 3 || newY < 0 || newY > 3) continue;

      const key = `${newX},${newY}`;
      const newPath = [...path, dir];

      let shouldSkip = false;
      for (let i = 1; i <= newPath.length; i++) {
        const prefix = newPath.slice(0, i).join("-");
        if (failedSteps.has(prefix)) {
          shouldSkip = true;
          break;
        }
      }

      if (visited.has(key) || shouldSkip) continue;

      visited.add(key);
      yield* generateValidPaths(maxLength, newPath, [newX, newY], visited);
      visited.delete(key);
    }
  }

  function openGumpWithRemoveTrap(): any {
    journal.clear();

    const now = Date.now();
    const waitTime = config.removeTrapCooldownMs - (now - lastSkillUseTime);
    if (waitTime > 0) {
      log(`⏱ Waiting ${waitTime}ms for cooldown...`);
      sleep(waitTime);
    }

    let cursorReady = false;
    let attempts = 0;

    while (!cursorReady && attempts < config.maxSkillCursorAttempts) {
      player.useSkill(Skills.RemoveTrap);
      lastSkillUseTime = Date.now();
      cursorReady = target.wait(1000);
      attempts++;
      if (!cursorReady) sleep(500);
    }

    if (!cursorReady) {
      log("⚠️ Timed out waiting for Remove Trap cursor.");
      return null;
    }

    target.entity(trapBoxSerial);
    sleep(config.delayAfterTargetMs);

    const gump = Gump.findOrWait("Trap Disarm Mechanism", config.gumpWaitTimeoutMs);
    if (!gump || !gump.exists) {
      log("❌ Gump not found after targeting.");
      return null;
    }

    log("✅ Gump opened.");
    return gump;
  }

  function tryPath(path: number[]): boolean {
    log("➡️ Trying path: " + JSON.stringify(path));
    solveStartTime = Date.now();

    const gump = openGumpWithRemoveTrap();
    if (!gump || !gump.exists) return false;

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const subPath = path.slice(0, i + 1);

      if (!gump.exists) {
        if (i === path.length - 1) {
          log("📦 Gump closed after last button — awaiting possible win message.");
          const delayed = journal.waitForTextAny(
            ["You successfully disarm the trap!", "You fail to disarm the trap"],
            null,
            config.delayedWinGraceMs
          );
          if (delayed?.includes("successfully")) {
            return logSolvedPath(path);
          } else {
            log("⚠️ No delayed journal win message. Assuming fail.");
            return false;
          }
        } else {
          log("💥 Gump closed mid-path unexpectedly.");
          const failed = subPath.join("-");
          log(`🛑 Blacklisting failed path: ${failed}`);
          failedSteps.add(failed);
          return false;
        }
      }

      if (!gump.hasButton(step)) {
        log(`❌ Button ${step} not found. Assuming puzzle reset.`);
        attemptedPaths.clear();
        successfulPath = [];
        log("♻️ Soft reset — preserving failed subpaths.");
        return false;
      }

      gump.reply(step);
      log(`🔘 Pressed button ${step}`);
      sleep(config.delayBetweenStepsMs);

      const failText = journal.waitForText(
        "You fail to disarm the trap and reset it.",
        null,
        config.journalStepTimeoutMs
      );
      if (failText && gump.exists) {
        const failed = subPath.join("-");
        log(`❌ Failed at step ${i + 1}. Blacklisting: ${failed}`);
        failedSteps.add(failed);
        return false;
      }
    }

    const result = journal.waitForTextAny(
      ["You successfully disarm the trap!", "You fail to disarm the trap"],
      null,
      config.finalResultTimeoutMs
    );

    if (result?.includes("successfully")) {
      return logSolvedPath(path);
    }

    log("🔁 Final step failed — no success message.");
    return false;
  }

  function logSolvedPath(path: number[]): boolean {
    const raw = path.join("-");
    if (raw === lastSolvedKey) {
      log("🛑 Duplicate solution detected. Skipping repeated solve.");
      return false;
    }

    lastSolvedKey = raw;
    const directionNames = path.map(id =>
      Object.keys(directionButtons).find(k => directionButtons[k] === id)
    );
    const readable = directionNames.join(" → ");
    const solveEndTime = Date.now();
    const seconds = ((solveEndTime - solveStartTime) / 1000).toFixed(1);

    log("🏆 Puzzle solved!");
    log("🧩 Final path (button IDs): " + raw);
    log("🧭 Final path (directions): " + readable);
    log(`⏲️ Time to solve: ${seconds} seconds`);
    player.say(`Remove Trap Solved: ${raw} in ${seconds}s`);

    resetState();
    return true;
  }

  // === MAIN LOOP ===
  while (true) {
    log("🧲 Starting Remove Trap Solver cycle...");

    attemptedPaths.clear();
    const pathList: number[][] = Array.from(generateValidPaths(config.maxPathLength));

    for (const path of pathList) {
      const key = path.join("-");
      if (attemptedPaths.has(key)) continue;

      let shouldSkip = false;
      for (let i = 1; i <= path.length; i++) {
        const prefix = path.slice(0, i).join("-");
        if (failedSteps.has(prefix)) {
          shouldSkip = true;
          break;
        }
      }

      if (shouldSkip) continue;

      attemptedPaths.add(key);
      const result = tryPath(path);

      if (result) {
        successfulPath = path;
        log("✅ Path solved: " + JSON.stringify(path));
        break;
      }

      sleep(config.delayAfterFailedPathMs);
    }

    if (successfulPath.length > 0) {
      log("✔️ Full solution path: " + JSON.stringify(successfulPath));
      unsolvableCount = 0;
    } else {
      unsolvableCount++;
      log(`⚠️ No solution found — puzzle may have reset. Restarting fresh. (Fail streak: ${unsolvableCount})`);
      resetState();
    }

    log(`⏳ Cooling down for ${config.removeTrapCooldownMs}ms`);
    sleep(config.removeTrapCooldownMs);
  }
})();

const GlorbuSEGM = (() => {
  let config = {
    eventType: "",
    eventPeriod: "",
    goalAmount: 0,
    progress: 0,
    baseGoal: 0,
    goalReached: false,
    goalReachedAction: "stop",
    goalIncreaseAmount: 0,
    eventCurrency: "",
    resubs: false,
    roles: ["broadcaster", "mod"],
    debug: true
  };

  const log = (...args) => {
    if (!config.debug) return;
    console.log("%c🟣 [GlorbuSEGM]", "color:#b76fff;font-weight:bold", ...args);
  };

  const Glorbu = {
    init(settings = {}) {
      config = { ...config, ...settings };
      log("Initialized", config);
      return config;
    },

    async onWidgetLoad(payload) {
      const data = payload.detail || {};
      const fields = data.fieldData || {};
      const session = data.session?.data || {};

      config.eventType = fields.eventType || config.eventType;
      config.eventPeriod = fields.eventPeriod || config.eventPeriod;
      config.goalAmount = Number(fields.goal || config.goalAmount);
      config.baseGoal = config.goalAmount;
      config.goalReachedAction = fields.goalReachedAction || "stop";
      config.goalIncreaseAmount = Number(fields.goalIncreaseAmount || 0);
      config.eventCurrency = fields.currency || "";
      config.resubs = fields.resubs ?? config.resubs;
      config.roles = (fields.roles || "broadcaster, mod").split(",").map(r => r.trim().toLowerCase());

      const index = `${config.eventType}-${config.eventPeriod}`;
      const sessionData = session[index];

      if (config.eventPeriod === "custom") {
        await Glorbu._load(config.eventType);
      } else {
        if (["tip", "cheer", "goal"].includes(config.eventType)) {
          config.progress = sessionData?.amount || 0;
        } else if (["follower", "subscriber"].includes(config.eventType)) {
          config.progress = sessionData?.count || 0;
        }
      }

      log("WidgetLoad complete", config);
      return { updated: true, progress: config.progress, goal: config.goalAmount };
    },

    async _load(type) {
      const key = `goalData_${type}`;
      try {
        const data = await SE_API.store.get(key);
        if (data && Object.keys(data).length > 0) {
          if (typeof data.goalAmount === "number") config.goalAmount = data.goalAmount;
          if (typeof data.progress === "number") config.progress = data.progress;
          log("Loaded save", data);
        } else {
          await Glorbu._save();
        }
      } catch {
        await Glorbu._save();
      }
    },

    async _save() {
      const key = `goalData_${config.eventType}`;
      const saveData = { goalAmount: config.goalAmount, progress: config.progress };
      await SE_API.store.set(key, saveData);
      log("Saved", saveData);
    },

    goalUpdate(value) {
      config.progress = Math.max(0, Math.min(config.goalAmount, value));
      const percent = Math.min((config.progress / config.goalAmount) * 100, 100);
      log("Goal updated", { progress: config.progress, goal: config.goalAmount, percent });
      return { updated: true, progress: config.progress, goal: config.goalAmount, percent };
    },

    async onEvent(payload) {
      const listener = payload.detail?.listener;
      const data = payload.detail?.event;
      if (listener === "kvstore:update") return { updated: false, reason: "ignored kvstore" };
      log("Event received", listener, data);

      const amount = Number(data.amount) || 0;
      const gift = data["bulkGifted"];
      let changed = false;
      let increment = 0;

      if (listener === "tip-latest" && config.eventType === "tip") {
        config.progress += amount; increment = amount; changed = true;
      } else if (listener === "cheer-latest" && config.eventType === "cheer") {
        config.progress += amount; increment = amount; changed = true;
      } else if (listener === "follower-latest" && config.eventType === "follower") {
        config.progress++; increment = 1; changed = true;
      } else if (listener === "subscriber-latest" && config.eventType === "subscriber") {
        const isResub = data.amount > 1 || data.cumulativeMonths > 1;
        if (!config.resubs && isResub && gift !== true) return { updated: false, reason: "resub ignored" };
        if (gift === undefined) { config.progress++; increment = 1; changed = true; }
      }

      if (listener === "message") {
        const message = data.renderedText?.trim() || "";
        if (!message.toLowerCase().startsWith(config.baseCommand)) return { updated: false, reason: "not command" };

        const args = message.slice(config.baseCommand.length).trim().split(/\s+/);
        const command = args.shift()?.toLowerCase() || "";
        const messageData = data.data || {};
        let role = "viewer";

        if (messageData.badges && Array.isArray(messageData.badges)) {
          const badges = messageData.badges.map(b => b.type);
          if (badges.includes("broadcaster")) role = "broadcaster";
          else if (badges.includes("mod")) role = "mod";
          else if (badges.includes("vip")) role = "vip";
          else if (badges.includes("subscriber") || badges.includes("founder")) role = "subscriber";
        } else if (messageData.tags && messageData.tags["badges"]) {
          const badges = messageData.tags["badges"].split(",").map(b => b.split("/")[0]);
          if (badges.includes("broadcaster")) role = "broadcaster";
          else if (badges.includes("mod")) role = "mod";
          else if (badges.includes("vip")) role = "vip";
          else if (badges.includes("subscriber") || badges.includes("founder")) role = "subscriber";
        }

        if (!config.roles.includes(role)) return { updated: false, reason: "unauthorized" };

        if (command === "add") {
          const v = Number(args[0]); if (!isNaN(v)) { config.progress += v; increment = v; changed = true; }
        }
        if (command === "set") {
          const v = Number(args[0]); if (!isNaN(v)) { config.progress = v; increment = 0; changed = true; }
        }
        if (command === "goal") {
          const v = Number(args[0]); if (!isNaN(v)) { config.goalAmount = v; increment = 0; changed = true; }
        }
        if (command === "reset") {
          config.progress = 0; increment = 0; changed = true;
        }

        log("Command executed", { command, progress: config.progress });
      }

      if (changed) {
        const percent = Math.min((config.progress / config.goalAmount) * 100, 100);
        if (config.eventPeriod === "custom") await Glorbu._save();
        log("Progress changed", { progress: config.progress, goal: config.goalAmount, percent });
        return { updated: true, progress: config.progress, goal: config.goalAmount, increment };
      }

      return { updated: false, reason: "no change" };
    }
  };

  return Glorbu;
})();

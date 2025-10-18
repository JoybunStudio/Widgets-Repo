const GlorbuSEGM = {
  config: {
    eventType: "",
    eventPeriod: "",
    goalAmount: 0,
    progress: 0,
    goalIncreaseAmount: 0,
    goalReachedAction: "stop",
    resubs: false,
    debug: false,
    multiGoals: false
  },
  goals: {},
  onGoalUpdate: null,
  onGoalReached: null,
  onGoalSaved: null,
  init(settings = {}) {
    Object.assign(this.config, settings)
    if (this.config.multiGoals) this.goals = {}
    this._log("🧩 Init", this.config)
  },
  async onWidgetLoad(payload) {
    const { eventType, eventPeriod, multiGoals } = this.config
    const session = payload.detail?.session?.data || {}
    const type = eventType
    if (multiGoals) {
      if (!this.goals[type]) this.goals[type] = { progress: 0, goal: this.config.goalAmount, reached: false }
    }
    if (eventPeriod === "custom") {
      await this._load(type)
    } else {
      const index = `${type}-${eventPeriod}`
      const data = session[index]
      let progress = 0
      if (["tip", "cheer", "goal"].includes(type)) progress = data?.amount || 0
      else if (["subscriber", "follower"].includes(type)) progress = data?.count || 0
      this._setProgressInternal(progress, type)
    }
    const state = this.getState(type)
    this._log("📦 Load complete", state)
    return { updated: true, ...state }
  },
  async onEvent(payload) {
    const { eventType, eventPeriod, resubs, multiGoals } = this.config
    const listener = payload.detail.listener
    const data = payload.detail.event
    const type = eventType
    if (multiGoals && !this.goals[type]) this.goals[type] = { progress: 0, goal: this.config.goalAmount, reached: false }
    if (listener === "kvstore:update") return { updated: false, reason: "kvstore skip" }
    let changed = false
    const amount = Number(data.amount) || 0
    const gift = data["bulkGifted"]
    if (listener === "tip-latest" && type === "tip") {
      this._incProgress(amount, type)
      changed = true
    } else if (listener === "cheer-latest" && type === "cheer") {
      this._incProgress(amount, type)
      changed = true
    } else if (listener === "follower-latest" && type === "follower") {
      this._incProgress(1, type)
      changed = true
    } else if (listener === "subscriber-latest" && type === "subscriber") {
      const isResub = data.amount > 1 || data.cumulativeMonths > 1
      if (!resubs && isResub && gift !== true) return { updated: false, reason: "resub skipped" }
      if (gift === undefined) {
        this._incProgress(1, type)
        changed = true
      }
    }
    if (!changed) return { updated: false, reason: "no event match" }
    if (eventPeriod === "custom") await this._save(type)
    const state = this.getState(type)
    if (this.onGoalUpdate) this.onGoalUpdate(state)
    if (state.goalReached && this.onGoalReached) this.onGoalReached(state)
    this._log("📈 Event processed", state)
    return { updated: true, ...state }
  },
  getState(type = null) {
    if (this.config.multiGoals && type) {
      const g = this.goals[type]
      const percent = Math.min((g.progress / g.goal) * 100, 100)
      return { progress: g.progress, goal: g.goal, percent, goalReached: g.reached }
    }
    const percent = Math.min((this.config.progress / this.config.goalAmount) * 100, 100)
    return { progress: this.config.progress, goal: this.config.goalAmount, percent, goalReached: this.config.goalReached }
  },
  async setGoal(value, type = null) {
    if (this.config.multiGoals && type) this.goals[type].goal = value
    else this.config.goalAmount = value
    if (this.config.eventPeriod === "custom") await this._save(type)
    const state = this.getState(type)
    if (this.onGoalUpdate) this.onGoalUpdate(state)
    this._log("🎯 Goal set", state)
    return { updated: true, ...state }
  },
  async setProgress(value, type = null) {
    if (this.config.multiGoals && type) this.goals[type].progress = value
    else this.config.progress = value
    if (this.config.eventPeriod === "custom") await this._save(type)
    const state = this.getState(type)
    if (this.onGoalUpdate) this.onGoalUpdate(state)
    this._log("📊 Progress set", state)
    return { updated: true, ...state }
  },
  async reset(type = null) {
    if (this.config.multiGoals && type) this.goals[type].progress = 0
    else this.config.progress = 0
    if (this.config.eventPeriod === "custom") await this._save(type)
    const state = this.getState(type)
    if (this.onGoalUpdate) this.onGoalUpdate(state)
    this._log("🔄 Reset", state)
    return { updated: true, ...state }
  },
  _incProgress(val, type = null) {
    if (this.config.multiGoals && type) this.goals[type].progress += val
    else this.config.progress += val
    this._checkGoal(type)
  },
  _setProgressInternal(val, type = null) {
    if (this.config.multiGoals && type) this.goals[type].progress = val
    else this.config.progress = val
    this._checkGoal(type)
  },
  _checkGoal(type = null) {
    if (this.config.multiGoals && type) {
      const g = this.goals[type]
      if (g.progress >= g.goal && !g.reached) {
        g.reached = true
        this._applyGoalAction(type)
      }
    } else {
      if (this.config.progress >= this.config.goalAmount && !this.config.goalReached) {
        this.config.goalReached = true
        this._applyGoalAction()
      }
    }
  },
  async _applyGoalAction(type = null) {
    const action = this.config.goalReachedAction
    if (this.config.multiGoals && type) {
      const g = this.goals[type]
      if (action === "reset") g.progress = 0
      else if (action === "increase") g.goal += this.config.goalIncreaseAmount
      else if (action === "stop") {}
      g.reached = false
      if (this.config.eventPeriod === "custom") await this._save(type)
      if (this.onGoalReached) this.onGoalReached(this.getState(type))
    } else {
      if (action === "reset") this.config.progress = 0
      else if (action === "increase") this.config.goalAmount += this.config.goalIncreaseAmount
      else if (action === "stop") {}
      this.config.goalReached = false
      if (this.config.eventPeriod === "custom") await this._save()
      if (this.onGoalReached) this.onGoalReached(this.getState())
    }
  },
  async _save(type = null) {
    const key = this.config.multiGoals && type ? `goalData_${type}` : `goalData_${this.config.eventType}`
    const data = this.config.multiGoals && type
      ? { goalAmount: this.goals[type].goal, progress: this.goals[type].progress }
      : { goalAmount: this.config.goalAmount, progress: this.config.progress }
    try {
      await SE_API.store.set(key, data)
      if (this.onGoalSaved) this.onGoalSaved({ ...data, key })
      this._log("💾 Saved", data)
    } catch (e) {
      this._log("❌ Save error", e)
    }
  },
  async _load(type = null) {
    const key = this.config.multiGoals && type ? `goalData_${type}` : `goalData_${this.config.eventType}`
    try {
      const data = await SE_API.store.get(key)
      if (data && Object.keys(data).length > 0) {
        if (this.config.multiGoals && type) {
          this.goals[type].goal = data.goalAmount
          this.goals[type].progress = data.progress
        } else {
          this.config.goalAmount = data.goalAmount
          this.config.progress = data.progress
        }
        this._log("📥 Loaded", data)
      } else await this._save(type)
    } catch {
      await this._save(type)
    }
  },
  _log(label, data) {
    if (!this.config.debug) return
    console.log(`%c${label}`, "color:#9A6BFF;font-weight:bold;", data)
  }
}

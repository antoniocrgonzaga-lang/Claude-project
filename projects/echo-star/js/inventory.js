/**
 * Player / colony resource stockpile.
 * Phase 2+ (buildings) will use canAfford() / spend() for costs.
 */
export const RESOURCE_KEYS = ['crystals', 'iron', 'rock', 'food', 'energy', 'compute'];

export const RESOURCE_LABELS = {
  crystals: 'Crystals', iron: 'Iron', rock: 'Rock', food: 'Food', energy: 'Energy', compute: 'Compute',
};

export class Inventory {
  constructor(start) {
    this.items = {};
    this.reset(start);
  }

  reset(start = {}) {
    for (const k of RESOURCE_KEYS) this.items[k] = start[k] ?? 0;
  }

  get(key) { return this.items[key] ?? 0; }

  add(key, amount) {
    this.items[key] = Math.max(0, this.get(key) + amount);
  }

  /** cost: { iron: 10, rock: 5, … } */
  canAfford(cost) {
    return Object.entries(cost).every(([k, v]) => this.get(k) >= v);
  }

  spend(cost) {
    if (!this.canAfford(cost)) return false;
    for (const [k, v] of Object.entries(cost)) this.items[k] -= v;
    return true;
  }

  toJSON() { return { ...this.items }; }
  fromJSON(data) { this.reset(data || {}); }
}

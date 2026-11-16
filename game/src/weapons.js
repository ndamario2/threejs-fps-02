// Weapons: three guns plus a frag. Damage, spread and recoil are tuned so standing still
// and tapping wins over spraying on the move; a rifle headshot drops a full-health agent.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, auto: false, rpm: 340,
    mag: 12, reserveMax: 48, reload: 1.1, damage: 26, headMult: 2.5,
    spread: 0.006, moveSpread: 0.02, recoil: 0.006, range: 60,
  },
  smg: {
    id: 'smg', name: 'Rattler SMG', price: 1500, auto: true, rpm: 720,
    mag: 28, reserveMax: 84, reload: 1.6, damage: 24, headMult: 2.5,
    spread: 0.011, moveSpread: 0.026, recoil: 0.008, range: 55,
  },
  rifle: {
    id: 'rifle', name: 'Longshot Rifle', price: 2700, auto: true, rpm: 600,
    mag: 30, reserveMax: 90, reload: 1.9, damage: 34, headMult: 3,
    spread: 0.004, moveSpread: 0.028, recoil: 0.012, range: 80,
  },
};
export const FRAG_PRICE = 300;
export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.5; // half of incoming damage goes to armour first

export function createLoadout() {
  const owned = { pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserveMax } };
  const loadout = {
    current: 'pistol',
    frags: 0,
    armor: 0,
    cooldown: 0,
    reloading: 0,
    shotsFired: 0, // consecutive shots since last pause; drives bloom
    bloom: 0,
  };

  function def() {
    return WEAPONS[loadout.current];
  }

  function buy(id, money) {
    const weapon = WEAPONS[id];
    if (!weapon || owned[id] || money < weapon.price) return -1;
    owned[id] = { mag: weapon.mag, reserve: weapon.reserveMax };
    return weapon.price;
  }

  function switchTo(id) {
    if (!owned[id] || loadout.reloading > 0) return false;
    loadout.current = id;
    loadout.bloom = 0;
    return true;
  }

  function ready() {
    return loadout.cooldown <= 0 && loadout.reloading <= 0;
  }

  function takeRound() {
    const ammo = owned[loadout.current];
    if (ammo.mag <= 0) return false;
    ammo.mag -= 1;
    loadout.cooldown = 60 / def().rpm;
    loadout.shotsFired += 1;
    return true;
  }

  function reload() {
    const ammo = owned[loadout.current];
    const weapon = def();
    if (loadout.reloading > 0 || ammo.mag === weapon.mag || ammo.reserve <= 0) return false;
    loadout.reloading = weapon.reload;
    return true;
  }

  function refill() {
    for (const [id, ammo] of Object.entries(owned)) {
      ammo.mag = WEAPONS[id].mag;
      ammo.reserve = WEAPONS[id].reserveMax;
    }
    loadout.reloading = 0;
    loadout.cooldown = 0;
    loadout.bloom = 0;
    loadout.shotsFired = 0;
  }

  function resetOnDeath() {
    for (const id of Object.keys(owned)) if (id !== 'pistol') delete owned[id];
    loadout.current = 'pistol';
    loadout.frags = 0;
    loadout.armor = 0;
    refill();
  }

  // Spread grows with movement, airtime and sustained fire, and recovers when the
  // trigger is released. Returns radians of half-angle.
  function spreadFor(speed, airborne) {
    const weapon = def();
    const move = Math.min(1, speed / 5.2);
    const bloom = Math.min(1, loadout.shotsFired / 8) * 0.012;
    return weapon.spread + weapon.moveSpread * move + (airborne ? 0.02 : 0) + bloom;
  }

  function step(dt) {
    loadout.cooldown = Math.max(0, loadout.cooldown - dt);
    if (loadout.reloading > 0) {
      loadout.reloading -= dt;
      if (loadout.reloading <= 0) {
        loadout.reloading = 0;
        const ammo = owned[loadout.current];
        const weapon = def();
        const need = weapon.mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
    }
    // Bloom decays fast once the trigger is off; firing resets the decay timer via cooldown.
    if (loadout.cooldown <= 0) loadout.shotsFired = Math.max(0, loadout.shotsFired - dt * 14);
  }

  return {
    loadout, owned, def, buy, switchTo, ready, takeRound, reload, refill, resetOnDeath,
    spreadFor, step,
    ammo() { return owned[loadout.current]; },
    has(id) { return Boolean(owned[id]); },
  };
}

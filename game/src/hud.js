// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, team scores, kill feed,
// plant/defuse channel bar, buy menu and the one overlay panel. It never touches the
// simulation; main.js pushes numbers in and reads buy/play callbacks out.
const COPY = {
  start: {
    title: 'DUSTLINE',
    copy: 'A freight yard at dusk. Plant the spike at Silo or Depot — or stop the Sentinels from holding both. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  dead: {
    title: 'You are down',
    copy: 'Your squad fights on. Watch them — the round is not over yet.',
    action: 'Keep watching',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammo = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armorRow = $('armor-row');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const roundValue = $('round-value');
  const scoreAtk = $('score-atk');
  const scoreDef = $('score-def');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const channel = $('channel');
  const channelLabel = $('channel-label');
  const channelFill = $('channel-fill');
  const spikeStatus = $('spike-status');
  const fragsValue = $('frags-value');
  const buyPanel = $('buy');
  const buyMoney = $('buy-money');
  const hitmarker = $('hitmarker');
  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';

  function formatTime(seconds) {
    const total = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  return {
    setAmmo(mag, reserve, name) {
      if (mag === lastMag && reserve === lastReserve && name === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = name;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(hp, armor) {
      const rounded = Math.max(0, Math.ceil(hp));
      if (rounded === lastHealth && armor === lastArmor) return;
      lastHealth = rounded;
      lastArmor = armor;
      healthFill.style.width = `${rounded}%`;
      healthFill.classList.toggle('low', rounded <= 30);
      healthValue.textContent = String(rounded);
      armorRow.style.display = armor > 0 ? 'flex' : 'none';
      armorValue.textContent = String(Math.ceil(armor));
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setFrags(count) {
      fragsValue.textContent = `Frag ×${count}`;
    },
    setTimer(seconds, planted, fuseLeft) {
      const text = planted ? `FUSE ${formatTime(fuseLeft)}` : formatTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('planted', planted);
    },
    setScore(atk, def, round) {
      const text = `${atk}|${def}|${round}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreAtk.textContent = String(atk);
      scoreDef.textContent = String(def);
      roundValue.textContent = `ROUND ${round}`;
    },
    setSpike(status) {
      spikeStatus.textContent = status;
      spikeStatus.classList.toggle('warn', status.includes('PLANTED') || status.includes('dropped'));
    },
    killfeed(text, good) {
      const entry = document.createElement('div');
      entry.className = 'feed-entry';
      entry.textContent = text;
      if (good) entry.classList.add('good');
      killfeed.prepend(entry);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => { if (entry.parentNode) entry.parentNode.removeChild(entry); }, 6000);
    },
    banner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText || '';
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    // Sticky banner for screenshot captures: never auto-hides.
    bannerSticky(titleText, subText) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText || '';
      clearTimeout(bannerTimer);
      banner.classList.add('on');
    },
    hideBanner() {
      banner.classList.remove('on');
      clearTimeout(bannerTimer);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    channel(label, progress) {
      channel.hidden = false;
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hideChannel() {
      channel.hidden = true;
    },
    showBuy(visible) {
      buyPanel.hidden = !visible;
    },
    refreshBuy(money, owned, frags) {
      for (const button of buyPanel.querySelectorAll('[data-buy]')) {
        const id = button.dataset.buy;
        const price = Number(button.dataset.price);
        const isOwned = id === 'frag' ? frags >= 2 : id === 'armor' ? false : Boolean(owned[id]);
        button.disabled = money < price || isOwned;
        button.querySelector('.buy-price').textContent = isOwned ? 'OWNED' : `$${price}`;
      }
    },
    showOverlay(mode, extra = '') {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'matchEnd' ? extra : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyPanel.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy]');
        if (!button || button.disabled) return;
        handler(button.dataset.buy);
      });
    },
  };
}

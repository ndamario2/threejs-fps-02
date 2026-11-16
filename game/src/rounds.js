// Rounds: the match state machine. Buy phase, live round, plant fuse, win conditions and
// money. The module owns the numbers; main.js owns the visuals and the bots.
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 35;
export const PLANT_SECONDS = 3.5;
export const DEFUSE_SECONDS = 5;
export const WIN_ROUNDS = 5;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;

export function createRounds(events) {
  const rounds = {
    phase: 'buy', // 'buy' | 'live' | 'ended' | 'matchEnd'
    phaseTime: BUY_SECONDS,
    round: 1,
    wins: { atk: 0, def: 0 },
    money: START_MONEY,
    plantedSite: null,
    plantedAt: null, // { x, z } where the spike went down
    fuseLeft: 0,
    lastReason: '',
  };

  function startBuy() {
    rounds.phase = 'buy';
    rounds.phaseTime = BUY_SECONDS;
    rounds.plantedSite = null;
    rounds.plantedAt = null;
    rounds.fuseLeft = 0;
    events.onBuyStart(rounds.round);
  }

  function startLive() {
    rounds.phase = 'live';
    rounds.phaseTime = ROUND_SECONDS;
    events.onLiveStart(rounds.round);
  }

  function endRound(winner, reason) {
    if (rounds.phase === 'ended' || rounds.phase === 'matchEnd') return;
    rounds.wins[winner] += 1;
    rounds.lastReason = reason;
    rounds.money += winner === 'atk' ? WIN_REWARD : LOSS_REWARD;
    rounds.phase = 'ended';
    rounds.phaseTime = 4.5;
    events.onRoundEnd(winner, reason, rounds.wins);
    if (rounds.wins[winner] >= WIN_ROUNDS) {
      rounds.phase = 'matchEnd';
      events.onMatchEnd(winner, rounds.wins);
    }
  }

  function plant(site, position) {
    rounds.plantedSite = site;
    rounds.plantedAt = { x: position.x, z: position.z };
    rounds.fuseLeft = FUSE_SECONDS;
    events.onPlant(site);
  }

  function tick(dt) {
    if (rounds.phase === 'buy') {
      rounds.phaseTime -= dt;
      if (rounds.phaseTime <= 0) startLive();
    } else if (rounds.phase === 'live') {
      if (rounds.plantedSite) {
        rounds.fuseLeft -= dt;
        if (rounds.fuseLeft <= 0) {
          endRound('atk', 'Spike detonated');
          return;
        }
      } else {
        rounds.phaseTime -= dt;
        if (rounds.phaseTime <= 0) endRound('def', 'Time expired — site held');
      }
    } else if (rounds.phase === 'ended') {
      rounds.phaseTime -= dt;
      if (rounds.phaseTime <= 0) {
        rounds.round += 1;
        events.onNextRound(rounds.round);
        startBuy();
      }
    }
  }

  return {
    rounds, startBuy, startLive, endRound, plant, tick,
    resetMatch() {
      rounds.phase = 'buy';
      rounds.phaseTime = BUY_SECONDS;
      rounds.round = 1;
      rounds.wins = { atk: 0, def: 0 };
      rounds.money = START_MONEY;
      rounds.plantedSite = null;
      rounds.plantedAt = null;
      rounds.fuseLeft = 0;
      rounds.lastReason = '';
    },
  };
}

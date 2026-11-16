// Input: pointer lock, mouse look deltas, held keys, firing state, and edge-triggered
// presses (buy menu, weapon slots, grenade). The game only reads input while locked.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    pressed: new Set(), // edge-triggered: consumed by the game each frame
    firing: false,
    locked: false,
    lookX: 0,
    lookY: 0,
  };

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    state.pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }

  function onKeyUp(event) {
    state.keys.delete(event.code);
  }

  function onMouseDown(event) {
    if (!state.locked) return;
    if (event.button === 0) {
      state.firing = true;
      state.pressed.add('MouseDown');
    }
  }

  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
  }

  function onMouseMove(event) {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  }

  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);
  window.addEventListener('blur', () => { state.keys.clear(); state.firing = false; });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    consumePressed(code) {
      if (!state.pressed.has(code)) return false;
      state.pressed.delete(code);
      return true;
    },
    clearPressed() {
      state.pressed.clear();
    },
  };
}

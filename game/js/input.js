const Input = {
  _down: new Set(),
  _pressed: new Set(),

  init() {
    window.addEventListener('keydown', e => {
      if (!this._down.has(e.code)) this._pressed.add(e.code);
      this._down.add(e.code);
      if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this._down.delete(e.code));
  },

  isDown(...codes) { return codes.some(c => this._down.has(c)); },
  pressed(...codes) { return codes.some(c => this._pressed.has(c)); },
  flush() { this._pressed.clear(); },
};

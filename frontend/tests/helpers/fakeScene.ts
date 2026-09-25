/**
 * A minimal stand-in for the slice of `Phaser.Scene` the entity renderers touch, so they can be
 * driven from vitest without booting Phaser (which needs WebGL/Canvas and a real browser).
 *
 * Only the members the renderers under test actually call are modelled; anything else is
 * absent on purpose so an unexpected dependency shows up as a TypeError in the test.
 */

export interface FakeSprite {
  x: number;
  y: number;
  texture: { key: string };
  active: boolean;
  visible: boolean;
  alpha: number;
  scaleX: number;
  scaleY: number;
  displayWidth: number;
  tint: number | null;
  setTexture(key: string): FakeSprite;
  setAlpha(a: number): FakeSprite;
  setScale(s: number): FakeSprite;
  setDisplaySize(w: number, h: number): FakeSprite;
  setPosition(x: number, y: number): FakeSprite;
  setDepth(d: number): FakeSprite;
  setVisible(v: boolean): FakeSprite;
  setTint(t: number): FakeSprite;
  stop(): FakeSprite;
  play(key: string): FakeSprite;
  destroy(): void;
}

export interface FakeTween {
  targets: unknown;
  config: Record<string, unknown>;
}

export function makeSprite(x: number, y: number, key: string): FakeSprite {
  const sprite: FakeSprite = {
    x,
    y,
    texture: { key },
    active: true,
    visible: true,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    displayWidth: 0,
    tint: null,
    setTexture(k) {
      sprite.texture = { key: k };
      return sprite;
    },
    setAlpha(a) {
      sprite.alpha = a;
      return sprite;
    },
    setScale(s) {
      sprite.scaleX = s;
      sprite.scaleY = s;
      return sprite;
    },
    setDisplaySize(w) {
      sprite.displayWidth = w;
      return sprite;
    },
    setPosition(px, py) {
      sprite.x = px;
      sprite.y = py;
      return sprite;
    },
    setDepth() {
      return sprite;
    },
    setVisible(v) {
      sprite.visible = v;
      return sprite;
    },
    setTint(t) {
      sprite.tint = t;
      return sprite;
    },
    stop() {
      return sprite;
    },
    play() {
      return sprite;
    },
    destroy() {
      sprite.active = false;
    },
  };
  return sprite;
}

export function makeGraphics() {
  const gfx = {
    active: true,
    x: 0,
    y: 0,
    calls: [] as string[],
    clear() {
      gfx.calls.push('clear');
      return gfx;
    },
    fillStyle() {
      return gfx;
    },
    fillRect() {
      gfx.calls.push('fillRect');
      return gfx;
    },
    lineStyle() {
      return gfx;
    },
    setDepth() {
      return gfx;
    },
    setPosition(x: number, y: number) {
      gfx.x = x;
      gfx.y = y;
      return gfx;
    },
    destroy() {
      gfx.active = false;
    },
  };
  return gfx;
}

export function makeText(x: number, y: number, text: string, style: object = {}) {
  const label = {
    x,
    y,
    text,
    style,
    active: true,
    setOrigin() {
      return label;
    },
    setDepth() {
      return label;
    },
    setPosition(px: number, py: number) {
      label.x = px;
      label.y = py;
      return label;
    },
    destroy() {
      label.active = false;
    },
  };
  return label;
}

export function makeFakeScene(options: { textures?: string[] } = {}) {
  const sprites: FakeSprite[] = [];
  const tweens: FakeTween[] = [];
  const graphics: ReturnType<typeof makeGraphics>[] = [];
  const known = new Set(options.textures ?? []);
  const scene = {
    sprites,
    graphics,
    tweens: {
      list: tweens,
      add(config: { targets: unknown } & Record<string, unknown>) {
        tweens.push({ targets: config.targets, config });
        return config;
      },
      killTweensOf() {
        /* no-op */
      },
    },
    add: {
      sprite(x: number, y: number, key: string) {
        const sprite = makeSprite(x, y, key);
        sprites.push(sprite);
        return sprite;
      },
      image(x: number, y: number, key: string) {
        const sprite = makeSprite(x, y, key);
        sprites.push(sprite);
        return sprite;
      },
      graphics() {
        const gfx = makeGraphics();
        graphics.push(gfx);
        return gfx;
      },
      text(x: number, y: number, text: string, style?: object) {
        return makeText(x, y, text, style);
      },
    },
    anims: {
      exists() {
        return false;
      },
    },
    textures: {
      // Everything exists unless a whitelist was given
      exists(key: string) {
        return known.size === 0 ? true : known.has(key);
      },
    },
    cameras: {
      main: { worldView: { x: 0, y: 0, width: 800, height: 600 } },
    },
    time: { now: 0 },
  };
  return scene;
}

export type FakeScene = ReturnType<typeof makeFakeScene>;

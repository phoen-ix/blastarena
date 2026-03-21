export const AMBUSHER_SOURCE = `
var DIRS = ['up', 'down', 'left', 'right'];
var DD = { up: {dx:0,dy:-1}, down: {dx:0,dy:1}, left: {dx:-1,dy:0}, right: {dx:1,dy:0} };

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function walkable(tile, ghost) {
  if (!tile) return false;
  if (tile === 'wall') return false;
  if (ghost) return true;
  return tile === 'empty' || tile === 'spawn' || tile === 'exit' || tile === 'goal'
    || tile.indexOf('teleporter') === 0 || tile.indexOf('conveyor') === 0;
}

function getWalkable(pos, ctx) {
  var dirs = [];
  var ghost = ctx.self.typeConfig.canPassWalls;
  var passBomb = ctx.self.typeConfig.canPassBombs;
  for (var i = 0; i < DIRS.length; i++) {
    var d = DD[DIRS[i]];
    var nx = pos.x + d.dx;
    var ny = pos.y + d.dy;
    if (ny < 0 || ny >= ctx.mapHeight || nx < 0 || nx >= ctx.mapWidth) continue;
    if (!walkable(ctx.tiles[ny][nx], ghost)) continue;
    if (!passBomb && ctx.bombPositions.some(function(b) { return b.x === nx && b.y === ny; })) continue;
    dirs.push(DIRS[i]);
  }
  return dirs;
}

function bfs(from, to, ctx, maxDepth) {
  if (from.x === to.x && from.y === to.y) return null;
  var visited = {};
  visited[from.x + ',' + from.y] = true;
  var queue = [];
  var ghost = ctx.self.typeConfig.canPassWalls;
  var passBomb = ctx.self.typeConfig.canPassBombs;
  for (var i = 0; i < DIRS.length; i++) {
    var d = DD[DIRS[i]];
    var nx = from.x + d.dx;
    var ny = from.y + d.dy;
    var key = nx + ',' + ny;
    if (visited[key]) continue;
    if (ny < 0 || ny >= ctx.mapHeight || nx < 0 || nx >= ctx.mapWidth) continue;
    if (!walkable(ctx.tiles[ny][nx], ghost)) continue;
    if (!passBomb && ctx.bombPositions.some(function(b) { return b.x === nx && b.y === ny; })) continue;
    if (nx === to.x && ny === to.y) return DIRS[i];
    visited[key] = true;
    queue.push({ x: nx, y: ny, dir: DIRS[i] });
  }
  var idx = 0;
  var depth = 1;
  var levelSize = queue.length;
  while (idx < queue.length && depth < maxDepth) {
    var node = queue[idx++];
    levelSize--;
    for (var j = 0; j < DIRS.length; j++) {
      var d2 = DD[DIRS[j]];
      var nx2 = node.x + d2.dx;
      var ny2 = node.y + d2.dy;
      var key2 = nx2 + ',' + ny2;
      if (visited[key2]) continue;
      if (ny2 < 0 || ny2 >= ctx.mapHeight || nx2 < 0 || nx2 >= ctx.mapWidth) continue;
      if (!walkable(ctx.tiles[ny2][nx2], ghost)) continue;
      if (!passBomb && ctx.bombPositions.some(function(b) { return b.x === nx2 && b.y === ny2; })) continue;
      if (nx2 === to.x && ny2 === to.y) return node.dir;
      visited[key2] = true;
      queue.push({ x: nx2, y: ny2, dir: node.dir });
    }
    if (levelSize <= 0) { depth++; levelSize = queue.length - idx; }
  }
  return null;
}

function findNearest(pos, players) {
  var best = null;
  var bestDist = 99999;
  for (var i = 0; i < players.length; i++) {
    if (!players[i].alive) continue;
    var dist = manhattan(pos, players[i].position);
    if (dist < bestDist) { bestDist = dist; best = players[i]; }
  }
  return best;
}

function moveToward(from, to, ctx) {
  var dx = to.x - from.x;
  var dy = to.y - from.y;
  var prefer = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx > 0) prefer.push('right');
    else if (dx < 0) prefer.push('left');
    if (dy > 0) prefer.push('down');
    else if (dy < 0) prefer.push('up');
  } else {
    if (dy > 0) prefer.push('down');
    else if (dy < 0) prefer.push('up');
    if (dx > 0) prefer.push('right');
    else if (dx < 0) prefer.push('left');
  }
  var avail = getWalkable(from, ctx);
  for (var i = 0; i < prefer.length; i++) {
    if (avail.indexOf(prefer[i]) >= 0) return prefer[i];
  }
  return null;
}

class AmbusherAI {
  constructor(difficulty, typeConfig) {
    this.difficulty = difficulty;
    this.detectRange = difficulty === 'hard' ? 8 : difficulty === 'normal' ? 6 : 4;
    this.rushDuration = difficulty === 'hard' ? 120 : difficulty === 'normal' ? 80 : 40;
    this.bombRange = difficulty === 'hard' ? 2 : difficulty === 'normal' ? 1 : 0;
    this.bfsDepth = difficulty === 'hard' ? 30 : 20;
    this.mode = 'waiting';
    this.rushTicksLeft = 0;
  }

  decide(ctx) {
    var direction = null;
    var placeBomb = false;
    var pos = ctx.self.position;
    var target = findNearest(pos, ctx.players);
    var dist = target ? manhattan(pos, target.position) : 99999;

    if (this.mode === 'waiting') {
      // Waiting in ambush
      if (target && dist <= this.detectRange) {
        this.mode = 'rushing';
        this.rushTicksLeft = this.rushDuration;
      }
      // Stay still while waiting
      return { direction: null, placeBomb: false };
    }

    // Rushing mode
    this.rushTicksLeft--;
    if (this.rushTicksLeft <= 0 || !target) {
      this.mode = 'waiting';
      return { direction: null, placeBomb: false };
    }

    // Re-detect: if player escapes far enough, stop rushing
    if (dist > this.detectRange + 4) {
      this.mode = 'waiting';
      return { direction: null, placeBomb: false };
    }

    // Chase aggressively
    if (this.difficulty === 'easy') {
      direction = moveToward(pos, target.position, ctx);
    } else {
      direction = bfs(pos, target.position, ctx, this.bfsDepth);
      if (!direction) direction = moveToward(pos, target.position, ctx);
    }

    // Bomb when close
    if (ctx.self.typeConfig.canBomb && dist <= this.bombRange) {
      placeBomb = ctx.rng() < 0.5;
    }

    return { direction: direction, placeBomb: placeBomb };
  }
}

module.exports = AmbusherAI;
`;

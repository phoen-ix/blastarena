export const BOMBER_SOURCE = `
var DIRS = ['up', 'down', 'left', 'right'];
var DD = { up: {dx:0,dy:-1}, down: {dx:0,dy:1}, left: {dx:-1,dy:0}, right: {dx:1,dy:0} };
var OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

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

function countAdjacentWalls(pos, ctx) {
  var count = 0;
  for (var i = 0; i < DIRS.length; i++) {
    var d = DD[DIRS[i]];
    var nx = pos.x + d.dx;
    var ny = pos.y + d.dy;
    if (ny >= 0 && ny < ctx.mapHeight && nx >= 0 && nx < ctx.mapWidth) {
      var tile = ctx.tiles[ny][nx];
      if (tile === 'destructible' || tile === 'destructible_cracked') count++;
    }
  }
  return count;
}

function findSafeDir(pos, ctx) {
  // Find a direction away from all bomb positions
  var avail = getWalkable(pos, ctx);
  var safeDirs = [];
  for (var i = 0; i < avail.length; i++) {
    var d = DD[avail[i]];
    var nx = pos.x + d.dx;
    var ny = pos.y + d.dy;
    var safe = true;
    for (var j = 0; j < ctx.bombPositions.length; j++) {
      var b = ctx.bombPositions[j];
      // Danger if on same row or column within 3 tiles
      if (b.x === nx && Math.abs(b.y - ny) <= 3) { safe = false; break; }
      if (b.y === ny && Math.abs(b.x - nx) <= 3) { safe = false; break; }
    }
    if (safe) safeDirs.push(avail[i]);
  }
  return safeDirs.length > 0 ? safeDirs[Math.floor(ctx.rng() * safeDirs.length)] : (avail.length > 0 ? avail[Math.floor(ctx.rng() * avail.length)] : null);
}

class BomberAI {
  constructor(difficulty, typeConfig) {
    this.difficulty = difficulty;
    this.bombCooldown = difficulty === 'hard' ? 15 : difficulty === 'normal' ? 30 : 60;
    this.lastBombTick = -999;
    this.escaping = false;
    this.escapeTicksLeft = 0;
  }

  decide(ctx) {
    var direction = null;
    var placeBomb = false;
    var pos = ctx.self.position;
    var target = findNearest(pos, ctx.players);
    var dist = target ? manhattan(pos, target.position) : 99999;

    // If currently escaping after placing a bomb, keep moving away
    if (this.escaping && this.escapeTicksLeft > 0) {
      this.escapeTicksLeft--;
      direction = findSafeDir(pos, ctx);
      if (this.escapeTicksLeft <= 0) this.escaping = false;
      return { direction: direction, placeBomb: false };
    }
    this.escaping = false;

    var ticksSinceBomb = ctx.tick - this.lastBombTick;
    var canBombNow = ctx.self.typeConfig.canBomb && ticksSinceBomb >= this.bombCooldown;

    if (canBombNow) {
      // Evaluate whether current position is good for bombing
      var wallScore = countAdjacentWalls(pos, ctx);
      var playerNear = dist <= 4 ? 2 : 0;
      var score = wallScore + playerNear;

      var threshold = this.difficulty === 'hard' ? 1 : this.difficulty === 'normal' ? 2 : 3;

      if (score >= threshold) {
        // Hard mode: only bomb if escape route exists
        if (this.difficulty === 'hard') {
          var escapeDir = findSafeDir(pos, ctx);
          if (escapeDir) {
            placeBomb = true;
            this.lastBombTick = ctx.tick;
            this.escaping = true;
            this.escapeTicksLeft = 4;
            return { direction: escapeDir, placeBomb: true };
          }
        } else {
          placeBomb = true;
          this.lastBombTick = ctx.tick;
          this.escaping = true;
          this.escapeTicksLeft = this.difficulty === 'normal' ? 3 : 0;
          if (this.escapeTicksLeft > 0) {
            direction = findSafeDir(pos, ctx);
          }
          return { direction: direction, placeBomb: true };
        }
      }
    }

    // Movement: slowly approach player or move toward walls
    if (target && dist > 2) {
      if (this.difficulty !== 'easy') {
        direction = bfs(pos, target.position, ctx, 15);
      }
      if (!direction) {
        var w = getWalkable(pos, ctx);
        // Prefer directions with more adjacent walls (for bombing)
        var best = null;
        var bestWalls = -1;
        for (var i = 0; i < w.length; i++) {
          var d = DD[w[i]];
          var np = { x: pos.x + d.dx, y: pos.y + d.dy };
          var wc = countAdjacentWalls(np, ctx);
          if (wc > bestWalls) { bestWalls = wc; best = w[i]; }
        }
        direction = best || (w.length > 0 ? w[Math.floor(ctx.rng() * w.length)] : null);
      }
    } else {
      // Near player or no target: random walk
      var w2 = getWalkable(pos, ctx);
      if (w2.length > 0) direction = w2[Math.floor(ctx.rng() * w2.length)];
    }

    return { direction: direction, placeBomb: placeBomb };
  }
}

module.exports = BomberAI;
`;

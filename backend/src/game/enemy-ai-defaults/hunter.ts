export const HUNTER_SOURCE = `
const DIRS = ['up', 'down', 'left', 'right'];
const DD = { up: {dx:0,dy:-1}, down: {dx:0,dy:1}, left: {dx:-1,dy:0}, right: {dx:1,dy:0} };

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
  const dirs = [];
  const tiles = ctx.tiles;
  const ghost = ctx.self.typeConfig.canPassWalls;
  const passBomb = ctx.self.typeConfig.canPassBombs;
  for (let i = 0; i < DIRS.length; i++) {
    const d = DD[DIRS[i]];
    const nx = pos.x + d.dx;
    const ny = pos.y + d.dy;
    if (ny < 0 || ny >= ctx.mapHeight || nx < 0 || nx >= ctx.mapWidth) continue;
    if (!walkable(tiles[ny][nx], ghost)) continue;
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

class HunterAI {
  constructor(difficulty, typeConfig) {
    this.difficulty = difficulty;
    this.chaseChance = difficulty === 'hard' ? 0.95 : difficulty === 'normal' ? 0.75 : 0.5;
    this.bombRange = difficulty === 'hard' ? 4 : difficulty === 'normal' ? 3 : 1;
    this.bombChance = difficulty === 'hard' ? 0.4 : difficulty === 'normal' ? 0.25 : 0.1;
    this.bfsDepth = difficulty === 'hard' ? 30 : difficulty === 'normal' ? 20 : 15;
  }

  decide(ctx) {
    var direction = null;
    var placeBomb = false;
    var target = findNearest(ctx.self.position, ctx.players);
    if (!target) {
      var w = getWalkable(ctx.self.position, ctx);
      if (w.length > 0) direction = w[Math.floor(ctx.rng() * w.length)];
      return { direction: direction, placeBomb: false };
    }

    var dist = manhattan(ctx.self.position, target.position);

    // Movement: BFS chase or random walk
    if (ctx.rng() < this.chaseChance) {
      direction = bfs(ctx.self.position, target.position, ctx, this.bfsDepth);
    }
    if (!direction) {
      var walkable = getWalkable(ctx.self.position, ctx);
      if (walkable.length > 0) {
        // Prefer current direction 60% of the time
        if (ctx.rng() < 0.6 && walkable.indexOf(ctx.self.direction) >= 0) {
          direction = ctx.self.direction;
        } else {
          direction = walkable[Math.floor(ctx.rng() * walkable.length)];
        }
      }
    }

    // Bomb: place when player is within range
    if (ctx.self.typeConfig.canBomb && dist <= this.bombRange && ctx.rng() < this.bombChance) {
      placeBomb = true;
    }

    return { direction: direction, placeBomb: placeBomb };
  }
}

module.exports = HunterAI;
`;

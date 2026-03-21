export const SWARM_SOURCE = `
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

// Determine which quadrant relative to target this position is in
// Returns 0=above, 1=right, 2=below, 3=left
function getQuadrant(pos, target) {
  var dx = pos.x - target.x;
  var dy = pos.y - target.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy < 0 ? 0 : 2;
  }
  return dx > 0 ? 1 : 3;
}

// Get a flanking target position: approach from a specific quadrant
function getFlankTarget(target, quadrant, distance) {
  switch (quadrant) {
    case 0: return { x: target.x, y: target.y - distance };
    case 1: return { x: target.x + distance, y: target.y };
    case 2: return { x: target.x, y: target.y + distance };
    case 3: return { x: target.x - distance, y: target.y };
    default: return target;
  }
}

class SwarmAI {
  constructor(difficulty, typeConfig) {
    this.difficulty = difficulty;
    this.bfsDepth = difficulty === 'hard' ? 25 : 20;
    this.bombRange = difficulty === 'hard' ? 3 : difficulty === 'normal' ? 2 : 1;
  }

  decide(ctx) {
    var direction = null;
    var placeBomb = false;
    var pos = ctx.self.position;
    var target = findNearest(pos, ctx.players);

    if (!target) {
      var w = getWalkable(pos, ctx);
      if (w.length > 0) direction = w[Math.floor(ctx.rng() * w.length)];
      return { direction: direction, placeBomb: false };
    }

    var dist = manhattan(pos, target.position);
    var allies = ctx.otherEnemies.filter(function(e) { return e.alive; });

    if (this.difficulty === 'easy') {
      // Simple: chase with random offset to avoid clustering
      if (allies.length > 0) {
        // Check if another ally is closer - add slight randomness to avoid stacking
        var closerAllies = 0;
        for (var i = 0; i < allies.length; i++) {
          if (manhattan(allies[i].position, target.position) < dist) closerAllies++;
        }
        if (closerAllies >= 2 && ctx.rng() < 0.4) {
          // Too many allies closer - random walk instead
          var w2 = getWalkable(pos, ctx);
          if (w2.length > 0) direction = w2[Math.floor(ctx.rng() * w2.length)];
          return { direction: direction, placeBomb: false };
        }
      }
      direction = bfs(pos, target.position, ctx, 15);
      if (!direction) {
        var w3 = getWalkable(pos, ctx);
        if (w3.length > 0) direction = w3[Math.floor(ctx.rng() * w3.length)];
      }
    } else {
      // Count allies in each quadrant around the target
      var quadCounts = [0, 0, 0, 0];
      for (var j = 0; j < allies.length; j++) {
        var q = getQuadrant(allies[j].position, target.position);
        quadCounts[q]++;
      }

      // Find the least covered quadrant
      var myQuad = getQuadrant(pos, target.position);
      var bestQuad = 0;
      var minCount = 99;
      for (var k = 0; k < 4; k++) {
        if (quadCounts[k] < minCount) {
          minCount = quadCounts[k];
          bestQuad = k;
        }
      }

      // Move to flank from the least covered quadrant
      var flankDist = this.difficulty === 'hard' ? 2 : 3;
      var flankTarget = getFlankTarget(target.position, bestQuad, flankDist);

      // Clamp to map bounds
      flankTarget.x = Math.max(0, Math.min(ctx.mapWidth - 1, flankTarget.x));
      flankTarget.y = Math.max(0, Math.min(ctx.mapHeight - 1, flankTarget.y));

      if (dist <= flankDist) {
        // Already close enough: chase directly
        direction = bfs(pos, target.position, ctx, this.bfsDepth);
      } else {
        // Move to flank position first
        direction = bfs(pos, flankTarget, ctx, this.bfsDepth);
        if (!direction) direction = bfs(pos, target.position, ctx, this.bfsDepth);
      }

      if (!direction) {
        var w4 = getWalkable(pos, ctx);
        if (w4.length > 0) direction = w4[Math.floor(ctx.rng() * w4.length)];
      }
    }

    // Bomb when close to player, especially with allies nearby
    if (ctx.self.typeConfig.canBomb && dist <= this.bombRange) {
      var alliesNear = 0;
      for (var m = 0; m < allies.length; m++) {
        if (manhattan(allies[m].position, target.position) <= 3) alliesNear++;
      }
      var minAlliesForBomb = this.difficulty === 'hard' ? 0 : this.difficulty === 'normal' ? 1 : 2;
      if (alliesNear >= minAlliesForBomb) {
        placeBomb = ctx.rng() < 0.3;
      }
    }

    return { direction: direction, placeBomb: placeBomb };
  }
}

module.exports = SwarmAI;
`;

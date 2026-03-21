export const COWARD_SOURCE = `
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

function getFleeDir(pos, threats, ctx) {
  // Score each walkable direction by how far it moves from threats
  var avail = getWalkable(pos, ctx);
  if (avail.length === 0) return null;

  var bestDir = null;
  var bestScore = -99999;

  for (var i = 0; i < avail.length; i++) {
    var d = DD[avail[i]];
    var nx = pos.x + d.dx;
    var ny = pos.y + d.dy;
    var score = 0;
    for (var j = 0; j < threats.length; j++) {
      score += manhattan({ x: nx, y: ny }, threats[j].position);
    }

    // Penalize directions toward bombs
    for (var k = 0; k < ctx.bombPositions.length; k++) {
      var b = ctx.bombPositions[k];
      if (b.x === nx && Math.abs(b.y - ny) <= 3) score -= 10;
      if (b.y === ny && Math.abs(b.x - nx) <= 3) score -= 10;
    }

    // Bonus for directions with more exits (avoid dead ends)
    var nextAvail = getWalkable({ x: nx, y: ny }, ctx);
    score += nextAvail.length * 2;

    if (score > bestScore) { bestScore = score; bestDir = avail[i]; }
  }

  return bestDir;
}

function isChokepoint(pos, ctx) {
  // A chokepoint has exactly 2 walkable neighbors in a line
  var avail = getWalkable(pos, ctx);
  if (avail.length !== 2) return false;
  // Check if they're opposite directions (corridor)
  if ((avail[0] === 'up' && avail[1] === 'down') ||
      (avail[0] === 'down' && avail[1] === 'up') ||
      (avail[0] === 'left' && avail[1] === 'right') ||
      (avail[0] === 'right' && avail[1] === 'left')) {
    return true;
  }
  return false;
}

class CowardAI {
  constructor(difficulty, typeConfig) {
    this.difficulty = difficulty;
    this.bombChance = difficulty === 'hard' ? 0.4 : difficulty === 'normal' ? 0.25 : 0.1;
    this.fleeAll = difficulty === 'hard';
  }

  decide(ctx) {
    var direction = null;
    var placeBomb = false;
    var pos = ctx.self.position;

    // Build threat list
    var threats = [];
    if (this.fleeAll) {
      for (var i = 0; i < ctx.players.length; i++) {
        if (ctx.players[i].alive) threats.push(ctx.players[i]);
      }
    } else {
      var nearest = findNearest(pos, ctx.players);
      if (nearest) threats.push(nearest);
    }

    if (threats.length === 0) {
      // No threats: random walk
      var w = getWalkable(pos, ctx);
      if (w.length > 0) {
        if (ctx.rng() < 0.6 && w.indexOf(ctx.self.direction) >= 0) {
          direction = ctx.self.direction;
        } else {
          direction = w[Math.floor(ctx.rng() * w.length)];
        }
      }
      return { direction: direction, placeBomb: false };
    }

    var nearestDist = manhattan(pos, threats[0].position);

    // Flee
    if (this.difficulty === 'easy') {
      // Simple: move opposite to nearest threat
      var dx = threats[0].position.x - pos.x;
      var dy = threats[0].position.y - pos.y;
      var prefer = [];
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx > 0) prefer.push('left');
        else if (dx < 0) prefer.push('right');
        if (dy > 0) prefer.push('up');
        else if (dy < 0) prefer.push('down');
      } else {
        if (dy > 0) prefer.push('up');
        else if (dy < 0) prefer.push('down');
        if (dx > 0) prefer.push('left');
        else if (dx < 0) prefer.push('right');
      }
      var avail = getWalkable(pos, ctx);
      for (var j = 0; j < prefer.length; j++) {
        if (avail.indexOf(prefer[j]) >= 0) { direction = prefer[j]; break; }
      }
      if (!direction && avail.length > 0) direction = avail[Math.floor(ctx.rng() * avail.length)];
    } else {
      direction = getFleeDir(pos, threats, ctx);
    }

    // Drop bombs as traps while fleeing
    if (ctx.self.typeConfig.canBomb && nearestDist <= 6) {
      var shouldBomb = ctx.rng() < this.bombChance;
      // Hard mode: prefer chokepoints for bombs
      if (this.difficulty === 'hard' && isChokepoint(pos, ctx)) {
        shouldBomb = ctx.rng() < 0.7;
      }
      // Avoid bombing if we'd walk into our own bomb
      if (shouldBomb && this.difficulty !== 'easy') {
        var safe = true;
        if (direction) {
          var d = DD[direction];
          var nextPos = { x: pos.x + d.dx, y: pos.y + d.dy };
          for (var k = 0; k < ctx.bombPositions.length; k++) {
            var bp = ctx.bombPositions[k];
            if (bp.x === nextPos.x && Math.abs(bp.y - nextPos.y) <= 2) { safe = false; break; }
            if (bp.y === nextPos.y && Math.abs(bp.x - nextPos.x) <= 2) { safe = false; break; }
          }
        }
        if (safe) placeBomb = true;
      } else if (shouldBomb) {
        placeBomb = true;
      }
    }

    return { direction: direction, placeBomb: placeBomb };
  }
}

module.exports = CowardAI;
`;

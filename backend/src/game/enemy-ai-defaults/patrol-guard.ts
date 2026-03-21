export const PATROL_GUARD_SOURCE = `
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
  return avail.length > 0 ? avail[Math.floor(ctx.rng() * avail.length)] : null;
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

class PatrolGuardAI {
  constructor(difficulty, typeConfig) {
    this.difficulty = difficulty;
    this.detectRange = difficulty === 'hard' ? 8 : difficulty === 'normal' ? 5 : 3;
    this.switchChance = difficulty === 'hard' ? 0.9 : difficulty === 'normal' ? 0.6 : 0.25;
    this.bombRange = difficulty === 'hard' ? 2 : difficulty === 'normal' ? 1 : 0;
    this.bfsDepth = difficulty === 'hard' ? 25 : 20;
    this.mode = 'patrol';
    this.patrolForward = true;
    this.localPatrolIdx = 0;
  }

  decide(ctx) {
    var direction = null;
    var placeBomb = false;
    var target = findNearest(ctx.self.position, ctx.players);
    var dist = target ? manhattan(ctx.self.position, target.position) : 99999;

    // Mode switching
    if (this.mode === 'patrol' && target && dist <= this.detectRange) {
      if (ctx.rng() < this.switchChance) this.mode = 'chase';
    } else if (this.mode === 'chase' && dist > this.detectRange + 2) {
      this.mode = 'patrol';
    }

    if (this.mode === 'chase' && target) {
      // Chase mode
      if (this.difficulty === 'easy') {
        direction = moveToward(ctx.self.position, target.position, ctx);
      } else {
        direction = bfs(ctx.self.position, target.position, ctx, this.bfsDepth);
        if (!direction) direction = moveToward(ctx.self.position, target.position, ctx);
      }
      // Bomb during chase
      if (ctx.self.typeConfig.canBomb && dist <= this.bombRange) {
        placeBomb = true;
      }
    } else {
      // Patrol mode
      var path = ctx.self.patrolPath;
      if (path && path.length > 0) {
        // Sync local index from context
        this.localPatrolIdx = ctx.self.patrolIndex;
        var wp = path[this.localPatrolIdx];
        if (wp) {
          direction = moveToward(ctx.self.position, wp, ctx);
        }
      } else {
        // No patrol path: random walk
        var w = getWalkable(ctx.self.position, ctx);
        if (w.length > 0) {
          if (ctx.rng() < 0.6 && w.indexOf(ctx.self.direction) >= 0) {
            direction = ctx.self.direction;
          } else {
            direction = w[Math.floor(ctx.rng() * w.length)];
          }
        }
      }
    }

    return { direction: direction, placeBomb: placeBomb };
  }
}

module.exports = PatrolGuardAI;
`;

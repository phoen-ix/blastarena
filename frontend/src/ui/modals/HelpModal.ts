export function showHelpModal(): void {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:540px;max-height:85vh;overflow-y:auto;">
      <h2>How to Play</h2>

      <div class="help-section">
        <div class="help-heading">Controls</div>
        <div class="help-row"><span class="help-key">WASD / Arrows</span> Move</div>
        <div class="help-row"><span class="help-key">Space</span> Place bomb</div>
        <div class="help-row"><span class="help-key">E</span> Detonate remote bombs</div>
        <div class="help-row"><span class="help-key">1-9</span> Spectate Nth player (when dead)</div>
      </div>

      <div class="help-section">
        <div class="help-heading">Controller (Xbox / Gamepad)</div>
        <div class="help-tip">Any standard-mapped controller works. Just plug in and play.</div>
        <div class="help-row"><span class="help-key">D-Pad / Left Stick</span> Move</div>
        <div class="help-row"><span class="help-key">A</span> Place bomb</div>
        <div class="help-row"><span class="help-key">B</span> Detonate remote bombs</div>
        <div class="help-row"><span class="help-key">LB / RB</span> Cycle spectate target (when dead)</div>
      </div>

      <div class="help-section">
        <div class="help-heading">Power-Ups</div>
        <div class="help-tip">Dropped when breakable walls are destroyed. Walk over floating tiles to collect. Your HUD (bottom-left) shows your current stats.</div>
        <div class="help-row">
          <span class="help-pu" style="background:#FF4444;">💣</span>
          <b>Bomb Up</b> — +1 max bombs (up to 8)
        </div>
        <div class="help-row">
          <span class="help-pu" style="background:#FF8800;">🔥</span>
          <b>Fire Up</b> — +1 explosion range (up to 8)
        </div>
        <div class="help-row">
          <span class="help-pu" style="background:#44AAFF;">⚡</span>
          <b>Speed Up</b> — faster movement (up to 5)
        </div>
        <div class="help-row">
          <span class="help-pu" style="background:#44FF44;">🛡️</span>
          <b>Shield</b> — absorbs one hit, then breaks. Doesn't stack, no time limit
        </div>
        <div class="help-row">
          <span class="help-pu" style="background:#CC44FF;">👢</span>
          <b>Kick</b> — walk into a bomb to slide it across the map
        </div>
        <div class="help-row">
          <span class="help-pu" style="background:#FF2222;">💥</span>
          <b>Pierce Bomb</b> — explosions pass through breakable walls (still destroys them)
        </div>
        <div class="help-row">
          <span class="help-pu" style="background:#4488FF;">📡</span>
          <b>Remote Bomb</b> — bombs don't auto-explode; press <span class="help-key">E</span> to detonate all. Auto-detonates after 10s
        </div>
        <div class="help-row">
          <span class="help-pu" style="background:#FFAA44;">🧨</span>
          <b>Line Bomb</b> — places a line of bombs in your facing direction (uses remaining bomb capacity)
        </div>
      </div>

      <div class="help-section">
        <div class="help-heading">Game Modes</div>
        <div class="help-row"><b style="color:var(--primary)">Free for All</b> — Last player standing wins</div>
        <div class="help-row"><b style="color:var(--primary)">Teams</b> — 2 teams, last team standing. Friendly fire is configurable</div>
        <div class="help-row"><b style="color:var(--primary)">Battle Royale</b> — A danger zone shrinks from the edges. Stay inside or take damage every tick</div>
        <div class="help-row"><b style="color:var(--primary)">Sudden Death</b> — Everyone starts maxed out (8 bombs, 8 range, max speed, kick). No power-ups, one hit kills</div>
        <div class="help-row"><b style="color:var(--primary)">Deathmatch</b> — Respawn 3s after death with reset stats. First to 10 kills wins</div>
        <div class="help-row"><b style="color:var(--primary)">King of the Hill</b> — Stand in the 3x3 center zone to score. First to 100 points wins</div>
      </div>

      <div class="help-section">
        <div class="help-heading">Map Features</div>
        <div class="help-tip">Optional — toggled when creating a room.</div>
        <div class="help-row"><b style="color:#886633">Reinforced Walls</b> — Breakable walls take 2 hits. First hit cracks them, second destroys them</div>
        <div class="help-row" style="margin-top:8px;"><b style="color:var(--warning)">Map Events</b></div>
        <div class="help-row" style="padding-left:12px;">Meteor strikes hit random tiles with a 2s warning reticle on the ground</div>
        <div class="help-row" style="padding-left:12px;">Power-up rain periodically drops items across the map</div>
        <div class="help-row" style="margin-top:8px;"><b style="color:var(--info)">Hazard Tiles</b></div>
        <div class="help-row" style="padding-left:12px;">
          <span class="help-tile" style="background:radial-gradient(circle, rgba(68,170,255,0.5) 30%, rgba(68,170,255,0.15) 70%, #2a2a3e 100%);"></span>
          <span class="help-tile" style="background:radial-gradient(circle, rgba(255,136,68,0.5) 30%, rgba(255,136,68,0.15) 70%, #2a2a3e 100%);"></span>
          <b>Teleporters</b> — glowing pads in blue/orange pairs. Step on one to instantly warp to the other
        </div>
        <div class="help-row" style="padding-left:12px;">
          <span class="help-tile" style="background:#3a3a4e;color:#88aacc;font-size:14px;line-height:22px;">▸▸▸</span>
          <b>Conveyor Belts</b> — dark tiles with arrows. Push you in the arrow direction when you step on them
        </div>
      </div>

      <div class="help-section">
        <div class="help-heading">Mechanics</div>
        <div class="help-row"><b>Bombs</b> explode after 3 seconds in 4 cardinal directions up to their fire range</div>
        <div class="help-row"><b>Chain reactions</b> — bombs caught in an explosion detonate instantly</div>
        <div class="help-row"><b>Kicked bombs</b> slide until hitting a wall, bomb, or player</div>
        <div class="help-row"><b>Shield break</b> — after your shield absorbs a hit, you get brief invulnerability to escape</div>
        <div class="help-row"><b>Invulnerability</b> — 2 seconds after spawning or respawning</div>
        <div class="help-row"><b>Self-kills</b> subtract 1 from your kill score</div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-primary" id="modal-close">Close</button>
      </div>
    </div>
  `;

  modal.querySelector('#modal-close')!.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  document.getElementById('ui-overlay')!.appendChild(modal);
}

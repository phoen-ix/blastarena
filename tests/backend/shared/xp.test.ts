import {
  getXpForLevel,
  getLevelForXp,
  getXpToNextLevel,
  calculateXpGained,
  XP_PER_KILL,
  XP_PER_BOMB,
  XP_PER_POWERUP,
  XP_WIN_BONUS,
  XP_MATCH_COMPLETION,
  XP_PLACEMENT_BONUS,
} from '@blast-arena/shared';

describe('XP Constants', () => {
  test('constants have expected values', () => {
    expect(XP_PER_KILL).toBe(50);
    expect(XP_PER_BOMB).toBe(5);
    expect(XP_PER_POWERUP).toBe(10);
    expect(XP_WIN_BONUS).toBe(100);
    expect(XP_MATCH_COMPLETION).toBe(25);
    expect(XP_PLACEMENT_BONUS).toEqual([100, 50, 25]);
  });
});

describe('getXpForLevel', () => {
  test('level 1 requires 0 XP', () => {
    expect(getXpForLevel(1)).toBe(0);
  });

  test('level 2 requires 100 XP', () => {
    expect(getXpForLevel(2)).toBe(100);
  });

  test('level 3 requires 300 XP (100 + 200)', () => {
    expect(getXpForLevel(3)).toBe(300);
  });

  test('level 5 requires 1000 XP', () => {
    expect(getXpForLevel(5)).toBe(1000);
  });

  test('level 10 requires 4500 XP', () => {
    expect(getXpForLevel(10)).toBe(4500);
  });

  test('returns 0 for level <= 0', () => {
    expect(getXpForLevel(0)).toBe(0);
    expect(getXpForLevel(-1)).toBe(0);
  });
});

describe('getXpToNextLevel', () => {
  test('level 1 needs 100 XP to advance', () => {
    expect(getXpToNextLevel(1)).toBe(100);
  });

  test('level 5 needs 500 XP to advance', () => {
    expect(getXpToNextLevel(5)).toBe(500);
  });

  test('level 10 needs 1000 XP to advance', () => {
    expect(getXpToNextLevel(10)).toBe(1000);
  });
});

describe('getLevelForXp', () => {
  test('0 XP = level 1', () => {
    expect(getLevelForXp(0)).toBe(1);
  });

  test('99 XP = level 1', () => {
    expect(getLevelForXp(99)).toBe(1);
  });

  test('100 XP = level 2', () => {
    expect(getLevelForXp(100)).toBe(2);
  });

  test('299 XP = level 2', () => {
    expect(getLevelForXp(299)).toBe(2);
  });

  test('300 XP = level 3', () => {
    expect(getLevelForXp(300)).toBe(3);
  });

  test('1000 XP = level 5', () => {
    expect(getLevelForXp(1000)).toBe(5);
  });

  test('4500 XP = level 10', () => {
    expect(getLevelForXp(4500)).toBe(10);
  });

  test('negative XP = level 1', () => {
    expect(getLevelForXp(-100)).toBe(1);
  });

  test('round-trip: getXpForLevel and getLevelForXp are inverses', () => {
    for (let level = 1; level <= 50; level++) {
      const xp = getXpForLevel(level);
      expect(getLevelForXp(xp)).toBe(level);
    }
  });
});

describe('calculateXpGained', () => {
  test('basic match completion XP', () => {
    const xp = calculateXpGained({
      kills: 0,
      bombsPlaced: 0,
      powerupsCollected: 0,
      placement: 4,
      isWinner: false,
    });
    expect(xp).toBe(XP_MATCH_COMPLETION); // 25
  });

  test('kills contribute XP', () => {
    const xp = calculateXpGained({
      kills: 5,
      bombsPlaced: 0,
      powerupsCollected: 0,
      placement: 4,
      isWinner: false,
    });
    expect(xp).toBe(5 * XP_PER_KILL + XP_MATCH_COMPLETION); // 275
  });

  test('bombs contribute XP', () => {
    const xp = calculateXpGained({
      kills: 0,
      bombsPlaced: 20,
      powerupsCollected: 0,
      placement: 4,
      isWinner: false,
    });
    expect(xp).toBe(20 * XP_PER_BOMB + XP_MATCH_COMPLETION); // 125
  });

  test('powerups contribute XP', () => {
    const xp = calculateXpGained({
      kills: 0,
      bombsPlaced: 0,
      powerupsCollected: 3,
      placement: 4,
      isWinner: false,
    });
    expect(xp).toBe(3 * XP_PER_POWERUP + XP_MATCH_COMPLETION); // 55
  });

  test('winner gets win bonus', () => {
    const xp = calculateXpGained({
      kills: 0,
      bombsPlaced: 0,
      powerupsCollected: 0,
      placement: 1,
      isWinner: true,
    });
    expect(xp).toBe(XP_WIN_BONUS + XP_MATCH_COMPLETION + XP_PLACEMENT_BONUS[0]); // 225
  });

  test('placement bonuses for top 3', () => {
    expect(
      calculateXpGained({
        kills: 0,
        bombsPlaced: 0,
        powerupsCollected: 0,
        placement: 1,
        isWinner: false,
      }),
    ).toBe(XP_MATCH_COMPLETION + XP_PLACEMENT_BONUS[0]); // 125
    expect(
      calculateXpGained({
        kills: 0,
        bombsPlaced: 0,
        powerupsCollected: 0,
        placement: 2,
        isWinner: false,
      }),
    ).toBe(XP_MATCH_COMPLETION + XP_PLACEMENT_BONUS[1]); // 75
    expect(
      calculateXpGained({
        kills: 0,
        bombsPlaced: 0,
        powerupsCollected: 0,
        placement: 3,
        isWinner: false,
      }),
    ).toBe(XP_MATCH_COMPLETION + XP_PLACEMENT_BONUS[2]); // 50
  });

  test('no placement bonus for 4th+', () => {
    const xp = calculateXpGained({
      kills: 0,
      bombsPlaced: 0,
      powerupsCollected: 0,
      placement: 4,
      isWinner: false,
    });
    expect(xp).toBe(XP_MATCH_COMPLETION); // 25
  });

  test('multiplier scales XP', () => {
    const base = calculateXpGained(
      {
        kills: 2,
        bombsPlaced: 10,
        powerupsCollected: 1,
        placement: 1,
        isWinner: true,
      },
      1,
    );
    const doubled = calculateXpGained(
      {
        kills: 2,
        bombsPlaced: 10,
        powerupsCollected: 1,
        placement: 1,
        isWinner: true,
      },
      2,
    );
    expect(doubled).toBe(base * 2);
  });

  test('zero multiplier gives 0 XP', () => {
    const xp = calculateXpGained(
      {
        kills: 10,
        bombsPlaced: 50,
        powerupsCollected: 5,
        placement: 1,
        isWinner: true,
      },
      0,
    );
    expect(xp).toBe(0);
  });

  test('full game scenario', () => {
    const xp = calculateXpGained({
      kills: 3,
      bombsPlaced: 15,
      powerupsCollected: 4,
      placement: 1,
      isWinner: true,
    });
    // 3*50 + 15*5 + 4*10 + 100(win) + 25(completion) + 100(1st place) = 150+75+40+100+25+100 = 490
    expect(xp).toBe(490);
  });
});

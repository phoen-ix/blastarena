export interface MapChallenge {
  id: number;
  title: string;
  description: string;
  customMapId: number;
  gameMode: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdBy: number;
  createdAt: string;
}

export interface MapChallengeSummary {
  id: number;
  title: string;
  description: string;
  customMapId: number;
  mapName: string;
  mapCreator: string;
  gameMode: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface ChallengeScore {
  userId: number;
  username: string;
  wins: number;
  kills: number;
  deaths: number;
  gamesPlayed: number;
  bestPlacement: number | null;
}

export interface ActiveChallengeInfo {
  challenge: MapChallengeSummary;
  mapTiles: string[][] | null;
  topScores: ChallengeScore[];
}

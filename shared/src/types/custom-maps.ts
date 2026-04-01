import { TileType, Position } from './game';

export interface CustomMap {
  id: number;
  name: string;
  description: string;
  mapWidth: number;
  mapHeight: number;
  tiles: TileType[][];
  spawnPoints: Position[];
  isPublished: boolean;
  createdBy: number;
  creatorUsername?: string;
  playCount: number;
}

export interface CustomMapSummary {
  id: number;
  name: string;
  mapWidth: number;
  mapHeight: number;
  spawnCount: number;
  isPublished: boolean;
  createdBy: number;
  creatorUsername?: string;
  playCount: number;
  avgRating: number | null;
  ratingCount: number;
}

export interface EnemyAIEntry {
  id: string;
  name: string;
  description: string;
  filename: string;
  isActive: boolean;
  uploadedBy: string | null;
  uploadedAt: string;
  version: number;
  fileSize: number;
}

export interface KeyMoment {
  timeSeconds: number;
  title: string;
  description: string;
}

export interface SummaryResult {
  summary: string;
  actionItems: string[];
  keyMoments?: KeyMoment[];
  durationSeconds?: number;
}

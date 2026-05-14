export type TournamentStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED';
export type MatchStatus = 'PENDING' | 'PLAYING' | 'FINISHED' | 'REVIEW';

export interface TournamentSummary {
  id: number;
  name: string;
  description: string;
  maxPlayers: number;
  participantCount: number;
  status: TournamentStatus;
  startDate: string | null;
  winnerUserId: number | null;
}

export interface TournamentParticipant {
  userId: number;
  username: string;
  displayName: string | null;
  deckId: number;
  deckName: string;
  joinedAt: string;
}

export interface TournamentMatch {
  id: number;
  roundNumber: number;
  matchNumber: number;
  player1Id: number | null;
  player2Id: number | null;
  winnerId: number | null;
  status: MatchStatus;
}

export interface TournamentDetail {
  id: number;
  name: string;
  description: string;
  maxPlayers: number;
  participantCount: number;
  status: TournamentStatus;
  startDate: string | null;
  winnerUserId: number | null;
  currentRound: number;
  joinedByCurrentUser: boolean;
  participants: TournamentParticipant[];
  matches: TournamentMatch[];
}

export interface CreateTournamentPayload {
  name: string;
  description: string;
  maxPlayers: number;
  startDate?: string | null;
}

export interface JoinTournamentPayload {
  deckId: number;
}

export interface ReportMatchPayload {
  winnerId: number;
}

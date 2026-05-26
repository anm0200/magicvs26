import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateTournamentPayload,
  JoinTournamentPayload,
  ReportMatchPayload,
  TournamentDetail,
  TournamentMatchAcceptance,
  TournamentMatch,
  TournamentSummary
} from '../../models/tournament.model';

@Injectable({
  providedIn: 'root'
})
export class TournamentService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = 'http://localhost:8080/api';

  listTournaments(): Observable<TournamentSummary[]> {
    return this.http.get<TournamentSummary[]>(`${this.apiBase}/tournaments`);
  }

  getTournament(id: number): Observable<TournamentDetail> {
    return this.http.get<TournamentDetail>(`${this.apiBase}/tournaments/${id}`, { headers: this.authHeadersOptional() });
  }

  createTournament(payload: CreateTournamentPayload): Observable<TournamentSummary> {
    return this.http.post<TournamentSummary>(`${this.apiBase}/tournaments`, payload, { headers: this.authHeadersRequired() });
  }

  joinTournament(id: number, payload: JoinTournamentPayload): Observable<TournamentDetail> {
    return this.http.post<TournamentDetail>(`${this.apiBase}/tournaments/${id}/join`, payload, { headers: this.authHeadersRequired() });
  }

  reportMatch(matchId: number, payload: ReportMatchPayload): Observable<TournamentMatch> {
    return this.http.post<TournamentMatch>(`${this.apiBase}/matches/${matchId}/report`, payload, { headers: this.authHeadersRequired() });
  }

  acceptTournamentMatch(matchId: number): Observable<TournamentMatchAcceptance> {
    return this.http.post<TournamentMatchAcceptance>(`${this.apiBase}/matches/${matchId}/accept`, {}, { headers: this.authHeadersRequired() });
  }

  private authHeadersOptional(): HttpHeaders {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  private authHeadersRequired(): HttpHeaders {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    if (!token) {
      throw new Error('Necesitas iniciar sesión para esta acción');
    }
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}

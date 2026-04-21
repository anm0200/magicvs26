import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { Match } from '../../models/match.model';

@Injectable({
  providedIn: 'root'
})
export class MatchService {

  getMatches(): Observable<Match[]> {
    const mockMatches: Match[] = [
      // LIVE MATCHES
      {
        id: 'LV-001',
        status: 'LIVE',
        format: 'MODERN',
        player1: {
          username: 'Xalthar_MTG',
          elo: 1420,
          deckSummary: { archetype: 'Murktide Regent', colors: ['U', 'R'] }
        },
        player2: {
          username: 'Lumina_Soul',
          elo: 1385,
          deckSummary: { archetype: 'Hammer Time', colors: ['W'] }
        }
      },
      {
        id: 'LV-002',
        status: 'LIVE',
        format: 'STANDARD',
        player1: {
          username: 'Spark_Mage',
          elo: 1250,
          deckSummary: { archetype: 'Mono Red Burn', colors: ['R'] }
        },
        player2: {
          username: 'Nature_Protector',
          elo: 1245,
          deckSummary: { archetype: 'Selesnya Toxic', colors: ['G', 'W'] }
        }
      },
      // HISTORY MATCHES
      {
        id: 'HS-001',
        status: 'FINISHED',
        format: 'STANDARD',
        player1: {
          username: 'Current_User', // Representation of the logged in user
          elo: 1315,
          deckSummary: { archetype: 'Esper Legends', colors: ['W', 'U', 'B'] }
        },
        player2: {
          username: 'ShadowBinder',
          elo: 1300,
          deckSummary: { archetype: 'Grixis Midrange', colors: ['U', 'B', 'R'] }
        },
        winner: 'Current_User',
        score: '2 - 0',
        eloChange: 15,
        timestamp: '2024-04-21T14:30:00Z'
      },
      {
        id: 'HS-002',
        status: 'FINISHED',
        format: 'COMMANDER',
        player1: {
          username: 'Current_User',
          elo: 1300,
          deckSummary: { archetype: 'Dihada, Binder of Wills', colors: ['W', 'B', 'R'] }
        },
        player2: {
          username: 'Midas_Touch',
          elo: 1500,
          deckSummary: { archetype: 'Kenrith stax', colors: ['W', 'U', 'B', 'R', 'G'] }
        },
        winner: 'Midas_Touch',
        score: '0 - 1',
        eloChange: -12,
        timestamp: '2024-04-21T12:00:00Z'
      },
      {
        id: 'HS-003',
        status: 'FINISHED',
        format: 'MODERN',
        player1: {
          username: 'Current_User',
          elo: 1312,
          deckSummary: { archetype: 'Amulet Titan', colors: ['G'] }
        },
        player2: {
          username: 'Noctis_Rex',
          elo: 1280,
          deckSummary: { archetype: 'Living End', colors: ['U', 'B', 'G'] }
        },
        winner: 'Current_User',
        score: '2 - 1',
        eloChange: 18,
        timestamp: '2024-04-20T20:00:00Z'
      }
    ];

    return of(mockMatches).pipe(delay(800));
  }
}

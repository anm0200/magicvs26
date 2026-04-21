import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatchService } from '../../../core/services/match.service';
import { Match } from '../../../models/match.model';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { MatchmakingModalComponent } from '../../../shared/components/matchmaking-modal/matchmaking-modal.component';

@Component({
  selector: 'app-match-browser',
  standalone: true,
  imports: [CommonModule, RouterModule, AvatarComponent, MatchmakingModalComponent],
  templateUrl: './match-browser.component.html',
  styleUrl: './match-browser.component.scss'
})
export class MatchBrowserComponent implements OnInit {
  private matchService = inject(MatchService);

  liveMatches: Match[] = [];
  historyMatches: Match[] = [];
  isLoading = true;
  isMatchmakingModalOpen = false;

  expandedMatchId: string | null = null;

  ngOnInit(): void {
    this.loadMatches();
  }

  loadMatches(): void {
    this.isLoading = true;
    this.matchService.getMatches().subscribe({
      next: (data) => {
        this.liveMatches = data.filter(m => m.status === 'LIVE');
        this.historyMatches = data.filter(m => m.status === 'FINISHED');
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error loading matches', err);
        this.isLoading = false;
      }
    });
  }

  toggleExpand(matchId: string): void {
    if (this.expandedMatchId === matchId) {
      this.expandedMatchId = null;
    } else {
      this.expandedMatchId = matchId;
    }
  }

  getColorClass(colorCode: string): string {
    const map: { [key: string]: string } = {
      'W': 'bg-zinc-100 text-zinc-900',
      'U': 'bg-blue-500 text-white',
      'B': 'bg-zinc-800 text-zinc-100',
      'R': 'bg-rose-500 text-white',
      'G': 'bg-emerald-500 text-white'
    };
    return map[colorCode] || 'bg-zinc-500';
  }
}

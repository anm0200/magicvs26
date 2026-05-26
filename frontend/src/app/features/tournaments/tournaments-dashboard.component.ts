import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { TournamentService } from '../../core/services/tournament.service';
import { DeckBuilderService } from '../../core/services/deck-builder.service';
import { ToastService } from '../../core/services/toast.service';
import { TournamentSummary } from '../../models/tournament.model';

interface UserDeckOption {
  id: number;
  name: string;
  totalCards: number;
}

type TournamentFilter = 'PENDING' | 'ACTIVE' | 'COMPLETED';

@Component({
  selector: 'app-tournaments-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tournaments-dashboard.component.html',
  styleUrl: './tournaments-dashboard.component.scss'
})
export class TournamentsDashboardComponent implements OnInit {
  private readonly tournamentService = inject(TournamentService);
  private readonly deckBuilderService = inject(DeckBuilderService);
  private readonly toastService = inject(ToastService);

  readonly tournaments = signal<TournamentSummary[]>([]);
  readonly isLoading = signal<boolean>(true);
  readonly isCreating = signal<boolean>(false);
  readonly decks = signal<UserDeckOption[]>([]);
  readonly selectedDeckByTournament = signal<Record<number, number | null>>({});
  readonly createName = signal<string>('Copa Standard MagicVS');
  readonly createDescription = signal<string>('Eliminación directa con bracket automático.');
  readonly createMaxPlayers = signal<number>(8);
  readonly activeFilter = signal<TournamentFilter>('PENDING');
  readonly commandPanelCollapsed = signal<boolean>(false);
  readonly contextPanelCollapsed = signal<boolean>(false);

  readonly pendingTournaments = computed(() => this.tournaments().filter(t => t.status === 'PENDING'));
  readonly activeTournaments = computed(() => this.tournaments().filter(t => t.status === 'ACTIVE'));
  readonly completedTournaments = computed(() => this.tournaments().filter(t => t.status === 'COMPLETED'));
  readonly visibleTournaments = computed(() => this.tournaments().filter(t => t.status === this.activeFilter()));
  readonly arenaPulse = computed(() => ({
    openSeats: this.tournaments().reduce((sum, t) => sum + Math.max(t.maxPlayers - t.participantCount, 0), 0),
    filledSeats: this.tournaments().reduce((sum, t) => sum + t.participantCount, 0),
    live: this.activeTournaments().length
  }));

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.isLoading.set(true);

    this.tournamentService.listTournaments()
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: (items) => this.tournaments.set(items),
        error: () => this.toastService.show('No se pudieron cargar los torneos', 'error')
      });

    this.deckBuilderService.getUserDecks().subscribe({
      next: (items) => {
        const normalized = (items ?? []).map((d: any) => ({
          id: Number(d.id),
          name: String(d.name ?? 'Mazo sin nombre'),
          totalCards: Number(d.totalCards ?? 0)
        }));
        this.decks.set(normalized);
      },
      error: () => {
        this.decks.set([]);
      }
    });
  }

  createTournament(): void {
    const name = this.createName().trim();
    if (!name) {
      this.toastService.show('Debes indicar un nombre para el torneo', 'warning');
      return;
    }

    this.isCreating.set(true);
    this.tournamentService.createTournament({
      name,
      description: this.createDescription().trim(),
      maxPlayers: this.createMaxPlayers()
    }).pipe(finalize(() => this.isCreating.set(false)))
      .subscribe({
        next: () => {
          this.toastService.show('Torneo creado correctamente', 'success');
          this.loadAll();
        },
        error: (err) => this.toastService.show(err?.error?.message || 'No se pudo crear el torneo', 'error')
      });
  }

  joinTournament(tournamentId: number): void {
    const deckId = this.selectedDeckByTournament()[tournamentId];
    if (!deckId) {
      this.toastService.show('Selecciona un mazo para inscribirte', 'warning');
      return;
    }

    this.tournamentService.joinTournament(tournamentId, { deckId }).subscribe({
      next: () => {
        this.toastService.show('Inscripción confirmada', 'success');
        this.loadAll();
      },
      error: (err) => this.toastService.show(err?.error?.message || 'No fue posible completar la inscripción', 'error')
    });
  }

  setSelectedDeck(tournamentId: number, value: string): void {
    const nextDeckId = value ? Number(value) : null;
    this.selectedDeckByTournament.update(current => ({
      ...current,
      [tournamentId]: nextDeckId
    }));
  }

  setCreateMaxPlayers(value: string): void {
    const parsed = Number(value);
    if (parsed === 8 || parsed === 16 || parsed === 32) {
      this.createMaxPlayers.set(parsed);
    }
  }

  setFilter(filter: TournamentFilter): void {
    this.activeFilter.set(filter);
  }

  toggleCommandPanel(): void {
    this.commandPanelCollapsed.update(value => !value);
  }

  toggleContextPanel(): void {
    this.contextPanelCollapsed.update(value => !value);
  }

  activeArenaAccent(): string {
    switch (this.activeFilter()) {
      case 'PENDING':
        return '#92ccff';
      case 'ACTIVE':
        return '#ba9eff';
      case 'COMPLETED':
        return '#efc209';
      default:
        return '#ba9eff';
    }
  }

  tournamentAccent(tournament: TournamentSummary): string {
    switch (tournament.status) {
      case 'PENDING':
        return '#92ccff';
      case 'ACTIVE':
        return '#ba9eff';
      case 'COMPLETED':
        return '#efc209';
      default:
        return '#ba9eff';
    }
  }

  fillPercent(tournament: TournamentSummary): number {
    if (!tournament.maxPlayers) {
      return 0;
    }
    return Math.min(100, Math.round((tournament.participantCount / tournament.maxPlayers) * 100));
  }

  tournamentCountdown(tournament: TournamentSummary): string {
    if (!tournament.startDate) {
      return tournament.status === 'PENDING' ? 'T-READY' : 'LIVE';
    }

    const target = new Date(tournament.startDate).getTime();
    const diff = Math.max(target - Date.now(), 0);
    const hours = Math.floor(diff / 3_600_000).toString().padStart(2, '0');
    const minutes = Math.floor((diff % 3_600_000) / 60_000).toString().padStart(2, '0');
    const seconds = Math.floor((diff % 60_000) / 1000).toString().padStart(2, '0');
    return `T-${hours}:${minutes}:${seconds}`;
  }

  filterLabel(filter: TournamentFilter): string {
    switch (filter) {
      case 'PENDING':
        return 'Inscripción';
      case 'ACTIVE':
        return 'En curso';
      case 'COMPLETED':
        return 'Finalizados';
      default:
        return filter;
    }
  }

  statusLabel(status: TournamentSummary['status']): string {
    switch (status) {
      case 'PENDING':
        return 'Inscripción abierta';
      case 'ACTIVE':
        return 'En curso';
      case 'COMPLETED':
        return 'Finalizado';
      default:
        return status;
    }
  }

  isFull(t: TournamentSummary): boolean {
    return t.participantCount >= t.maxPlayers;
  }
}

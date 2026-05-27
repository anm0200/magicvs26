import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { TournamentService } from '../../core/services/tournament.service';
import { ToastService } from '../../core/services/toast.service';
import { TournamentDetail, TournamentMatch, TournamentParticipant, TournamentStatus } from '../../models/tournament.model';

type BracketSide = 'LEFT' | 'RIGHT' | 'CENTER';

interface BracketRound {
  round: number;
  title: string;
  matches: TournamentMatch[];
}

interface MatchLayout {
  match: TournamentMatch;
  side: BracketSide;
  roundNumber: number;
  roundIndex: number;
  slotIndex: number;
  centerY: number;
  cardX: number;
  cardY: number;
  slotTopY: number;
  slotBottomY: number;
  slotInX: number;
  slotOutX: number;
  cardHeight: number;
}

interface SideRoundLayout {
  round: number;
  title: string;
  side: Exclude<BracketSide, 'CENTER'>;
  columnX: number;
  matches: MatchLayout[];
}

interface ConnectorEdge {
  id: string;
  fromMatchId: number;
  toMatchId: number;
  path: string;
  completed: boolean;
  live: boolean;
}

interface PlayerPath {
  matchIds: Set<number>;
}

interface BracketVm {
  leftRounds: SideRoundLayout[];
  rightRounds: SideRoundLayout[];
  finalMatch: MatchLayout | null;
  edges: ConnectorEdge[];
  width: number;
  height: number;
}

@Component({
  selector: 'app-tournament-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './tournament-detail.component.html',
  styleUrl: './tournament-detail.component.scss'
})
export class TournamentDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tournamentService = inject(TournamentService);
  private readonly toastService = inject(ToastService);

  private readonly sideCardWidth = 300;
  private readonly sideCardHeight = 144;
  private readonly finalCardWidth = 360;
  private readonly finalCardHeight = 160;
  private readonly roundGap = 156;
  private readonly centerGap = 124;
  private readonly verticalUnit = 136;
  private readonly sidePadding = 84;
  private readonly topPadding = 56;
  private readonly slotDeltaY = 28;

  private panningPointerId: number | null = null;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;

  readonly tournament = signal<TournamentDetail | null>(null);
  readonly isLoading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);
  readonly currentUserId = signal<number | null>(null);
  readonly hoveredPlayerId = signal<number | null>(null);
  readonly acceptingMatchId = signal<number | null>(null);

  readonly zoom = signal(1);
  readonly panX = signal(18);
  readonly panY = signal(12);
  readonly isPanning = signal(false);
  readonly commandPanelCollapsed = signal<boolean>(false);
  readonly contextPanelCollapsed = signal<boolean>(false);

  readonly participantsById = computed(() => {
    const map = new Map<number, TournamentParticipant>();
    for (const participant of this.tournament()?.participants ?? []) {
      map.set(participant.userId, participant);
    }
    return map;
  });

  readonly rounds = computed<BracketRound[]>(() => {
    const matches = this.tournament()?.matches ?? [];
    const byRound = new Map<number, TournamentMatch[]>();

    matches.forEach(match => {
      const list = byRound.get(match.roundNumber) ?? [];
      list.push(match);
      byRound.set(match.roundNumber, list);
    });

    return Array.from(byRound.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([round, roundMatches]) => ({
        round,
        title: roundMatches.length === 1 ? 'Gran Final' : `Ronda ${round}`,
        matches: roundMatches.sort((a, b) => a.matchNumber - b.matchNumber)
      }));
  });

  readonly hoveredPath = computed<PlayerPath>(() => this.computePlayerPath(this.hoveredPlayerId()));
  readonly currentUserPath = computed<PlayerPath>(() => this.computePlayerPath(this.currentUserId()));
  readonly liveMatches = computed(() => (this.tournament()?.matches ?? []).filter(match => match.status === 'PLAYING'));
  readonly finishedMatches = computed(() => (this.tournament()?.matches ?? []).filter(match => match.status === 'FINISHED'));

  readonly bracketVm = computed<BracketVm>(() => {
    const rounds = this.rounds();
    const empty: BracketVm = {
      leftRounds: [],
      rightRounds: [],
      finalMatch: null,
      edges: [],
      width: this.sidePadding * 2 + this.sideCardWidth,
      height: this.topPadding * 2 + this.sideCardHeight
    };

    if (!rounds.length) {
      return empty;
    }

    const hasFinal = rounds[rounds.length - 1].matches.length === 1;
    const finalRound = hasFinal ? rounds[rounds.length - 1] : null;
    const sideRounds = hasFinal ? rounds.slice(0, -1) : rounds;

    if (!sideRounds.length) {
      const soloMatch = finalRound?.matches[0] ?? rounds[0].matches[0];
      if (!soloMatch) {
        return empty;
      }
      const centerX = this.sidePadding + this.finalCardWidth / 2;
      const cardHeight = this.cardHeightFor(soloMatch, true);
      const cardY = this.topPadding;
      return {
        leftRounds: [],
        rightRounds: [],
        finalMatch: {
          match: soloMatch,
          side: 'CENTER',
          roundNumber: soloMatch.roundNumber,
          roundIndex: 0,
          slotIndex: 0,
          centerY: cardY + cardHeight / 2,
          cardX: centerX - this.finalCardWidth / 2,
          cardY,
          slotTopY: this.playerSlotY(cardY, soloMatch, 1, true),
          slotBottomY: this.playerSlotY(cardY, soloMatch, 2, true),
          slotInX: centerX - this.finalCardWidth / 2,
          slotOutX: centerX + this.finalCardWidth / 2,
          cardHeight
        },
        edges: [],
        width: this.sidePadding * 2 + this.finalCardWidth,
        height: this.topPadding * 2 + cardHeight
      };
    }

    const sideColumns = sideRounds.length;
    const width =
      this.sidePadding * 2 +
      sideColumns * this.sideCardWidth * 2 +
      Math.max(0, sideColumns - 1) * this.roundGap * 2 +
      this.centerGap * 2 +
      this.finalCardWidth;

    const firstRoundMatches = Math.max(sideRounds[0].matches.length, 1);
    const height = this.topPadding * 2 + Math.max(2, firstRoundMatches * 2) * this.verticalUnit;

    const finalX = (width - this.finalCardWidth) / 2;

    const leftRounds: SideRoundLayout[] = [];
    const rightRounds: SideRoundLayout[] = [];
    const edges: ConnectorEdge[] = [];

    const leftLookup = new Map<string, MatchLayout>();
    const rightLookup = new Map<string, MatchLayout>();

    sideRounds.forEach((round, roundIndex) => {
      const leftCount = Math.ceil(round.matches.length / 2);
      const leftMatchesRaw = round.matches.slice(0, leftCount);
      const rightMatchesRaw = round.matches.slice(leftCount);

      const leftColumnX = this.sidePadding + roundIndex * (this.sideCardWidth + this.roundGap);
      const rightColumnX = width - this.sidePadding - this.sideCardWidth - roundIndex * (this.sideCardWidth + this.roundGap);

      const leftMatches = leftMatchesRaw.map((match, slotIndex) => {
        const centerY = this.centerYFor(roundIndex, slotIndex);
        const cardHeight = this.cardHeightFor(match);
        const cardY = centerY - cardHeight / 2;
        const layout: MatchLayout = {
          match,
          side: 'LEFT',
          roundNumber: round.round,
          roundIndex,
          slotIndex,
          centerY,
          cardX: leftColumnX,
          cardY,
          slotTopY: this.playerSlotY(cardY, match, 1),
          slotBottomY: this.playerSlotY(cardY, match, 2),
          slotInX: leftColumnX,
          slotOutX: leftColumnX + this.sideCardWidth,
          cardHeight
        };
        leftLookup.set(`LEFT:${roundIndex}:${slotIndex}`, layout);
        return layout;
      });

      const rightMatches = rightMatchesRaw.map((match, slotIndex) => {
        const centerY = this.centerYFor(roundIndex, slotIndex);
        const cardHeight = this.cardHeightFor(match);
        const cardY = centerY - cardHeight / 2;
        const layout: MatchLayout = {
          match,
          side: 'RIGHT',
          roundNumber: round.round,
          roundIndex,
          slotIndex,
          centerY,
          cardX: rightColumnX,
          cardY,
          slotTopY: this.playerSlotY(cardY, match, 1),
          slotBottomY: this.playerSlotY(cardY, match, 2),
          slotInX: rightColumnX + this.sideCardWidth,
          slotOutX: rightColumnX,
          cardHeight
        };
        rightLookup.set(`RIGHT:${roundIndex}:${slotIndex}`, layout);
        return layout;
      });

      leftRounds.push({
        round: round.round,
        title: round.title,
        side: 'LEFT',
        columnX: leftColumnX,
        matches: leftMatches
      });

      rightRounds.push({
        round: round.round,
        title: round.title,
        side: 'RIGHT',
        columnX: rightColumnX,
        matches: rightMatches
      });
    });

    for (const round of leftRounds) {
      for (const source of round.matches) {
        const targetSlotIndex = Math.floor(source.slotIndex / 2);
        const target = leftLookup.get(`LEFT:${source.roundIndex + 1}:${targetSlotIndex}`);
        if (!target) {
          continue;
        }
        const branch = source.slotIndex % 2 === 0 ? 'TOP' : 'BOTTOM';
        const targetY = branch === 'TOP' ? target.slotTopY : target.slotBottomY;
        edges.push({
          id: `L-${source.roundNumber}-${source.slotIndex}->${target.roundNumber}-${target.slotIndex}`,
          fromMatchId: source.match.id,
          toMatchId: target.match.id,
          completed: source.match.winnerId != null,
          live: source.match.status === 'PLAYING' || target.match.status === 'PLAYING',
          path: this.orthogonalPath(source.slotOutX, source.centerY, target.slotInX, targetY)
        });
      }
    }

    for (const round of rightRounds) {
      for (const source of round.matches) {
        const targetSlotIndex = Math.floor(source.slotIndex / 2);
        const target = rightLookup.get(`RIGHT:${source.roundIndex + 1}:${targetSlotIndex}`);
        if (!target) {
          continue;
        }
        const branch = source.slotIndex % 2 === 0 ? 'TOP' : 'BOTTOM';
        const targetY = branch === 'TOP' ? target.slotTopY : target.slotBottomY;
        edges.push({
          id: `R-${source.roundNumber}-${source.slotIndex}->${target.roundNumber}-${target.slotIndex}`,
          fromMatchId: source.match.id,
          toMatchId: target.match.id,
          completed: source.match.winnerId != null,
          live: source.match.status === 'PLAYING' || target.match.status === 'PLAYING',
          path: this.orthogonalPath(source.slotOutX, source.centerY, target.slotInX, targetY)
        });
      }
    }

    let finalMatch: MatchLayout | null = null;
    if (finalRound?.matches[0]) {
      const final = finalRound.matches[0];
      const finalRoundIndex = rounds.length - 1;
      const finalCenterY = this.centerYFor(finalRoundIndex, 0);
      const cardHeight = this.cardHeightFor(final, true);
      const cardY = finalCenterY - cardHeight / 2;
      finalMatch = {
        match: final,
        side: 'CENTER',
        roundNumber: final.roundNumber,
        roundIndex: finalRoundIndex,
        slotIndex: 0,
        centerY: finalCenterY,
        cardX: finalX,
        cardY,
        slotTopY: this.playerSlotY(cardY, final, 1, true),
        slotBottomY: this.playerSlotY(cardY, final, 2, true),
        slotInX: finalX,
        slotOutX: finalX + this.finalCardWidth,
        cardHeight
      };

      const leftChampion = leftRounds[leftRounds.length - 1]?.matches[0];
      const rightChampion = rightRounds[rightRounds.length - 1]?.matches[0];

      if (leftChampion) {
        edges.push({
          id: `L-FINAL-${leftChampion.match.id}`,
          fromMatchId: leftChampion.match.id,
          toMatchId: final.id,
          completed: leftChampion.match.winnerId != null,
          live: leftChampion.match.status === 'PLAYING' || final.status === 'PLAYING',
          path: this.orthogonalPath(leftChampion.slotOutX, leftChampion.centerY, finalMatch.slotInX, finalMatch.slotTopY)
        });
      }

      if (rightChampion) {
        const finalRightInX = finalMatch.cardX + this.finalCardWidth;
        edges.push({
          id: `R-FINAL-${rightChampion.match.id}`,
          fromMatchId: rightChampion.match.id,
          toMatchId: final.id,
          completed: rightChampion.match.winnerId != null,
          live: rightChampion.match.status === 'PLAYING' || final.status === 'PLAYING',
          path: this.orthogonalPath(rightChampion.slotOutX, rightChampion.centerY, finalRightInX, finalMatch.slotBottomY)
        });
      }
    }

    return {
      leftRounds,
      rightRounds,
      finalMatch,
      edges,
      width,
      height
    };
  });

  private orthogonalPath(startX: number, startY: number, endX: number, endY: number): string {
    const cornerOffset = 10; // small offset to keep little spacing for rounded corners
    const midX = (startX + endX) / 2;

    // route: start -> horizontal to mid area -> vertical to target Y -> horizontal to end
    const h1 = midX - cornerOffset;
    const h2 = midX + cornerOffset;

    // Build path commands
    // Use H and V for orthogonal routing; stroke-linejoin: round in CSS will round corners
    const parts: string[] = [];
    parts.push(`M ${startX} ${startY}`);
    // move horizontally to h1
    parts.push(`H ${h1}`);
    // vertical to endY
    parts.push(`V ${endY}`);
    // horizontal to endX
    parts.push(`H ${endX}`);

    return parts.join(' ');
  }

  ngOnInit(): void {
    this.loadCurrentUser();
    this.route.params.subscribe(params => {
      const id = Number(params['id']);
      if (!Number.isFinite(id)) {
        this.errorMessage.set('ID de torneo invalido');
        return;
      }
      this.fetchTournament(id);
    });
  }

  fetchTournament(id: number): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.tournamentService.getTournament(id).subscribe({
      next: data => {
        this.tournament.set(data);
        this.isLoading.set(false);
      },
      error: err => {
        this.errorMessage.set(err?.error?.message || 'No se pudo cargar el torneo');
        this.isLoading.set(false);
      }
    });
  }

  reportWin(matchId: number, winnerId: number): void {
    this.tournamentService.reportMatch(matchId, { winnerId }).subscribe({
      next: () => {
        this.toastService.show('Resultado reportado correctamente', 'success');
        this.hoveredPlayerId.set(null);
        const tournamentId = this.tournament()?.id;
        if (tournamentId) {
          this.fetchTournament(tournamentId);
        }
      },
      error: err => {
        this.toastService.show(err?.error?.message || 'No se pudo reportar el resultado', 'error');
        if (err?.status === 403) {
          this.toastService.show('Match marcado en revision por intento de reporte no autorizado', 'warning');
        }
      }
    });
  }

  acceptTournamentMatch(match: TournamentMatch): void {
    if (match.battleMatchId) {
      this.router.navigateByUrl(`/battle/${match.battleMatchId}`);
      return;
    }

    if (!this.canAcceptTournamentMatch(match)) {
      return;
    }

    this.acceptingMatchId.set(match.id);
    this.tournamentService.acceptTournamentMatch(match.id).subscribe({
      next: result => {
        this.acceptingMatchId.set(null);

        if (result.ready && result.battleMatchId) {
          this.toastService.show('Ambos jugadores listos. Entrando a la arena...', 'success');
          this.router.navigateByUrl(result.link || `/battle/${result.battleMatchId}`);
          return;
        }

        this.toastService.show('Listo confirmado. Esperando al rival...', 'info');
        const tournamentId = this.tournament()?.id;
        if (tournamentId) {
          this.fetchTournament(tournamentId);
        }
      },
      error: err => {
        this.acceptingMatchId.set(null);
        this.toastService.show(err?.error?.message || 'No se pudo confirmar el match de torneo', 'error');
      }
    });
  }

  toggleCommandPanel(): void {
    this.commandPanelCollapsed.update(value => !value);
  }

  toggleContextPanel(): void {
    this.contextPanelCollapsed.update(value => !value);
  }

  activeArenaAccent(): string {
    const status = this.tournament()?.status;
    switch (status) {
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

  userName(userId: number | null): string {
    if (!userId) return 'BYE';
    const participant = this.participantsById().get(userId);
    if (!participant) return `Jugador #${userId}`;
    return participant.displayName || participant.username;
  }

  userInitials(userId: number | null): string {
    const label = this.userName(userId);
    if (!label || label === 'BYE') {
      return 'BY';
    }
    const tokens = label.split(/[\s_-]+/).filter(Boolean);
    const initials = tokens.slice(0, 2).map(token => token[0]?.toUpperCase() ?? '').join('');
    return initials || label.slice(0, 2).toUpperCase();
  }

  userDeckName(userId: number | null): string {
    if (!userId) return 'BYE';
    return this.participantsById().get(userId)?.deckName || 'Mazo oculto';
  }

  participantRecord(userId: number | null): string {
    if (!userId) {
      return '0-0';
    }

    let wins = 0;
    let losses = 0;
    for (const match of this.tournament()?.matches ?? []) {
      const played = match.player1Id === userId || match.player2Id === userId;
      if (!played || !match.winnerId) {
        continue;
      }
      if (match.winnerId === userId) {
        wins++;
      } else {
        losses++;
      }
    }
    return `${wins}-${losses}`;
  }

  isCurrentUser(userId: number | null): boolean {
    return !!userId && !!this.currentUserId() && userId === this.currentUserId();
  }

  isWinner(match: TournamentMatch, userId: number | null): boolean {
    return !!userId && !!match.winnerId && match.winnerId === userId;
  }

  isLoser(match: TournamentMatch, userId: number | null): boolean {
    return !!userId && !!match.winnerId && match.winnerId !== userId;
  }

  isPlaying(match: TournamentMatch): boolean {
    return match.status === 'PLAYING';
  }

  setHoveredPlayer(userId: number | null): void {
    this.hoveredPlayerId.set(userId);
  }

  isMatchPathActive(matchId: number): boolean {
    return this.hoveredPath().matchIds.has(matchId) || this.currentUserPath().matchIds.has(matchId);
  }

  isEdgeActive(edge: ConnectorEdge): boolean {
    const hovered = this.hoveredPath().matchIds;
    const current = this.currentUserPath().matchIds;
    const inHovered = hovered.has(edge.fromMatchId) && hovered.has(edge.toMatchId);
    const inCurrent = current.has(edge.fromMatchId) && current.has(edge.toMatchId);
    return inHovered || inCurrent;
  }

  isDimmedByHover(match: TournamentMatch, userId: number | null): boolean {
    const hovered = this.hoveredPlayerId();
    if (!hovered || !userId) {
      return false;
    }
    return hovered !== userId && (match.player1Id === userId || match.player2Id === userId);
  }

  rowBadge(match: TournamentMatch, userId: number | null): string {
    if (!userId) return '--';
    if (this.isWinner(match, userId)) return 'W';
    if (this.isLoser(match, userId)) return 'L';
    return '--';
  }

  canReport(match: TournamentMatch): boolean {
    if (match.status === 'FINISHED' || match.status === 'REVIEW') {
      return false;
    }

    if (match.status === 'PLAYING' || match.battleMatchId) {
      return false;
    }

    const current = this.currentUserId();
    if (!current) {
      return false;
    }

    return match.player1Id === current || match.player2Id === current;
  }

  canShowMatchAction(match: TournamentMatch): boolean {
    const current = this.currentUserId();
    return !!current
      && (match.player1Id === current || match.player2Id === current)
      && match.status !== 'FINISHED'
      && match.status !== 'REVIEW';
  }

  canAcceptTournamentMatch(match: TournamentMatch): boolean {
    if (!this.canShowMatchAction(match) || match.battleMatchId) {
      return false;
    }

    return !this.currentUserAccepted(match);
  }

  currentUserAccepted(match: TournamentMatch): boolean {
    const current = this.currentUserId();
    if (!current) {
      return false;
    }

    if (match.player1Id === current) {
      return match.player1Accepted === true;
    }

    if (match.player2Id === current) {
      return match.player2Accepted === true;
    }

    return false;
  }

  matchActionLabel(match: TournamentMatch): string {
    if (this.acceptingMatchId() === match.id) {
      return 'Confirmando';
    }

    if (match.battleMatchId) {
      return 'Entrar';
    }

    if (this.currentUserAccepted(match)) {
      return 'Esperando rival';
    }

    return 'Listo';
  }

  isMatchActionDisabled(match: TournamentMatch): boolean {
    return this.acceptingMatchId() === match.id
      || (!match.battleMatchId && !this.canAcceptTournamentMatch(match));
  }

  canReportForWinner(match: TournamentMatch, winnerId: number | null): boolean {
    if (!winnerId || !this.canReport(match)) {
      return false;
    }
    return winnerId === match.player1Id || winnerId === match.player2Id;
  }

  zoomIn(): void {
    this.zoom.set(Math.min(2.4, this.zoom() + 0.12));
  }

  zoomOut(): void {
    this.zoom.set(Math.max(0.55, this.zoom() - 0.12));
  }

  resetView(): void {
    this.zoom.set(1);
    this.panX.set(18);
    this.panY.set(12);
  }

  onViewportWheel(event: WheelEvent): void {
    event.preventDefault();
    const container = event.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();

    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    const prevZoom = this.zoom();
    const nextZoom = event.deltaY < 0 ? Math.min(2.4, prevZoom * 1.1) : Math.max(0.55, prevZoom * 0.9);

    if (nextZoom === prevZoom) {
      return;
    }

    const worldX = (pointerX - this.panX()) / prevZoom;
    const worldY = (pointerY - this.panY()) / prevZoom;

    this.zoom.set(nextZoom);
    this.panX.set(pointerX - worldX * nextZoom);
    this.panY.set(pointerY - worldY * nextZoom);
  }

  onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    const interactiveTarget = event.target as HTMLElement | null;
    if (interactiveTarget?.closest('button, a, input, select, textarea')) {
      return;
    }

    this.panningPointerId = event.pointerId;
    this.isPanning.set(true);
    this.panStartX = event.clientX;
    this.panStartY = event.clientY;
    this.panOriginX = this.panX();
    this.panOriginY = this.panY();

    const canvasTarget = event.currentTarget as HTMLElement;
    canvasTarget.setPointerCapture(event.pointerId);
  }

  onCanvasPointerMove(event: PointerEvent): void {
    if (!this.isPanning() || this.panningPointerId !== event.pointerId) {
      return;
    }

    this.panX.set(this.panOriginX + (event.clientX - this.panStartX));
    this.panY.set(this.panOriginY + (event.clientY - this.panStartY));
  }

  onCanvasPointerUp(event: PointerEvent): void {
    if (this.panningPointerId !== event.pointerId) {
      return;
    }

    this.isPanning.set(false);
    this.panningPointerId = null;
  }

  statusPill(status: TournamentStatus): string {
    switch (status) {
      case 'PENDING':
        return 'Inscripcion abierta';
      case 'ACTIVE':
        return 'En curso';
      case 'COMPLETED':
        return 'Finalizado';
      default:
        return status;
    }
  }

  matchStatusLabel(status: TournamentMatch['status']): string {
    switch (status) {
      case 'PENDING':
        return 'Pendiente';
      case 'PLAYING':
        return 'LIVE';
      case 'FINISHED':
        return 'Finalizado';
      case 'REVIEW':
        return 'Revision';
      default:
        return status;
    }
  }

  private centerYFor(roundIndex: number, slotIndex: number): number {
    return this.topPadding + this.verticalUnit * Math.pow(2, roundIndex) * (2 * slotIndex + 1);
  }

  private cardHeightFor(match: TournamentMatch, final = false): number {
    const base = final ? this.finalCardHeight : this.sideCardHeight;
    return match.status === 'PLAYING' ? base + 30 : base;
  }

  private playerSlotY(cardY: number, match: TournamentMatch, row: 1 | 2, final = false): number {
    const liveOffset = match.status === 'PLAYING' ? 24 : 0;
    const firstRowCenter = final ? 66 : 58;
    const rowGap = final ? 50 : 43;
    return cardY + firstRowCenter + liveOffset + (row === 2 ? rowGap : 0);
  }

  private computePlayerPath(playerId: number | null): PlayerPath {
    const empty: PlayerPath = { matchIds: new Set<number>() };
    if (!playerId) {
      return empty;
    }

    const rounds = this.rounds().slice().sort((a, b) => a.round - b.round);
    if (!rounds.length) {
      return empty;
    }

    const firstRoundWithPlayer = rounds.findIndex(round =>
      round.matches.some(match => match.player1Id === playerId || match.player2Id === playerId)
    );

    if (firstRoundWithPlayer === -1) {
      return empty;
    }

    const matchIds = new Set<number>();

    for (let roundIndex = firstRoundWithPlayer; roundIndex < rounds.length; roundIndex++) {
      const round = rounds[roundIndex];
      const playerMatch: TournamentMatch | undefined = round.matches.find(
        match => match.player1Id === playerId || match.player2Id === playerId
      );

      if (!playerMatch) {
        break;
      }

      matchIds.add(playerMatch.id);

      if (playerMatch.winnerId !== playerId) {
        break;
      }
    }

    return { matchIds };
  }

  private loadCurrentUser(): void {
    const raw = localStorage.getItem('user');
    if (!raw) {
      this.currentUserId.set(null);
      return;
    }

    try {
      const user = JSON.parse(raw);
      this.currentUserId.set(Number(user?.id));
    } catch {
      this.currentUserId.set(null);
    }
  }
}

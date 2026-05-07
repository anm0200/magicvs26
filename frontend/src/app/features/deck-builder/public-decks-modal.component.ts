import { Component, EventEmitter, inject, OnInit, Output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeckBuilderService } from '../../core/services/deck-builder.service';

function sortDecksAlpha(a: { name: string; averageCmc: number }, b: { name: string; averageCmc: number }): number {
  const nameCompare = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  return nameCompare !== 0 ? nameCompare : (a.averageCmc || 0) - (b.averageCmc || 0);
}

interface PublicDeck {
  id: number;
  name: string;
  format: string;
  totalCards: number;
  updatedAt: string;
  isPublic: boolean;
  mainImageUrl: string | null;
  cardNames: string[];
  averageCmc: number;
  colorIdentity: string[];
}

interface PreviewCard {
  cardId: number;
  cardName: string;
  cardImage: string;
  backCardImage?: string;
  doubleFaced?: boolean;
  manaCost: string;
  cardType: string;
  quantity: number;
}

interface PreviewDeck {
  id: number;
  name: string;
  description: string;
  format: string;
  totalCards: number;
  cards: PreviewCard[];
}

@Component({
  selector: 'app-public-decks-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './public-decks-modal.html',
  styleUrls: ['./public-decks-modal.scss']
})
export class PublicDecksModalComponent implements OnInit {
  @Output() close = new EventEmitter<void>();
  @Output() deckCopied = new EventEmitter<{ deckId: number; deckName: string }>();

  private deckService = inject(DeckBuilderService);

  decks = signal<PublicDeck[]>([]);
  loading = signal(true);
  loadError = signal<string | null>(null);
  copyError = signal<string | null>(null);
  searchQuery = signal('');
  copyingId = signal<number | null>(null);
  copiedIds = signal<Set<number>>(new Set());
  activeColors = signal<string[]>([]);

  selectedDeck = signal<PublicDeck | null>(null);
  previewData = signal<PreviewDeck | null>(null);
  loadingPreview = signal(false);

  private static readonly LOW_MANA_KEYWORDS  = ['poco maná', 'poco mana', 'bajo maná', 'bajo mana', 'bajo coste', 'aggro', 'rapido', 'rápido', 'low mana', 'low cost'];
  private static readonly HIGH_MANA_KEYWORDS = ['mucho maná', 'mucho mana', 'alto maná', 'alto mana', 'alto coste', 'control', 'lento', 'high mana', 'high cost'];
  private static readonly MID_MANA_KEYWORDS  = ['midrange', 'medio maná', 'medio mana', 'mid mana'];

  readonly filteredDecks = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const colors = this.activeColors();

    const isLow  = !!q && PublicDecksModalComponent.LOW_MANA_KEYWORDS.some(k => q.includes(k));
    const isHigh = !!q && PublicDecksModalComponent.HIGH_MANA_KEYWORDS.some(k => q.includes(k));
    const isMid  = !!q && PublicDecksModalComponent.MID_MANA_KEYWORDS.some(k => q.includes(k));

    return this.decks().filter(deck => {
      // Color filter: colorless decks always shown; otherwise all selected colors must be present (AND)
      if (colors.length > 0) {
        const deckColors = deck.colorIdentity ?? [];
        if (deckColors.length > 0 && !colors.every(c => deckColors.includes(c))) return false;
      }

      if (!q) return true;

      const cmc = deck.averageCmc ?? 0;
      if (isLow)  return cmc <= 2.0;
      if (isHigh) return cmc >= 3.5;
      if (isMid)  return cmc > 2.0 && cmc < 3.5;

      const matchesName = deck.name.toLowerCase().includes(q);
      const matchesCard = (deck.cardNames ?? []).some(cn => cn.toLowerCase().includes(q));
      return matchesName || matchesCard;
    }).sort(sortDecksAlpha);
  });

  readonly manaCurveLabel = computed(() => {
    const deck = this.selectedDeck();
    if (!deck) return '';
    const cmc = deck.averageCmc ?? 0;
    if (cmc <= 2.0)  return 'Aggro (bajo maná)';
    if (cmc >= 3.5)  return 'Control (alto maná)';
    return 'Midrange';
  });

  readonly groupedPreviewCards = computed(() => {
    const data = this.previewData();
    if (!data) return [];
    const groups = new Map<string, PreviewCard[]>();
    data.cards.forEach(card => {
      const g = this.resolveTypeGroup(card.cardType);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(card);
    });
    return Array.from(groups.entries())
      .map(([group, cards]) => ({ group, cards: cards.sort((a, b) => a.cardName.localeCompare(b.cardName)) }))
      .sort((a, b) => a.group.localeCompare(b.group));
  });

  ngOnInit(): void {
    this.deckService.getPublicDecks().subscribe({
      next: (data: PublicDeck[]) => {
        this.decks.set([...data].sort(sortDecksAlpha));
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('No se pudieron cargar los mazos públicos.');
        this.loading.set(false);
      }
    });
  }


  readonly manaColors = ['W', 'U', 'B', 'R', 'G'] as const;

  private static readonly MANA_LABEL: Record<string, string> = {
    W: 'Blanco', U: 'Azul', B: 'Negro', R: 'Rojo', G: 'Verde'
  };

  private static readonly MANA_ACTIVE_CLASS: Record<string, string> = {
    W: 'border-amber-300 bg-amber-300/15 text-amber-200 shadow-[0_0_10px_rgba(251,191,36,0.3)]',
    U: 'border-sky-400 bg-sky-400/15 text-sky-200 shadow-[0_0_10px_rgba(56,189,248,0.3)]',
    B: 'border-violet-400 bg-violet-400/15 text-violet-200 shadow-[0_0_10px_rgba(167,139,250,0.3)]',
    R: 'border-rose-400 bg-rose-400/15 text-rose-200 shadow-[0_0_10px_rgba(251,113,133,0.3)]',
    G: 'border-emerald-400 bg-emerald-400/15 text-emerald-200 shadow-[0_0_10px_rgba(52,211,153,0.3)]',
    C: 'border-slate-400 bg-slate-400/15 text-slate-200 shadow-[0_0_10px_rgba(148,163,184,0.3)]',
  };

  private static readonly MANA_PIP_CLASS: Record<string, string> = {
    W: 'bg-amber-300/80 text-amber-900',
    U: 'bg-sky-400/80 text-sky-900',
    B: 'bg-violet-400/80 text-white',
    R: 'bg-rose-400/80 text-white',
    G: 'bg-emerald-400/80 text-emerald-900',
    C: 'bg-slate-400/80 text-white',
  };

  getManaActiveClass(color: string): string {
    return PublicDecksModalComponent.MANA_ACTIVE_CLASS[color] ?? '';
  }

  getManaPipClass(color: string): string {
    return PublicDecksModalComponent.MANA_PIP_CLASS[color] ?? '';
  }

  getManaTitle(color: string): string {
    return PublicDecksModalComponent.MANA_LABEL[color] ?? color;
  }

  toggleColor(color: string): void {
    this.activeColors.update(current =>
      current.includes(color) ? current.filter(c => c !== color) : [...current, color]
    );
  }

  clearColors(): void {
    this.activeColors.set([]);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
  }

  selectDeck(deck: PublicDeck): void {
    if (this.selectedDeck()?.id === deck.id) return;
    this.selectedDeck.set(deck);
    this.loadPreview(deck.id);
  }

  retryPreview(): void {
    const deck = this.selectedDeck();
    if (deck) this.loadPreview(deck.id);
  }

  private loadPreview(deckId: number): void {
    this.previewData.set(null);
    this.loadingPreview.set(true);

    this.deckService.getDeckById(deckId).subscribe({
      next: (data: PreviewDeck) => {
        this.previewData.set(data);
        this.loadingPreview.set(false);
      },
      error: () => {
        this.loadingPreview.set(false);
      }
    });
  }

  copyDeck(deck: PublicDeck): void {
    if (this.copyingId() !== null) return;
    this.copyingId.set(deck.id);
    this.copyError.set(null);

    this.deckService.copyDeck(deck.id).subscribe({
      next: () => {
        this.copiedIds.update(ids => new Set([...ids, deck.id]));
        this.copyingId.set(null);
        this.deckCopied.emit({ deckId: deck.id, deckName: deck.name });
      },
      error: (err) => {
        this.copyingId.set(null);
        this.copyError.set(
          err.status === 401 ? 'Debes iniciar sesión para guardar mazos' : 'Error al guardar el mazo'
        );
      }
    });
  }

  isCopied(deckId: number): boolean {
    return this.copiedIds().has(deckId);
  }

  getManaLabel(cmc: number): string {
    if (cmc <= 2.0) return 'Bajo';
    if (cmc >= 3.5) return 'Alto';
    return 'Medio';
  }

  getManaClass(cmc: number): string {
    if (cmc <= 2.0) return 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10';
    if (cmc >= 3.5) return 'text-rose-300 border-rose-400/40 bg-rose-500/10';
    return 'text-amber-300 border-amber-400/40 bg-amber-500/10';
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.close.emit();
    }
  }

  private resolveTypeGroup(typeLine: string): string {
    const n = (typeLine || '').toLowerCase();
    if (n.includes('creature') || n.includes('criatura')) return 'Criaturas';
    if (n.includes('instant') || n.includes('instantáneo')) return 'Instantáneos';
    if (n.includes('sorcery') || n.includes('conjuro')) return 'Conjuros';
    if (n.includes('enchantment') || n.includes('encantamiento')) return 'Encantamientos';
    if (n.includes('artifact') || n.includes('artefacto')) return 'Artefactos';
    if (n.includes('planeswalker')) return 'Planeswalkers';
    if (n.includes('land') || n.includes('tierra')) return 'Tierras';
    return 'Otros';
  }
}

import { Component, OnInit, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardService, CardPage } from '../../core/services/card.service';
import { Card } from '../../models/card.model';
import { computed } from '@angular/core';

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss'
})
export class CatalogComponent implements OnInit {
  private cardService = inject(CardService);
  
  // Data Signals
  cardPage = signal<CardPage | null>(null);
  isLoading = signal(true);

  // Pagination signals
  currentPage = signal(0);
  totalPages = signal(0);

  // Filter signals
  activeMana = signal<string | null>(null);
  activeType = signal('Tipo');
  activeRarity = signal('Rareza');
  searchQuery = signal('');

  filteredCards = computed(() => {
    const pageData = this.cardPage();
    // Importante: Verifica si 'content' es el nombre correcto en tu CardPage
    const cards = pageData?.cards || []; 
    
    const query = this.searchQuery().toLowerCase().trim();
    const type = this.activeType();
    const rarity = this.activeRarity();
    const mana = this.activeMana();

    return cards.filter(card => {
      // 1. Filtro por texto
      const matchesQuery = !query || 
        card.name.toLowerCase().includes(query) || 
        (card.name && card.name.toLowerCase().includes(query)) || 
        (card.type && card.type.toLowerCase().includes(query)) ||
        (card.oracleText && card.oracleText.toLowerCase().includes(query));

      // 2. Filtro por Dropdown de Tipo
      const matchesType = type === 'Tipo' || card.type === type;

      // 3. Filtro por Dropdown de Rareza
      const matchesRarity = rarity === 'Rareza' || card.rarity === rarity;

      // 4. Filtro por Maná
      const matchesMana = !mana || card.manaCost?.includes(mana);

      return matchesQuery && matchesType && matchesRarity && matchesMana;
    });
  });

  // Dropdown visibility signals
  showTypeDropdown = signal(false);
  showRarityDropdown = signal(false);
  ngOnInit(): void {
    this.loadCards();
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.dropdown-trigger')) {
      this.showTypeDropdown.set(false);
      this.showRarityDropdown.set(false);
    }
  }

  onSearch(event: any): void {
    const value = event.target.value;
    this.searchQuery.set(value);
    this.currentPage.set(0); 
    this.loadCards(0);
  }

  toggleMana(mana: string): void {
    this.activeMana.update(current => current === mana ? null : mana);
  }

  selectType(type: string): void {
    this.activeType.set(type);
    this.showTypeDropdown.set(false);
  }

  selectRarity(rarity: string): void {
    this.activeRarity.set(rarity);
    this.showRarityDropdown.set(false);
  }

  resetFilters(): void {
    this.activeMana.set(null);
    this.activeType.set('Tipo');
    this.activeRarity.set('Rareza');
    this.searchQuery.set('');
  }

  loadCards(page = 0): void {
    this.isLoading.set(true);
    this.cardService.getCards(page).subscribe({
      next: (data) => {
        this.cardPage.set(data);
        this.currentPage.set(data.currentPage);
        this.totalPages.set(data.totalPages);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading cards:', err);
        this.isLoading.set(false);
      }
    });
  }

  nextPage(): void {
    const next = this.currentPage() + 1;
    if (next < this.totalPages()) {
      this.loadCards(next);
    }
  }

  prevPage(): void {
    const prev = this.currentPage() - 1;
    if (prev >= 0) {
      this.loadCards(prev);
    }
  }

  goToPage(page: number | string): void {
    const pageNum = typeof page === 'string' ? parseInt(page, 10) : page;
    if (isNaN(pageNum) || pageNum < 0 || pageNum >= this.totalPages()) {
      return;
    }
    this.loadCards(pageNum);
  }

  getManaCostString(manaCost: string[]): string {
    return manaCost.join('');
  }
}
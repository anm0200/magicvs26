import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MetaDeck } from '../../models/meta-deck.model';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-meta',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './meta.html',
  styleUrls: ['./meta.scss']
})
export class MetaComponent implements OnInit {
  decks: MetaDeck[] = [];
  loading: boolean = true;
  error: string | null = null;
  syncing: boolean = false;

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadMetagame();
  }

  loadMetagame(): void {
    this.loading = true;
    this.error = null;
    this.http.get<MetaDeck[]>('http://localhost:8080/api/meta').subscribe({
      next: (data) => {
        // Parse JSON strings to real arrays
        this.decks = data.map(deck => {
          try {
            deck.colors = deck.colorsJson ? JSON.parse(deck.colorsJson) : [];
          } catch(e) { deck.colors = []; }
          
          try {
            deck.gallery = deck.galleryJson ? JSON.parse(deck.galleryJson) : [];
          } catch(e) { deck.gallery = []; }
          
          try {
            deck.mainboard = deck.mainboardJson ? JSON.parse(deck.mainboardJson) : [];
          } catch(e) { deck.mainboard = []; }
          
          deck.showFullList = false;
          // Force expanded state by default to show those beautiful cards immediately!
          deck.isExpanded = true; 
          return deck;
        });
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error fetching metagame:', error);
        this.error = 'No se pudo cargar el metajuego en este momento. Inténtalo más tarde.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  syncMetagame(): void {
    this.syncing = true;

    this.http.post('http://localhost:8080/api/meta/sync', {}, { responseType: 'text' }).subscribe({
      next: () => {
        // Recargar datos tras la recarga exitosa
        this.loadMetagame();
        this.syncing = false;
        this.cdr.detectChanges();
      },
      error: () => {
        alert('Fallo al sincronizar. Asegúrate de que el Backend está encendido.');
        this.syncing = false;
        this.cdr.detectChanges();
      }
    });
  }

  toggleExpand(deck: MetaDeck): void {
    deck.isExpanded = !deck.isExpanded;
  }

  toggleFullList(deck: MetaDeck): void {
    deck.showFullList = !deck.showFullList;
  }
}

import { Component, EventEmitter, Output, OnDestroy, inject, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvatarComponent } from '../avatar/avatar.component';

@Component({
  selector: 'app-matchmaking-modal',
  standalone: true,
  imports: [CommonModule, AvatarComponent],
  templateUrl: './matchmaking-modal.component.html',
  styleUrl: './matchmaking-modal.component.scss'
})
export class MatchmakingModalComponent implements OnDestroy {
  @Output() close = new EventEmitter<void>();

  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  selectedMode: 'ranked' | 'friendly' = 'ranked';
  isSearching = false;
  searchTime = 0;
  private timerInterval: any;

  friends = [
    { id: 1, username: 'Xenon_Hunter', status: 'Online', isOnline: true },
    { id: 2, username: 'Mythic_Rose', status: 'Online', isOnline: true },
    { id: 3, username: 'DarkSlayer_01', status: 'Away (2m)', isOnline: false }
  ];

  ngOnDestroy(): void {
    this.stopTimer();
  }

  selectMode(mode: 'ranked' | 'friendly'): void {
    if (this.isSearching) return;
    this.selectedMode = mode;
  }

  startSearch(): void {
    this.isSearching = true;
    this.searchTime = 0;
    this.timerInterval = setInterval(() => {
      this.ngZone.run(() => {
        this.searchTime++;
        this.cdr.detectChanges();
      });
    }, 1000);
  }

  cancelSearch(): void {
    this.isSearching = false;
    this.stopTimer();
  }

  closeModal(): void {
    this.stopTimer();
    this.close.emit();
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }

  get formattedTime(): string {
    const minutes = Math.floor(this.searchTime / 60);
    const seconds = this.searchTime % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}
